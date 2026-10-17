import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AutomationEventEnvelope } from '../types/events.js';

export type MeterFailureCode='CONTROLLER_NOT_FOUND'|'CONTROLLER_DISABLED'|'STATION_MISMATCH'|'INVALID_DEVICE_TYPE'|'DEVICE_NOT_MAPPED'|'PUMP_NOT_FOUND'|'NOZZLE_NOT_FOUND'|'NOZZLE_PUMP_MISMATCH'|'EQUIPMENT_DISABLED'|'PRODUCT_MISMATCH'|'INVALID_READING'|'INVALID_UNIT'|'INVALID_TIMESTAMP'|'EVENT_INTEGRITY_FAILURE';
export type MeterOutcome='IGNORED'|'PROCESSED'|'ANOMALY'|'REJECTED'|'DUPLICATE';
export interface MeterProcessingResult{outcome:MeterOutcome;readingId?:string;failureCode?:MeterFailureCode;anomaly?:string|null;}

class PermanentFailure extends Error{constructor(readonly code:MeterFailureCode,message:string){super(message);}}
const normalize=(value:unknown)=>String(value??'').trim().toUpperCase();
const decimals=(value:unknown)=>{const text=String(value);if(/[eE]/.test(text))return 99;return(text.split('.')[1]||'').length;};

/**
 * Phase 7 meter evidence processor.
 *
 * Accepted PTS-2 totalizers are also projected into the mapped nozzle's operational
 * current meter field so the existing pumps and shift screens use the hardware
 * reading. The immutable automation tables remain the evidence/source of truth.
 * Fuel stock, cash, shifts and transactions are never mutated here.
 */
export class MeterTotalizerEngine{
  constructor(private sqlite:Database.Database){}

