import { EventEmitter } from 'node:events';
import type Database from 'better-sqlite3';
import type { AutomationEventEnvelope } from '../types/events.js';
import type { EquipmentState } from '../types/states.js';

const DISPLAY_STATES = new Set<EquipmentState>(['ONLINE','OFFLINE','IDLE','AUTHORIZED','DISPENSING','STOPPED','ERROR','UNKNOWN']);
const parseJson = (value: unknown) => { try { return JSON.parse(String(value || '{}')); } catch { return {}; } };
const normalizedState = (value: unknown): EquipmentState => {
  const state=String(value||'UNKNOWN').trim().toUpperCase();
  if(state==='CONNECTED')return 'ONLINE';
  if(state==='DISCONNECTED'||state==='DISABLED')return 'OFFLINE';
  if(state==='LIFTED')return 'AUTHORIZED';
  return DISPLAY_STATES.has(state as EquipmentState)?state as EquipmentState:'UNKNOWN';
};

export class LiveForecourtProjection {
  private changes=new EventEmitter();
  private available:boolean;
  constructor(private sqlite:Database.Database){this.available=Boolean(sqlite.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='automation_live_forecourt_state'`).get());}

  onChange(listener:()=>void){this.changes.on('change',listener);return()=>this.changes.off('change',listener);}

  apply(event:AutomationEventEnvelope){
    if(!this.available)return;
    const deviceType=event.deviceType||'CONTROLLER';
    if(!['CONTROLLER','PUMP','NOZZLE'].includes(deviceType))return;
    const payload=(event.payload&&typeof event.payload==='object'?event.payload:{}) as Record<string,unknown>;
    const mappedParent=event.externalDeviceId?(this.sqlite.prepare(`SELECT external_parent_id FROM automation_device_mappings WHERE controller_id=? AND equipment_type=? AND external_equipment_id=? ORDER BY status='MAPPED' DESC LIMIT 1`).get(event.controllerId,deviceType,event.externalDeviceId) as any)?.external_parent_id:null;
    const externalParentId=String(payload.externalParentId??mappedParent??'');
    const previous=this.sqlite.prepare(`SELECT * FROM automation_live_forecourt_state WHERE controller_id=? AND device_type=? AND external_parent_id=? AND external_device_id=?`).get(event.controllerId,deviceType,externalParentId,event.externalDeviceId||'') as any;
    let state=normalizedState(payload.state||payload.status||previous?.operational_state);
    const activity={...parseJson(previous?.activity_json)} as Record<string,unknown>;
    if(event.eventType==='CONTROLLER_CONNECTED')state='ONLINE';
    if(event.eventType==='CONTROLLER_DISCONNECTED')state='OFFLINE';
    if(event.eventType==='DISPENSING_STARTED'){
      state='DISPENSING';activity.startedAt=event.sourceOccurredAt;activity.volumeLiters=Number(payload.liters??payload.volumeLiters??0);activity.active=true;
    }
    if(event.eventType==='DISPENSING_PROGRESS'||event.eventType==='FUEL_TRANSACTION_UPDATED'){
      state='DISPENSING';activity.startedAt=activity.startedAt||event.sourceOccurredAt;activity.volumeLiters=Number(payload.liters??payload.volumeLiters??activity.volumeLiters??0);activity.active=true;
    }
    if(event.eventType==='DISPENSING_COMPLETED'||event.eventType==='FUEL_TRANSACTION_COMPLETED'){
      state='IDLE';activity.volumeLiters=Number(payload.liters??payload.volumeLiters??activity.volumeLiters??0);activity.completedAt=event.sourceOccurredAt;activity.active=false;
    }
    if(event.eventType==='EQUIPMENT_ERROR_REPORTED')state='ERROR';
    this.sqlite.prepare(`INSERT INTO automation_live_forecourt_state(controller_id,device_type,external_parent_id,external_device_id,operational_state,activity_json,last_event_type,last_event_id,source_occurred_at,received_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(controller_id,device_type,external_parent_id,external_device_id) DO UPDATE SET operational_state=excluded.operational_state,activity_json=excluded.activity_json,last_event_type=excluded.last_event_type,last_event_id=excluded.last_event_id,source_occurred_at=excluded.source_occurred_at,received_at=excluded.received_at,updated_at=excluded.updated_at`)
      .run(event.controllerId,deviceType,externalParentId,event.externalDeviceId||'',state,JSON.stringify(activity),event.eventType,event.eventId,event.sourceOccurredAt,event.receivedAt,event.receivedAt);
    this.changes.emit('change');
  }

  snapshot(){
    if(!this.available)throw new Error('Live Forecourt projection is unavailable; DT-FMS core remains operational.');
    const threshold=this.freshnessSeconds();const now=Date.now();
    const controllers=this.sqlite.prepare(`SELECT * FROM automation_controllers ORDER BY name`).all() as any[];
    const controllerById=new Map(controllers.map(row=>[row.id,row]));
    const states=this.sqlite.prepare(`SELECT * FROM automation_live_forecourt_state`).all() as any[];
    const stateByExternal=new Map(states.map(row=>[`${row.controller_id}|${row.device_type}|${row.external_parent_id}|${row.external_device_id}`,row]));
    const mappings=this.sqlite.prepare(`SELECT * FROM automation_device_mappings ORDER BY updated_at DESC`).all() as any[];
    const pumps=this.sqlite.prepare(`SELECT * FROM pumps ORDER BY pump_number`).all() as any[];
    const nozzles=this.sqlite.prepare(`SELECT n.*,fp.name product_name,fp.code product_code FROM pump_nozzles n LEFT JOIN fuel_products fp ON fp.id=n.fuel_product_id ORDER BY n.physical_pump_id,n.nozzle_number`).all() as any[];
    const mappingFor=(type:string,targetId:string)=>mappings.find(row=>row.equipment_type===type&&(row.pump_id===targetId||row.nozzle_id===targetId));
    const present=(row:any,mapping:any)=>{
      const controller=mapping?controllerById.get(mapping.controller_id):null;
      const age=row?.received_at?Math.max(0,now-Date.parse(row.received_at)):null;
      const connection=controller?.enabled?String(controller.status||'UNKNOWN'):'DISABLED';
      const freshness=!row?'UNKNOWN':connection==='ONLINE'&&age!==null&&age<=threshold*1000?'LIVE':'STALE';
      return {operationalState:row?.operational_state||'UNKNOWN',connectionState:connection,dataFreshness:freshness,lastUpdate:row?.received_at||null,lastEventType:row?.last_event_type||null,activity:parseJson(row?.activity_json)};
    };
    const mappedState=(mapping:any,type:string)=>mapping?stateByExternal.get(`${mapping.controller_id}|${type}|${mapping.external_parent_id||''}|${mapping.external_equipment_id}`):null;
    const displayMapping=(mapping:any)=>!mapping?'UNMAPPED':mapping.status==='MAPPED'?'MAPPED':mapping.status==='CONFLICT'||mapping.status==='ORPHANED'?'MAPPING_ERROR':'DISABLED';
    const pumpDtos=pumps.map(pump=>{
      const mapping=mappingFor('PUMP',pump.id);const pumpState=mappedState(mapping,'PUMP');
      const nozzleDtos=nozzles.filter(nozzle=>nozzle.physical_pump_id===pump.id).map(nozzle=>{const nozzleMapping=mappingFor('NOZZLE',nozzle.id);const row=mappedState(nozzleMapping,'NOZZLE');return{...nozzle,mappingState:displayMapping(nozzleMapping),controllerId:nozzleMapping?.controller_id||null,controllerName:controllerById.get(nozzleMapping?.controller_id)?.name||null,externalDeviceId:nozzleMapping?.external_equipment_id||null,...present(row,nozzleMapping)};});
      const activeNozzle=nozzleDtos.find(nozzle=>nozzle.operationalState==='DISPENSING');const projected=present(pumpState,mapping);
      if(activeNozzle&&projected.operationalState!=='ERROR'){projected.operationalState='DISPENSING';projected.activity=activeNozzle.activity;projected.lastUpdate=activeNozzle.lastUpdate;projected.dataFreshness=activeNozzle.dataFreshness;}
      return{...pump,mappingState:displayMapping(mapping),controllerId:mapping?.controller_id||null,controllerName:controllerById.get(mapping?.controller_id)?.name||null,externalDeviceId:mapping?.external_equipment_id||null,...projected,nozzles:nozzleDtos};
    });
    const unmapped=this.sqlite.prepare(`SELECT d.*,c.name controller_name FROM automation_discovered_devices d JOIN automation_controllers c ON c.id=d.controller_id LEFT JOIN automation_device_mappings m ON m.controller_id=d.controller_id AND m.equipment_type=d.equipment_type AND m.external_parent_id=d.external_parent_id AND m.external_equipment_id=d.external_equipment_id WHERE d.present=1 AND (m.id IS NULL OR m.status<>'MAPPED') ORDER BY c.name,d.equipment_type,d.external_equipment_id`).all();
    return{generatedAt:new Date(now).toISOString(),freshnessThresholdSeconds:threshold,controllers:controllers.map(row=>({...row,connectionState:row.enabled?row.status:'DISABLED'})),pumps:pumpDtos,unmappedDevices:unmapped};
  }

  private freshnessSeconds(){const row=this.sqlite.prepare(`SELECT setting_value_json FROM automation_settings WHERE setting_key='live_forecourt_freshness_seconds' ORDER BY updated_at DESC LIMIT 1`).get() as any;const parsed=parseJson(row?.setting_value_json);const value=Number(parsed.seconds??parsed.value??30);return Number.isFinite(value)&&value>=5&&value<=3600?value:30;}
}
