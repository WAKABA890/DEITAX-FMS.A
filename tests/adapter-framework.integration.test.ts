import {strict as assert} from 'node:assert';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {test} from 'node:test';import Database from 'better-sqlite3';
import {AdapterManager,mappedTanksFromMappings} from '../src/automation/adapters/adapter-manager.ts';import {AdapterRegistry} from '../src/automation/adapters/adapter-registry.ts';

test('mapped PTS-2 tanks support every positive numeric probe ID',()=>{
 assert.deepEqual(mappedTanksFromMappings([
  {external_equipment_id:'1'},
  {external_equipment_id:'21'},
  {external_equipment_id:'200'},
  {external_equipment_id:'0'},
  {external_equipment_id:'TANK-A'},
  {external_equipment_id:'2.5'}
 ]),[
  {externalTankId:'1',probeNumber:1},
  {externalTankId:'21',probeNumber:21},
  {externalTankId:'200',probeNumber:200}
 ]);
});

test('Phase 4 simulator lifecycle and durable normalized events',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dt-fms-adapter-')),file=path.join(dir,'fms.db');const src=new Database(path.join(process.cwd(),'data','fms.db'),{readonly:true});await src.backup(file);src.close();const db=new Database(file);db.pragma('foreign_keys=ON');
 db.prepare(`INSERT INTO automation_controllers(id,station_id,name,adapter_type,connection_type,configuration_json,status,enabled) VALUES('sim-phase4','station-1','Phase 4 Simulator','SIMULATOR','SIMULATOR','{"simulatorMode":"SUCCESS"}','UNKNOWN',1)`).run();const manager=new AdapterManager(db);
 try{assert.equal((await manager.start('sim-phase4')).runtimeStatus,'CONNECTED');assert.ok((await manager.discover('sim-phase4')).length);await manager.scenario('sim-phase4','PUMP_STATE');await manager.scenario('sim-phase4','NOZZLE_STATE');const events=await manager.scenario('sim-phase4','DISPENSING');assert.deepEqual(events.map((e:any)=>e.eventType),['DISPENSING_STARTED','DISPENSING_PROGRESS','DISPENSING_COMPLETED']);assert.equal(manager.ingest(events[0]).duplicate,true);await manager.scenario('sim-phase4','SEQUENCE_GAP');assert.ok(db.prepare(`SELECT 1 FROM automation_logs WHERE category='SEQUENCE_ANOMALY'`).get());assert.ok(db.prepare(`SELECT 1 FROM automation_event_inbox WHERE processing_status='PROCESSED'`).get());assert.equal((await manager.disconnect('sim-phase4')).runtimeStatus,'DISCONNECTED');assert.equal((await manager.restart('sim-phase4')).runtimeStatus,'CONNECTED');const unsupported=new AdapterRegistry().create('PTS2');await unsupported.initialize({controllerId:'x',configuration:{},emit:async()=>{},log:()=>{}});await assert.rejects(()=>unsupported.connect(),/PTS2_CREDENTIALS_REQUIRED/);assert.throws(()=>manager.ingest({bad:true}),/Invalid normalized/);await manager.shutdown();assert.equal(db.pragma('foreign_key_check').length,0);}finally{await manager.shutdown();db.close();rmSync(dir,{recursive:true,force:true});}
});

test('sequence duplicate and out-of-order anomalies are retained without inventing events',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dt-fms-sequence-')),file=path.join(dir,'fms.db');const src=new Database(path.join(process.cwd(),'data','fms.db'),{readonly:true});await src.backup(file);src.close();const db=new Database(file);db.prepare(`INSERT INTO automation_controllers(id,station_id,name,adapter_type,connection_type,status,enabled) VALUES('seq-phase4','station-1','Sequence Simulator','SIMULATOR','SIMULATOR','UNKNOWN',1)`).run();const manager=new AdapterManager(db);const event=(id:string,sequence:number)=>({eventId:id,eventType:'PUMP_STATE_CHANGED',controllerId:'seq-phase4',externalDeviceId:'PUMP-01',deviceType:'PUMP' as const,sourceSequence:String(sequence),sourceOccurredAt:'2026-08-31T00:00:00.000Z',receivedAt:'2026-08-31T00:00:01.000Z',schemaVersion:1,payload:{state:'IDLE'},source:'SIMULATOR'});
 try{manager.ingest(event('seq-1',1));manager.ingest(event('seq-3',3));manager.ingest(event('seq-3-duplicate-number',3));manager.ingest(event('seq-2-late',2));const messages=(db.prepare(`SELECT message FROM automation_logs WHERE controller_id='seq-phase4' AND category='SEQUENCE_ANOMALY'`).all() as any[]).map(r=>r.message);assert.ok(messages.includes('SEQUENCE_GAP'));assert.ok(messages.includes('DUPLICATE_SEQUENCE'));assert.ok(messages.includes('OUT_OF_ORDER_SEQUENCE'));assert.equal((db.prepare(`SELECT COUNT(*) c FROM automation_event_inbox WHERE controller_id='seq-phase4'`).get() as any).c,4);}finally{await manager.shutdown();db.close();rmSync(dir,{recursive:true,force:true});}
});

test('deterministic simulator burst remains bounded and database responsive',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dt-fms-burst-')),file=path.join(dir,'fms.db');const src=new Database(path.join(process.cwd(),'data','fms.db'),{readonly:true});await src.backup(file);src.close();const db=new Database(file);const usersBefore=(db.prepare('SELECT COUNT(*) c FROM users').get() as any).c;db.prepare(`INSERT INTO automation_controllers(id,station_id,name,adapter_type,connection_type,status,enabled) VALUES('burst-phase4','station-1','Burst Simulator','SIMULATOR','SIMULATOR','UNKNOWN',1)`).run();const manager=new AdapterManager(db);try{await manager.start('burst-phase4');const started=performance.now();for(let i=1;i<=1000;i++){await manager.scenario('burst-phase4','PUMP_STATE');if(i===100||i===500)assert.equal((db.prepare(`SELECT COUNT(*) c FROM automation_event_inbox WHERE controller_id='burst-phase4'`).get() as any).c,i+1);}const elapsed=performance.now()-started;assert.equal((db.prepare(`SELECT COUNT(*) c FROM automation_event_inbox WHERE controller_id='burst-phase4'`).get() as any).c,1001);assert.ok(elapsed<20000);assert.equal((db.prepare('SELECT COUNT(*) c FROM users').get() as any).c,usersBefore);assert.equal(db.pragma('foreign_key_check').length,0);}finally{await manager.shutdown();db.close();rmSync(dir,{recursive:true,force:true});}
});