  process(event:AutomationEventEnvelope,inboxId:string):MeterProcessingResult{
    if(event.eventType!=='TOTALIZER_READING_RECEIVED')return{outcome:'IGNORED'};
    const existing=this.sqlite.prepare('SELECT processing_status,meter_reading_id FROM automation_meter_processing WHERE controller_id=? AND external_event_id=?').get(event.controllerId,event.eventId) as any;
    if(existing?.processing_status==='PROCESSED')return{outcome:'DUPLICATE',readingId:existing.meter_reading_id};
    if(existing?.processing_status==='REJECTED')return{outcome:'DUPLICATE'};
    this.sqlite.prepare(`INSERT OR IGNORE INTO automation_meter_processing(inbox_id,controller_id,external_event_id) VALUES(?,?,?)`).run(inboxId,event.controllerId,event.eventId);
    try{
      this.sqlite.prepare(`UPDATE automation_meter_processing SET processing_status='VALIDATING',processing_attempts=processing_attempts+1,failure_code=NULL,failure_class=NULL,failure_detail=NULL,updated_at=CURRENT_TIMESTAMP WHERE inbox_id=?`).run(inboxId);
      const validated=this.validate(event,inboxId);
      return this.persist(event,inboxId,validated);
    }catch(error){
      if(error instanceof PermanentFailure){
        this.sqlite.transaction(()=>{
          this.sqlite.prepare(`UPDATE automation_meter_processing SET processing_status='REJECTED',failure_code=?,failure_class='PERMANENT',failure_detail=?,updated_at=CURRENT_TIMESTAMP WHERE inbox_id=?`).run(error.code,error.message.slice(0,1000),inboxId);
          this.sqlite.prepare(`UPDATE automation_event_inbox SET processing_status='PROCESSED',processed_at=CURRENT_TIMESTAMP,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(`${error.code}: ${error.message}`.slice(0,4000),inboxId);
          this.log(event,inboxId,'WARNING','METER_READING_REJECTED',error.message,{failureCode:error.code});
        })();
        return{outcome:'REJECTED',failureCode:error.code};
      }
      const detail=error instanceof Error?error.message:String(error);
      try{this.sqlite.prepare(`UPDATE automation_meter_processing SET processing_status='FAILED',failure_code='DATABASE_FAILURE',failure_class='TEMPORARY',failure_detail=?,updated_at=CURRENT_TIMESTAMP WHERE inbox_id=?`).run(detail.slice(0,1000),inboxId);}catch{}
      throw error;
    }
  }

  private validate(event:AutomationEventEnvelope,inboxId:string){
    const payload=(event.payload&&typeof event.payload==='object'?event.payload:{}) as Record<string,unknown>;
    const inbox=this.sqlite.prepare('SELECT raw_payload_hash,event_type FROM automation_event_inbox WHERE id=?').get(inboxId) as any;
    if(!inbox||inbox.event_type!=='TOTALIZER_READING_RECEIVED'||createHash('sha256').update(JSON.stringify(event.payload)).digest('hex')!==inbox.raw_payload_hash)throw new PermanentFailure('EVENT_INTEGRITY_FAILURE','Inbox identity or payload integrity is invalid.');
    const controller=this.sqlite.prepare(`SELECT c.*,s.id station_exists FROM automation_controllers c LEFT JOIN station_settings s ON s.id=c.station_id WHERE c.id=?`).get(event.controllerId) as any;
    if(!controller)throw new PermanentFailure('CONTROLLER_NOT_FOUND','Controller does not exist.');
    if(!controller.station_exists||payload.stationId&&String(payload.stationId)!==controller.station_id)throw new PermanentFailure('STATION_MISMATCH','Event station does not match the controller station.');
    if(!controller.enabled||controller.status==='DISABLED')throw new PermanentFailure('CONTROLLER_DISABLED','Controller is disabled.');
    if(event.deviceType!=='NOZZLE')throw new PermanentFailure('INVALID_DEVICE_TYPE','Phase 7 totalizers must identify a nozzle.');
    const externalNozzleId=String(event.externalDeviceId||payload.externalNozzleId||'').trim();
    const externalPumpId=String(payload.externalPumpId||payload.pumpExternalId||'').trim();
    if(!externalPumpId||!externalNozzleId)throw new PermanentFailure('DEVICE_NOT_MAPPED','External pump and nozzle identities are required.');
    const pumpMap=this.sqlite.prepare(`SELECT * FROM automation_device_mappings WHERE controller_id=? AND equipment_type='PUMP' AND external_equipment_id=?`).get(event.controllerId,externalPumpId) as any;
    if(!pumpMap||pumpMap.status!=='MAPPED')throw new PermanentFailure('DEVICE_NOT_MAPPED','External pump has no active mapping.');
    const nozzleMap=this.sqlite.prepare(`SELECT * FROM automation_device_mappings WHERE controller_id=? AND equipment_type='NOZZLE' AND external_parent_id=? AND external_equipment_id=?`).get(event.controllerId,externalPumpId,externalNozzleId) as any;
    if(!nozzleMap||nozzleMap.status!=='MAPPED')throw new PermanentFailure('NOZZLE_NOT_FOUND','External nozzle has no active mapping for this pump.');
    const conflicting=this.sqlite.prepare(`SELECT 1 FROM automation_device_mappings WHERE controller_id=? AND equipment_type='NOZZLE' AND external_equipment_id=? AND external_parent_id<>? LIMIT 1`).get(event.controllerId,externalNozzleId,externalPumpId);
    if(conflicting)throw new PermanentFailure('NOZZLE_PUMP_MISMATCH','External nozzle is associated with another pump.');
    const pump=this.sqlite.prepare('SELECT * FROM pumps WHERE id=?').get(pumpMap.pump_id) as any;
    const nozzle=this.sqlite.prepare('SELECT * FROM pump_nozzles WHERE id=?').get(nozzleMap.nozzle_id) as any;
    if(!pump)throw new PermanentFailure('PUMP_NOT_FOUND','Mapped pump does not exist.');
    if(!nozzle)throw new PermanentFailure('NOZZLE_NOT_FOUND','Mapped nozzle does not exist.');
    if(pump.status!=='Active'||nozzle.status!=='Active')throw new PermanentFailure('EQUIPMENT_DISABLED','Mapped pump or nozzle is disabled.');
    if(nozzle.physical_pump_id!==pump.id)throw new PermanentFailure('NOZZLE_PUMP_MISMATCH','Mapped nozzle does not belong to the mapped pump.');
    const product=nozzle.fuel_product_id?this.sqlite.prepare('SELECT * FROM fuel_products WHERE id=?').get(nozzle.fuel_product_id) as any:null;
    const supplied=normalize(payload.productId||payload.productCode||payload.externalProductId);
    if(supplied&&(!product||![normalize(product.id),normalize(product.code),normalize(product.name)].includes(supplied)))throw new PermanentFailure('PRODUCT_MISMATCH','Supplied product does not match the authoritative nozzle product.');
    const reading=Number(payload.totalizerValue??payload.cumulativeValue??payload.reading);
    if(!Number.isFinite(reading)||reading<0||decimals(payload.totalizerValue??payload.cumulativeValue??payload.reading)>3)throw new PermanentFailure('INVALID_READING','Cumulative reading must be finite, non-negative, and use at most three decimal places.');
    if(normalize(payload.unit)!=='L')throw new PermanentFailure('INVALID_UNIT','Only litres (L) are supported.');
    const occurred=Date.parse(event.sourceOccurredAt),received=Date.parse(event.receivedAt),now=Date.now();
    if(!Number.isFinite(occurred)||!Number.isFinite(received)||occurred>now+300000||received>now+300000||received<occurred-300000||occurred<now-31536000000)throw new PermanentFailure('INVALID_TIMESTAMP','Event timestamps are malformed or outside the permitted range.');
    return{controller,pump,nozzle,product,reading,externalPumpId,externalNozzleId,payload};
  }

  private persist(event:AutomationEventEnvelope,inboxId:string,v:any):MeterProcessingResult{
    const readingId=`meter-${randomUUID()}`;
    let result:MeterProcessingResult={outcome:'PROCESSED',readingId};
    this.sqlite.transaction(()=>{
      const duplicate=this.sqlite.prepare('SELECT meter_reading_id FROM automation_meter_processing WHERE inbox_id=? AND processing_status=?').get(inboxId,'PROCESSED') as any;
      if(duplicate){result={outcome:'DUPLICATE',readingId:duplicate.meter_reading_id};return;}
      this.sqlite.prepare(`UPDATE automation_meter_processing SET processing_status='METER_PROCESSING',updated_at=CURRENT_TIMESTAMP WHERE inbox_id=?`).run(inboxId);
      const previous=this.sqlite.prepare(`SELECT r.* FROM automation_meter_current_state s JOIN automation_meter_readings r ON r.id=s.current_reading_id WHERE s.controller_id=? AND s.external_parent_id=? AND s.external_device_id=?`).get(event.controllerId,v.externalPumpId,v.externalNozzleId) as any;
      const sequence=event.sourceSequence==null?null:Number(event.sourceSequence);
      const previousSequence=previous?.source_sequence==null?null:Number(previous.source_sequence);
      let anomaly:string|null=null;
      const pts2Snapshot=v.controller.adapter_type==='PTS2'&&v.payload.sequenceUnavailable===true;
      if(pts2Snapshot){
        if(previous&&Date.parse(event.sourceOccurredAt)<Date.parse(previous.source_occurred_at))anomaly='OUT_OF_ORDER';
        else if(previous&&v.reading<Number(previous.reading_value))anomaly='METER_RESET';
      }
      else if(sequence==null)anomaly='MISSING_SEQUENCE';
      else if(!Number.isFinite(sequence))anomaly='INVALID_SEQUENCE';
      else if(previousSequence!=null&&sequence!=null&&sequence===previousSequence)anomaly='DUPLICATE_SEQUENCE';
      else if(previousSequence!=null&&sequence!=null&&sequence<previousSequence)anomaly='OUT_OF_ORDER';
      else if(previous&&Date.parse(event.sourceOccurredAt)<Date.parse(previous.source_occurred_at))anomaly='OUT_OF_ORDER';
      else if(previous&&v.reading<Number(previous.reading_value))anomaly=v.payload.resetIndicator===true?'METER_RESET':'METER_DECREASE';
      else if(previousSequence!=null&&sequence!=null&&sequence>previousSequence+1)anomaly='SEQUENCE_GAP';
      const acceptedForCurrent=!['DUPLICATE_SEQUENCE','OUT_OF_ORDER','METER_DECREASE'].includes(anomaly||'');
      const delta=previous&&v.reading>=Number(previous.reading_value)?Number((v.reading-Number(previous.reading_value)).toFixed(3)):null;
      const correlation=this.correlate(event,delta);
      if(correlation.status==='MISMATCH'&&!anomaly)anomaly='METER_TRANSACTION_MISMATCH';
      this.sqlite.prepare(`INSERT INTO automation_meter_readings(id,inbox_id,controller_id,station_id,external_event_id,external_device_id,external_parent_id,device_type,pump_id,nozzle_id,product_id,reading_value,unit,source_sequence,source_occurred_at,received_at,payload_hash,processing_status,anomaly_classification,previous_reading_id,previous_value,calculated_delta,transaction_id,transaction_volume,correlation_status)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(readingId,inboxId,event.controllerId,v.controller.station_id,event.eventId,v.externalNozzleId,v.externalPumpId,'NOZZLE',v.pump.id,v.nozzle.id,v.product?.id||null,v.reading,'L',event.sourceSequence||null,event.sourceOccurredAt,event.receivedAt,event.rawPayloadHash,anomaly?'ANOMALY':'ACCEPTED',anomaly,previous?.id||null,previous?.reading_value??null,delta,correlation.transactionId,correlation.volume,correlation.status);
      if(acceptedForCurrent){
        this.sqlite.prepare(`INSERT INTO automation_meter_current_state(controller_id,station_id,external_parent_id,external_device_id,pump_id,nozzle_id,product_id,current_reading_id,previous_reading_id,current_value,previous_value,calculated_delta,unit,last_sequence,last_source_occurred_at,last_received_at,last_valid_reading_at,last_anomaly,correlation_status,transaction_id)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(controller_id,external_parent_id,external_device_id) DO UPDATE SET station_id=excluded.station_id,pump_id=excluded.pump_id,nozzle_id=excluded.nozzle_id,product_id=excluded.product_id,current_reading_id=excluded.current_reading_id,previous_reading_id=excluded.previous_reading_id,current_value=excluded.current_value,previous_value=excluded.previous_value,calculated_delta=excluded.calculated_delta,unit=excluded.unit,last_sequence=excluded.last_sequence,last_source_occurred_at=excluded.last_source_occurred_at,last_received_at=excluded.last_received_at,last_valid_reading_at=excluded.last_valid_reading_at,last_anomaly=excluded.last_anomaly,correlation_status=excluded.correlation_status,transaction_id=excluded.transaction_id,updated_at=CURRENT_TIMESTAMP`).run(event.controllerId,v.controller.station_id,v.externalPumpId,v.externalNozzleId,v.pump.id,v.nozzle.id,v.product?.id||null,readingId,previous?.id||null,v.reading,previous?.reading_value??null,delta,'L',event.sourceSequence||null,event.sourceOccurredAt,event.receivedAt,event.sourceOccurredAt,anomaly,correlation.status,correlation.transactionId);
        if(event.source==='PTS2_PUMP_TOTALS'||pts2Snapshot){
          this.sqlite.prepare(`UPDATE pump_nozzles SET current_meter_reading=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(v.reading,v.nozzle.id);
        }
      }
      this.sqlite.prepare(`UPDATE automation_meter_processing SET processing_status='PROCESSED',meter_reading_id=?,failure_code=NULL,failure_class=NULL,failure_detail=NULL,updated_at=CURRENT_TIMESTAMP WHERE inbox_id=?`).run(readingId,inboxId);
      this.sqlite.prepare(`UPDATE automation_event_inbox SET processing_status='PROCESSED',processed_at=CURRENT_TIMESTAMP,last_error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(inboxId);
      this.log(event,inboxId,anomaly?'WARNING':'INFO',anomaly?'METER_READING_ANOMALY':'METER_READING_ACCEPTED',anomaly||'Cumulative meter reading accepted.',{readingId,value:v.reading,delta,correlation:correlation.status});
      result={outcome:anomaly?'ANOMALY':'PROCESSED',readingId,anomaly};
    })();
    return result;
  }

  private correlate(event:AutomationEventEnvelope,delta:number|null){
    if(!event.correlationId||delta==null)return{status:'NOT_AVAILABLE' as const,transactionId:null,volume:null};
    const row=this.sqlite.prepare(`SELECT p.transaction_id,t.quantity FROM automation_event_inbox i JOIN automation_fuel_transaction_processing p ON p.inbox_id=i.id JOIN transactions t ON t.id=p.transaction_id WHERE i.correlation_id=? AND i.controller_id=? AND p.processing_status='POSTED' ORDER BY p.posted_at DESC LIMIT 1`).get(event.correlationId,event.controllerId) as any;
    if(!row)return{status:'NOT_AVAILABLE' as const,transactionId:null,volume:null};
    return{status:Math.abs(Number(row.quantity)-delta)<=0.001?'MATCHED' as const:'MISMATCH' as const,transactionId:row.transaction_id as string,volume:Number(row.quantity)};
  }

  private log(event:AutomationEventEnvelope,inboxId:string,level:string,category:string,message:string,details:unknown){this.sqlite.prepare(`INSERT INTO automation_logs(id,controller_id,event_id,timestamp,level,category,message,details_json,correlation_id) VALUES(?,?,?,CURRENT_TIMESTAMP,?,?,?,?,?)`).run(randomUUID(),event.controllerId,inboxId,level,category,message,JSON.stringify(details),event.correlationId||null);}
}
