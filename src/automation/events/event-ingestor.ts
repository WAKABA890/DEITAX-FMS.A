import { createHash,randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import type { AutomationEventEnvelope } from '../types/events.js';
import { markAutomationEventFailed,markAutomationEventProcessed,markAutomationEventProcessing,receiveAutomationEvent } from './event-inbox.js';

const schema=z.object({eventId:z.string().min(1),eventType:z.string().min(1),controllerId:z.string().min(1),externalDeviceId:z.string().nullable().optional(),deviceType:z.enum(['CONTROLLER','PUMP','NOZZLE','TANK','PRODUCT']).nullable().optional(),sourceSequence:z.string().nullable().optional(),sourceOccurredAt:z.string().datetime(),receivedAt:z.string().datetime(),schemaVersion:z.number().int().min(1),payload:z.unknown(),correlationId:z.string().nullable().optional(),source:z.string().optional()});

export class AutomationEventIngestor {
  private db:Database.Database;
  private processEvent:(event:AutomationEventEnvelope,inboxId:string)=>void;
  constructor(db:Database.Database,processEvent:(event:AutomationEventEnvelope,inboxId:string)=>void=()=>{}){this.db=db;this.processEvent=processEvent;}
  ingest(input:unknown){
    const parsed=schema.safeParse(input);if(!parsed.success)throw new Error('Invalid normalized automation event.');
    const event={...parsed.data,rawPayloadHash:createHash('sha256').update(JSON.stringify(parsed.data.payload)).digest('hex')} as AutomationEventEnvelope;
    const receipt=receiveAutomationEvent(this.db,event);
    if(receipt.duplicate&&receipt.processingStatus==='PROCESSED'){this.log(event.controllerId,'WARNING','DUPLICATE_EVENT','Duplicate event suppressed.',{eventId:event.eventId,sequence:event.sourceSequence});return receipt;}
    if(receipt.duplicate&&receipt.processingStatus==='PROCESSING')return receipt;
    return this.processClaimed(event,receipt.inboxId,receipt);
  }
  recoverPending(){
    this.db.prepare(`UPDATE automation_event_inbox SET processing_status='FAILED',last_error='Interrupted processing recovered after restart',updated_at=CURRENT_TIMESTAMP WHERE processing_status='PROCESSING' AND processing_attempts<3`).run();
    const rows=this.db.prepare(`SELECT * FROM automation_event_inbox WHERE processing_status IN ('RECEIVED','FAILED') AND processing_attempts<3 ORDER BY received_at,id`).all() as any[];
    for(const row of rows)try{this.log(row.controller_id,'INFO',row.processing_status==='FAILED'?'EVENT_RETRY':'EVENT_REPLAY','Durable event selected for bounded startup recovery.',{eventId:row.external_event_id,attempt:Number(row.processing_attempts)+1,maxAttempts:3});const event={eventId:row.external_event_id,eventType:row.event_type,controllerId:row.controller_id,externalDeviceId:row.external_device_id,deviceType:row.device_type,sourceSequence:row.source_sequence,sourceOccurredAt:row.source_occurred_at,receivedAt:row.received_at,schemaVersion:row.schema_version,payload:JSON.parse(row.payload_json),rawPayloadHash:row.raw_payload_hash,correlationId:row.correlation_id,source:'RECOVERY'} as AutomationEventEnvelope;this.processClaimed(event,row.id,{inboxId:row.id,duplicate:true,processingStatus:row.processing_status});}catch(error){this.log(row.controller_id,'ERROR','EVENT_RECOVERY','Durable event recovery failed safely.',{eventId:row.external_event_id,error:error instanceof Error?error.message:String(error)});}
  }
  private processClaimed(event:AutomationEventEnvelope,inboxId:string,receipt:any){let claimed=false;try{claimed=markAutomationEventProcessing(this.db,inboxId);if(!claimed)throw new Error('Automation event could not be claimed for processing.');this.sequence(event);this.processEvent(event,inboxId);markAutomationEventProcessed(this.db,inboxId);this.log(event.controllerId,'DEBUG','EVENT_RECEIPT','Normalized event durably received and processed.',{eventId:event.eventId,eventType:event.eventType});return{...receipt,processingStatus:'PROCESSED' as const};}catch(error){if(claimed)markAutomationEventFailed(this.db,inboxId,error instanceof Error?error.message:String(error));throw error;}}
  private sequence(event:AutomationEventEnvelope){if(!event.sourceSequence)return;const current=this.db.prepare(`SELECT source_sequence FROM automation_sync_cursors WHERE controller_id=? AND stream_name='events'`).get(event.controllerId) as any;const next=Number(event.sourceSequence),previous=Number(current?.source_sequence||0);let anomaly:string|null=null;if(next===previous)anomaly='DUPLICATE_SEQUENCE';else if(next<previous)anomaly='OUT_OF_ORDER_SEQUENCE';else if(previous&&next>previous+1)anomaly='SEQUENCE_GAP';if(anomaly)this.log(event.controllerId,'WARNING','SEQUENCE_ANOMALY',anomaly,{previous,next,eventId:event.eventId});if(!current)this.db.prepare(`INSERT INTO automation_sync_cursors(id,controller_id,stream_name,source_sequence,last_event_at,synchronized_at) VALUES(?,?,'events',?,?,?)`).run(randomUUID(),event.controllerId,event.sourceSequence,event.sourceOccurredAt,event.receivedAt);else if(next>previous)this.db.prepare(`UPDATE automation_sync_cursors SET source_sequence=?,last_event_at=?,synchronized_at=?,updated_at=CURRENT_TIMESTAMP WHERE controller_id=? AND stream_name='events'`).run(event.sourceSequence,event.sourceOccurredAt,event.receivedAt,event.controllerId);}
  private log(controllerId:string,level:string,category:string,message:string,details:unknown){this.db.prepare(`INSERT INTO automation_logs(id,controller_id,timestamp,level,category,message,details_json) VALUES(?,?,CURRENT_TIMESTAMP,?,?,?,?)`).run(randomUUID(),controllerId,level,category,message,JSON.stringify(details));}
}
