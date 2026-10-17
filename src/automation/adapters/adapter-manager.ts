import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { ControllerAdapter } from '../types/adapters.js';
import { AutomationEventIngestor } from '../events/event-ingestor.js';
import { LiveForecourtProjection } from '../live/live-forecourt-projection.js';
import { AutomatedFuelTransactionEngine } from '../transactions/fuel-transaction-engine.js';
import { MeterTotalizerEngine } from '../meters/meter-totalizer-engine.js';
import { AtgTankEngine } from '../atg/atg-tank-engine.js';
import { AdapterRegistry } from './adapter-registry.js';
import { CredentialVault } from '../security/credential-vault.js';
export function mappedTanksFromMappings(mappings: ReadonlyArray<{external_equipment_id?: unknown}>){
  return mappings.flatMap(mapping=>{
    const externalTankId=String(mapping.external_equipment_id||'').trim();
    const probeNumber=Number(externalTankId);
    return /^\d+$/.test(externalTankId)&&Number.isSafeInteger(probeNumber)&&probeNumber>=1
      ? [{externalTankId,probeNumber}]
      : [];
  });
}


export class AdapterManager {
  private runtimes=new Map<string,ControllerAdapter>();
  private ingestor:AutomationEventIngestor;
  private vault:CredentialVault;
  readonly liveForecourt:LiveForecourtProjection;
  constructor(private db:Database.Database,private registry=new AdapterRegistry()){
    this.vault=new CredentialVault(db);
    this.liveForecourt=new LiveForecourtProjection(db);
    const phase6Available=Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='automation_fuel_transaction_processing'`).get());
    const transactionEngine=phase6Available?new AutomatedFuelTransactionEngine(db):null;
    const phase7Available=Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='automation_meter_processing'`).get());
    const meterEngine=phase7Available?new MeterTotalizerEngine(db):null;
    const phase8Available=Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='automation_atg_processing'`).get());
    const atgEngine=phase8Available?new AtgTankEngine(db):null;
    this.ingestor=new AutomationEventIngestor(db,(event,inboxId)=>{
      this.liveForecourt.apply(event);
      transactionEngine?.process(event,inboxId);
      meterEngine?.process(event,inboxId);
      atgEngine?.process(event,inboxId);
    });
    transactionEngine?.requeueTrustedPts2PriceRejects();
    transactionEngine?.requeueResolvedPts2MappingRejects();
    this.ingestor.recoverPending();
    transactionEngine?.completePendingPts2Receipts();
    transactionEngine?.backfillPts2CashFlowInflows();
  }
  async loadEnabled(){const rows=this.db.prepare('SELECT id FROM automation_controllers WHERE enabled=1').all() as any[];for(const row of rows)try{await this.start(row.id);}catch(e){this.log(row.id,'ERROR','ADAPTER_MANAGER','Adapter startup isolated.',{error:e instanceof Error?e.message:String(e)});}}
  async start(controllerId:string){const row=this.controller(controllerId);if(!row)throw new Error('Controller not found.');let adapter=this.runtimes.get(controllerId);if(adapter)await adapter.shutdown();adapter=this.registry.create(row.adapter_type);this.runtimes.set(controllerId,adapter);const configuration={...this.json(row.configuration_json),host:row.host,port:row.port,connectionType:row.connection_type,timeoutMs:row.timeout_ms,__credential:this.vault.get(controllerId)};await adapter.initialize({controllerId,configuration,emit:async e=>{await this.receiveFromAdapter(e);},log:(l,c,m,d)=>this.log(controllerId,l,c,m,d),getCursor:(stream)=>{const x=this.db.prepare('SELECT cursor_value FROM automation_sync_cursors WHERE controller_id=? AND stream_name=?').get(controllerId,stream) as any;return x?.cursor_value||null;},setCursor:(stream,value,lastEventAt)=>this.db.prepare(`INSERT INTO automation_sync_cursors(id,controller_id,stream_name,cursor_value,last_event_at,synchronized_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(controller_id,stream_name) DO UPDATE SET cursor_value=excluded.cursor_value,last_event_at=excluded.last_event_at,synchronized_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP`).run(randomUUID(),controllerId,stream,value,lastEventAt||null),getMappedNozzles:()=>{const mappings=this.db.prepare(`SELECT external_parent_id,external_equipment_id FROM automation_device_mappings WHERE controller_id=? AND equipment_type='NOZZLE' AND status='MAPPED' ORDER BY external_parent_id,external_equipment_id`).all(controllerId) as any[];return mappings.flatMap(mapping=>{const pump=String(mapping.external_parent_id||'').trim(),externalNozzleId=String(mapping.external_equipment_id||'').trim(),match=externalNozzleId.match(/^(\d+)\.(\d+)$/);if(!/^\d+$/.test(pump)||!match||match[1]!==pump)return[];return[{externalPumpId:pump,externalNozzleId,nozzleNumber:Number(match[2])}];});},getMappedTanks:()=>{const mappings=this.db.prepare(`SELECT external_equipment_id FROM automation_device_mappings WHERE controller_id=? AND equipment_type='TANK' AND status='MAPPED' ORDER BY external_equipment_id`).all(controllerId) as any[];return mappedTanksFromMappings(mappings);}});try{await adapter.connect();const configured=Array.isArray(this.parseArray(row.capabilities_json))?this.parseArray(row.capabilities_json):[],capabilities=[...new Set([...configured,...adapter.getCapabilities()])];this.db.prepare(`UPDATE automation_controllers SET status='ONLINE',last_communication_at=CURRENT_TIMESTAMP,last_successful_connection_at=CURRENT_TIMESTAMP,last_error=NULL,capabilities_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(JSON.stringify(capabilities),controllerId);}catch(e){this.db.prepare(`UPDATE automation_controllers SET status='ERROR',last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(e instanceof Error?e.message:String(e),controllerId);throw e;}return this.status(controllerId);}
  private async receiveFromAdapter(event:import('../types/events.js').AutomationEventEnvelope){
    const receipt=this.ingestor.ingest(event);
    if(event.eventType==='TOTALIZER_READING_RECEIVED'&&event.source==='PTS2_PUMP_TOTALS'){
      const applied=this.db.prepare(`SELECT 1 FROM automation_meter_current_state s JOIN automation_meter_readings r ON r.id=s.current_reading_id WHERE r.controller_id=? AND r.external_event_id=?`).get(event.controllerId,event.eventId);
      if(!applied)throw new Error('PTS2_TOTALIZER_READING_NOT_APPLIED');
    }
    if(event.eventType==='DISPENSING_COMPLETED'&&!receipt.duplicate){
      const adapter=this.runtimes.get(event.controllerId);
      if(adapter?.refreshTotalizers&&event.externalDeviceId){
        try{await adapter.refreshTotalizers([event.externalDeviceId]);}
        catch(error){this.log(event.controllerId,'WARNING','PTS2_TRANSACTION_METER_REFRESH','Transaction captured; meter refresh will retry on the next poll.',{error:error instanceof Error?error.message:String(error)});}
      }
    }
  }
  async captureNozzleMeters(nozzleIds:string[]):Promise<Map<string,number>>{
    if(!nozzleIds.length)return new Map();
    const mappings=(this.db.prepare(`SELECT m.controller_id,m.external_equipment_id,m.nozzle_id,c.enabled FROM automation_device_mappings m JOIN automation_controllers c ON c.id=m.controller_id WHERE m.equipment_type='NOZZLE' AND m.status='MAPPED' AND c.adapter_type='PTS2'`).all() as any[]).filter(row=>nozzleIds.includes(row.nozzle_id));
    const groups=new Map<string,any[]>();
    for(const mapping of mappings){
      const rows=groups.get(mapping.controller_id)||[];rows.push(mapping);groups.set(mapping.controller_id,rows);
    }
    const readings=new Map<string,number>();
    for(const [controllerId,rows] of groups){
      const adapter=this.runtimes.get(controllerId);
      if(!rows[0].enabled||!adapter?.refreshTotalizers||adapter.getStatus()!=='CONNECTED')throw new Error('Meter controller is unavailable. Reconnect it and retry.');
      await adapter.refreshTransactions?.();
      await adapter.refreshTotalizers(rows.map(row=>row.external_equipment_id));
      for(const row of rows){
        const state=this.db.prepare(`SELECT current_value FROM automation_meter_current_state WHERE controller_id=? AND nozzle_id=?`).get(controllerId,row.nozzle_id) as any;
        if(state?.current_value==null||!Number.isFinite(Number(state.current_value)))throw new Error('Fresh nozzle meter reading is unavailable.');
        readings.set(row.nozzle_id,Number(state.current_value));
      }
    }
    return readings;
  }
  async disconnect(id:string,disabled=false){const a=this.runtimes.get(id);if(a){disabled?await a.disable():await a.disconnect();}this.db.prepare(`UPDATE automation_controllers SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(disabled?'DISABLED':'OFFLINE',id);return this.status(id);}
  async restart(id:string){await this.disconnect(id);return this.start(id);}
  async shutdown(){await Promise.allSettled([...this.runtimes.values()].map(a=>a.shutdown()));this.runtimes.clear();}
  async status(id:string){const a=this.runtimes.get(id);return{controllerId:id,adapter:a?.type||this.controller(id)?.adapter_type,adapterVersion:a?.version||null,runtimeStatus:a?.getStatus()||'DISCONNECTED',capabilities:a?[...a.getCapabilities()]:[],health:a?await a.healthCheck():null};}
  async discover(id:string){const a=this.runtimes.get(id);if(!a)throw new Error('Adapter runtime is not started.');const devices=await a.discoverDevices();this.log(id,'INFO','DISCOVERY','Adapter discovery completed.',{count:devices.length});return devices;}
  async scenario(id:string,scenario:string,options:Record<string,unknown>={}){const a=this.runtimes.get(id);if(!a?.generateScenario)throw new Error('Simulator runtime is not connected.');return a.generateScenario(scenario,options);}
  ingest(event:unknown){return this.ingestor.ingest(event);}
  registered(){return this.registry.registered();}
  private controller(id:string){return this.db.prepare('SELECT * FROM automation_controllers WHERE id=?').get(id) as any;}
  private json(v:any){try{return JSON.parse(v||'{}');}catch{return{};}}
  private parseArray(v:any):string[]{try{const parsed=JSON.parse(v||'[]');return Array.isArray(parsed)?parsed.filter(x=>typeof x==='string'):[];}catch{return[];}}
  private log(id:string,level:string,category:string,message:string,details?:unknown){this.db.prepare(`INSERT INTO automation_logs(id,controller_id,timestamp,level,category,message,details_json) VALUES(?,?,CURRENT_TIMESTAMP,?,?,?,?)`).run(randomUUID(),id,level,category,message,JSON.stringify(details||{}));}
}
