import Database from 'better-sqlite3';
import {AutomationEventIngestor} from '../../src/automation/events/event-ingestor.ts';
import {AutomatedFuelTransactionEngine} from '../../src/automation/transactions/fuel-transaction-engine.ts';

const sqlite=new Database(process.argv[2]);sqlite.pragma('foreign_keys=ON');sqlite.pragma('busy_timeout=5000');
const engine=new AutomatedFuelTransactionEngine(sqlite),ingestor=new AutomationEventIngestor(sqlite,(event,id)=>engine.process(event,id));
const occurredAt='2026-01-01T00:00:00.000Z';
try{ingestor.ingest({eventId:'EVENT-CONCURRENT',eventType:'DISPENSING_COMPLETED',controllerId:'ctrl-1',externalDeviceId:'PUMP-01-N1',deviceType:'NOZZLE',sourceSequence:'500',sourceOccurredAt:occurredAt,receivedAt:occurredAt,schemaVersion:1,payload:{externalPumpId:'PUMP-01',productCode:'PMS',quantityLiters:5,unitPrice:100,amount:500}});}finally{sqlite.close();}
