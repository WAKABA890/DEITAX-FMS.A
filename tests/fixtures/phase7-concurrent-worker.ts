import Database from 'better-sqlite3';
import {AutomationEventIngestor} from '../../src/automation/events/event-ingestor.ts';
import {MeterTotalizerEngine} from '../../src/automation/meters/meter-totalizer-engine.ts';
const file=process.argv[2];const db=new Database(file);db.pragma('foreign_keys=ON');db.pragma('busy_timeout=10000');const engine=new MeterTotalizerEngine(db);const ingestor=new AutomationEventIngestor(db,(event,id)=>engine.process(event,id));const now=new Date().toISOString();
try{ingestor.ingest({eventId:'METER-CONCURRENT',eventType:'TOTALIZER_READING_RECEIVED',controllerId:'ctrl-1',externalDeviceId:'PUMP-01-N1',deviceType:'NOZZLE',sourceSequence:'9000',sourceOccurredAt:now,receivedAt:now,schemaVersion:1,payload:{externalPumpId:'PUMP-01',productCode:'PMS',totalizerValue:12000,unit:'L'}});}finally{db.close();}
