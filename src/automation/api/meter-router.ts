import { Router } from 'express';
import type Database from 'better-sqlite3';

const parseJson=(value:unknown)=>{try{return JSON.parse(String(value||'{}'));}catch{return{};}};

export function createMeterRouter(deps:{sqlite:Database.Database;requirePermission:(req:any,res:any,p:any,a:string)=>any}){
  const router=Router();
  const guard=(req:any,res:any)=>Boolean(deps.requirePermission(req,res,'VIEW_AUTOMATION','view meters and totalizers'));
  const station=()=>deps.sqlite.prepare('SELECT id FROM station_settings ORDER BY created_at,id LIMIT 1').get() as {id:string}|undefined;
  const threshold=(stationId:string)=>{const row=deps.sqlite.prepare(`SELECT setting_value_json FROM automation_settings WHERE station_id=? AND setting_key='live_forecourt_freshness_seconds'`).get(stationId) as any;return Number(parseJson(row?.setting_value_json).seconds||30);};

  router.get('/current',(req:any,res)=>{
    if(guard(req,res))return;
    try{
      const selected=station();if(!selected)return res.json({generatedAt:new Date().toISOString(),freshnessThresholdSeconds:30,pumps:[],attention:[]});
      const seconds=threshold(selected.id),now=Date.now();
      const rows=deps.sqlite.prepare(`SELECT p.id pump_id,p.pump_number,p.pump_name,p.status pump_status,n.id nozzle_id,n.nozzle_number,n.nozzle_name,n.status nozzle_status,n.fuel_product_id,fp.name product_name,fp.code product_code,
        m.controller_id,m.external_parent_id,m.external_equipment_id,c.name controller_name,c.status controller_status,c.last_communication_at,
        s.current_value,s.previous_value,s.calculated_delta,s.unit,s.last_sequence,s.last_source_occurred_at,s.last_received_at,s.last_valid_reading_at,s.last_anomaly,s.correlation_status,s.transaction_id
        FROM pumps p LEFT JOIN pump_nozzles n ON n.physical_pump_id=p.id LEFT JOIN fuel_products fp ON fp.id=n.fuel_product_id
        LEFT JOIN automation_device_mappings m ON m.nozzle_id=n.id AND m.equipment_type='NOZZLE' AND m.status='MAPPED' AND m.controller_id IN (SELECT id FROM automation_controllers WHERE station_id=?)
        LEFT JOIN automation_controllers c ON c.id=m.controller_id
        LEFT JOIN automation_meter_current_state s ON s.controller_id=m.controller_id AND s.external_parent_id=m.external_parent_id AND s.external_device_id=m.external_equipment_id
        ORDER BY p.pump_number,n.nozzle_number`).all(selected.id) as any[];
      const pumps=new Map<string,any>();const attention:any[]=[];
      for(const row of rows){let pump=pumps.get(row.pump_id);if(!pump){pump={id:row.pump_id,pumpNumber:row.pump_number,pumpName:row.pump_name,status:row.pump_status,nozzles:[]};pumps.set(row.pump_id,pump);}if(!row.nozzle_id)continue;
        const age=row.last_received_at?(now-Date.parse(row.last_received_at))/1000:null;
        const freshness=!row.current_value&&row.current_value!==0?'UNKNOWN':row.controller_status!=='ONLINE'?'OFFLINE':age!=null&&age>seconds?'STALE':'FRESH';
        const nozzle={id:row.nozzle_id,nozzleNumber:row.nozzle_number,nozzleName:row.nozzle_name,status:row.nozzle_status,productId:row.fuel_product_id,productName:row.product_name,productCode:row.product_code,controllerId:row.controller_id,controllerName:row.controller_name,controllerStatus:row.controller_status||'UNKNOWN',externalPumpId:row.external_parent_id,externalNozzleId:row.external_equipment_id,currentTotalizer:row.current_value??null,previousTotalizer:row.previous_value??null,meterDelta:row.calculated_delta??null,unit:row.unit||'L',lastReading:row.last_source_occurred_at||null,lastCommunication:row.last_communication_at||row.last_received_at||null,sequence:row.last_sequence||null,freshness,state:row.current_value==null?'NO_DATA':row.last_anomaly?'ANOMALY':'VALID',anomaly:row.last_anomaly||null,correlationStatus:row.correlation_status||'NOT_AVAILABLE',transactionId:row.transaction_id||null};
        pump.nozzles.push(nozzle);if(freshness!=='FRESH'||nozzle.anomaly||!row.controller_id)attention.push({pumpId:row.pump_id,nozzleId:row.nozzle_id,type:!row.controller_id?'UNMAPPED':nozzle.anomaly||freshness,message:!row.controller_id?'No active controller mapping.':nozzle.anomaly||`Meter is ${freshness}.`});
      }
      const unmapped=deps.sqlite.prepare(`SELECT d.controller_id,d.equipment_type,d.external_parent_id,d.external_equipment_id,d.external_name FROM automation_discovered_devices d JOIN automation_controllers c ON c.id=d.controller_id LEFT JOIN automation_device_mappings m ON m.controller_id=d.controller_id AND m.equipment_type=d.equipment_type AND m.external_parent_id=d.external_parent_id AND m.external_equipment_id=d.external_equipment_id WHERE c.station_id=? AND d.present=1 AND (m.id IS NULL OR m.status<>'MAPPED')`).all(selected.id) as any[];
      for(const device of unmapped)attention.push({type:'UNMAPPED_DEVICE',...device,message:'Discovered device is not actively mapped.'});
      res.json({generatedAt:new Date().toISOString(),stationId:selected.id,freshnessThresholdSeconds:seconds,pumps:[...pumps.values()],attention});
    }catch(error){console.error('[Automation] Meter current-state query failed safely:',error);res.status(503).json({success:false,code:'METER_STATE_UNAVAILABLE',message:'Meter state is temporarily unavailable.'});}
  });

  router.get('/history',(req:any,res)=>{
    if(guard(req,res))return;
    try{
      const selected=station();if(!selected)return res.json({records:[],total:0});
      const clauses=['r.station_id=?'],params:any[]=[selected.id];
      const filters:[string,string][]=[['pumpId','r.pump_id'],['nozzleId','r.nozzle_id'],['productId','r.product_id'],['controllerId','r.controller_id'],['state','r.processing_status'],['anomaly','r.anomaly_classification']];
      for(const [key,column] of filters){const value=String(req.query[key]||'').trim();if(value){clauses.push(`${column}=?`);params.push(value);}}
      for(const [key,operator] of [['from','>='],['to','<=']] as const){const value=String(req.query[key]||'').trim();if(value){if(!Number.isFinite(Date.parse(value)))return res.status(400).json({success:false,code:'INVALID_DATE_FILTER',message:`${key} must be an ISO timestamp.`});clauses.push(`r.source_occurred_at ${operator} ?`);params.push(new Date(value).toISOString());}}
      const limit=Math.min(500,Math.max(1,Number(req.query.limit)||100));
      const page=Math.max(1,Number(req.query.page)||1),offset=(page-1)*limit;
      const records=deps.sqlite.prepare(`SELECT r.*,p.pump_name,p.pump_number,n.nozzle_name,n.nozzle_number,fp.name product_name,fp.code product_code,c.name controller_name FROM automation_meter_readings r JOIN pumps p ON p.id=r.pump_id JOIN pump_nozzles n ON n.id=r.nozzle_id LEFT JOIN fuel_products fp ON fp.id=r.product_id JOIN automation_controllers c ON c.id=r.controller_id WHERE ${clauses.join(' AND ')} ORDER BY r.source_occurred_at DESC,r.created_at DESC LIMIT ? OFFSET ?`).all(...params,limit,offset);
      const total=(deps.sqlite.prepare(`SELECT COUNT(*) count FROM automation_meter_readings r WHERE ${clauses.join(' AND ')}`).get(...params) as any).count;
      res.json({records,total,limit,page});
    }catch(error){console.error('[Automation] Meter history query failed safely:',error);res.status(503).json({success:false,code:'METER_HISTORY_UNAVAILABLE',message:'Meter history is temporarily unavailable.'});}
  });
  return router;
}
