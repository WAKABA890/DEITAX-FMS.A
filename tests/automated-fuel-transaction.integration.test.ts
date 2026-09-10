import {strict as assert} from 'node:assert';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import Database from 'better-sqlite3';
import {buildSync} from 'esbuild';
import {AutomationEventIngestor} from '../src/automation/events/event-ingestor.ts';
import {AutomatedFuelTransactionEngine} from '../src/automation/transactions/fuel-transaction-engine.ts';

const root=process.cwd(),runnerDir=mkdtempSync(path.join(root,'build','phase6-test-')),runner=path.join(runnerDir,'validate.mjs');
buildSync({entryPoints:[path.join(root,'scripts','db-validate-target.ts')],outfile:runner,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
const concurrentWorker=path.join(runnerDir,'concurrent-worker.mjs');buildSync({entryPoints:[path.join(root,'tests','fixtures','phase6-concurrent-worker.ts')],outfile:concurrentWorker,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
process.once('exit',()=>{try{rmSync(runnerDir,{recursive:true,force:true});}catch{}});

test('Phase 6 posts only valid completed dispensing events with durable idempotency and recovery',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'dt-fms-phase6-')),file=path.join(dir,'fms.db');
 try{
  const migration=spawnSync(process.execPath,[runner],{cwd:root,env:{...process.env,FMS_DB_PATH:file,FMS_SKIP_SEEDING:'true'},encoding:'utf8'});assert.equal(migration.status,0,migration.stdout+migration.stderr);
  const db=new Database(file);db.pragma('foreign_keys=ON');db.exec(`
   INSERT INTO station_settings(id,station_name,tax_pin,address,phone) VALUES('station-1','Phase 6 Station','P000','Test','0700');
   INSERT INTO fuel_products(id,code,name,price_per_liter,cost_per_liter,tax_rate,tax_code,unit,color) VALUES('prod-pms','PMS','Premium Motor Spirit',100,90,0.08,'E','L','#fff');
   INSERT INTO fuel_tanks(id,tank_name,fuel_product_id,fuel_name,capacity_liters,current_level_liters,reorder_level_liters,last_dip_reading) VALUES('tank-1','Tank 1','prod-pms','PMS',10000,6000,1000,6000);
   INSERT INTO pumps(id,pump_number,pump_name,status) VALUES('pump-1',1,'Pump 01','Active'),('pump-2',2,'Pump 02','Active');
   INSERT INTO pump_nozzles(id,physical_pump_id,nozzle_number,nozzle_name,pump_number,pump_name,tank_id,fuel_product_id,fuel_name,opening_meter_reading,current_meter_reading,status) VALUES('nozzle-1','pump-1',1,'Nozzle 1',1,'Pump 01','tank-1','prod-pms','PMS',1000,1000,'Active'),('nozzle-2','pump-2',1,'Nozzle 2',2,'Pump 02','tank-1','prod-pms','PMS',2000,2000,'Active');
   INSERT INTO automation_controllers(id,station_id,name,adapter_type,connection_type,status,enabled) VALUES('ctrl-1','station-1','Controller 1','SIMULATOR','SIMULATOR','ONLINE',1),('ctrl-disabled','station-1','Disabled','SIMULATOR','SIMULATOR','DISABLED',0);
   INSERT INTO automation_device_mappings(id,controller_id,equipment_type,external_parent_id,external_equipment_id,pump_id,status) VALUES('map-pump','ctrl-1','PUMP','','PUMP-01','pump-1','MAPPED'),('map-disabled-pump','ctrl-disabled','PUMP','','PUMP-02','pump-2','MAPPED');
   INSERT INTO automation_device_mappings(id,controller_id,equipment_type,external_parent_id,external_equipment_id,nozzle_id,status) VALUES('map-nozzle','ctrl-1','NOZZLE','PUMP-01','PUMP-01-N1','nozzle-1','MAPPED'),('map-disabled-nozzle','ctrl-disabled','NOZZLE','PUMP-02','PUMP-02-N1','nozzle-2','MAPPED');
  `);
  const engine=new AutomatedFuelTransactionEngine(db),ingestor=new AutomationEventIngestor(db,(event,id)=>engine.process(event,id));let sequence=0;
  const event=(id:string,changes:any={})=>{sequence++;const now=new Date().toISOString();return{eventId:id,eventType:'DISPENSING_COMPLETED',controllerId:'ctrl-1',externalDeviceId:'PUMP-01-N1',deviceType:'NOZZLE',sourceSequence:String(sequence),sourceOccurredAt:now,receivedAt:now,schemaVersion:1,payload:{externalPumpId:'PUMP-01',productCode:'PMS',quantityLiters:10,unitPrice:100,amount:1000,...changes}};};
  const before={tank:(db.prepare(`SELECT current_level_liters v FROM fuel_tanks WHERE id='tank-1'`).get() as any).v,meter:(db.prepare(`SELECT current_meter_reading v FROM pump_nozzles WHERE id='nozzle-1'`).get() as any).v,counters:(db.prepare(`SELECT COUNT(*) c FROM document_counters`).get() as any).c};
  ingestor.ingest(event('EVENT-100'));ingestor.ingest(event('EVENT-100'));ingestor.ingest(event('EVENT-100'));
  assert.equal((db.prepare(`SELECT COUNT(*) c FROM transactions WHERE source='AUTOMATION'`).get() as any).c,1);
  const tx=db.prepare(`SELECT * FROM transactions WHERE source='AUTOMATION'`).get() as any;assert.equal(tx.payment_method,'Unassigned');assert.equal(tx.status,'Payment Pending');assert.equal(tx.receipt_number,null);assert.equal(tx.invoice_number,null);assert.equal(tx.subtotal,925.93);assert.equal(tx.tax,74.07);assert.equal(tx.total_amount,1000);
  assert.equal((db.prepare(`SELECT COUNT(*) c FROM automation_fuel_transaction_processing WHERE processing_status='POSTED' AND transaction_id=?`).get(tx.id) as any).c,1);
  const restarted=new AutomationEventIngestor(db,(e,id)=>engine.process(e,id));restarted.recoverPending();restarted.ingest(event('EVENT-100'));assert.equal((db.prepare(`SELECT COUNT(*) c FROM transactions`).get() as any).c,1);
  const invalidCases=[['wrong-product',{productCode:'AGO'},'PRODUCT_MISMATCH'],['bad-quantity',{quantityLiters:-1},'INVALID_QUANTITY'],['bad-price',{unitPrice:99},'INVALID_PRICE'],['bad-amount',{amount:999},'INVALID_AMOUNT'],['wrong-station',{stationId:'station-2'},'STATION_MISMATCH'],['unknown-pump',{externalPumpId:'PUMP-99'},'DEVICE_NOT_MAPPED']];
  for(const [id,change,code] of invalidCases as any[]){ingestor.ingest(event(id,change));assert.equal((db.prepare(`SELECT failure_code FROM automation_fuel_transaction_processing WHERE external_event_id=?`).get(id) as any).failure_code,code);}
  const ptsSale:any=event('pts-price-evidence',{unitPrice:110,amount:1100,readOnlySource:true});ptsSale.source='PTS2_REPORT';ingestor.ingest(ptsSale);const ptsTx=db.prepare(`SELECT unit_price,total_amount FROM transactions WHERE id=(SELECT transaction_id FROM automation_fuel_transaction_processing WHERE external_event_id='pts-price-evidence')`).get() as any;assert.equal(ptsTx.unit_price,110);assert.equal(ptsTx.total_amount,1100);
  const disabled=event('disabled-controller',{externalPumpId:'PUMP-02'});disabled.controllerId='ctrl-disabled';disabled.externalDeviceId='PUMP-02-N1';ingestor.ingest(disabled);assert.equal((db.prepare(`SELECT failure_code FROM automation_fuel_transaction_processing WHERE external_event_id='disabled-controller'`).get() as any).failure_code,'CONTROLLER_DISABLED');
  db.exec(`CREATE TRIGGER phase6_fail_transaction BEFORE INSERT ON transactions BEGIN SELECT RAISE(ABORT,'controlled database failure'); END;`);assert.throws(()=>ingestor.ingest(event('retry-event')));assert.equal((db.prepare(`SELECT processing_status FROM automation_event_inbox WHERE external_event_id='retry-event'`).get() as any).processing_status,'FAILED');db.exec('DROP TRIGGER phase6_fail_transaction');ingestor.ingest(event('retry-event'));assert.equal((db.prepare(`SELECT COUNT(*) c FROM transactions WHERE source='AUTOMATION'`).get() as any).c,3);
  const runWorker=()=>new Promise<number>((resolve,reject)=>{const child=spawn(process.execPath,[concurrentWorker,file],{stdio:'pipe'});let error='';child.stderr.on('data',chunk=>error+=chunk);child.once('error',reject);child.once('exit',code=>code===0?resolve(0):reject(new Error(error||`worker exited ${code}`)));});await Promise.all([runWorker(),runWorker()]);assert.equal((db.prepare(`SELECT COUNT(*) c FROM transactions WHERE id IN (SELECT transaction_id FROM automation_fuel_transaction_processing WHERE external_event_id='EVENT-CONCURRENT')`).get() as any).c,1);
  assert.deepEqual({tank:(db.prepare(`SELECT current_level_liters v FROM fuel_tanks WHERE id='tank-1'`).get() as any).v,meter:(db.prepare(`SELECT current_meter_reading v FROM pump_nozzles WHERE id='nozzle-1'`).get() as any).v,counters:(db.prepare(`SELECT COUNT(*) c FROM document_counters`).get() as any).c},{...before,meter:before.meter+35});
  assert.equal((db.prepare(`SELECT COUNT(*) c FROM nozzle_reading_history WHERE nozzle_id='nozzle-1' AND reading_type='Automated Dispense'`).get() as any).c,4);
  assert.equal((db.prepare(`SELECT COUNT(*) c FROM cash_flow_records`).get() as any).c,0);assert.equal((db.prepare(`SELECT COUNT(*) c FROM shop_items`).get() as any).c,0);assert.equal(db.pragma('integrity_check',{simple:true}),'ok');assert.equal(db.pragma('foreign_key_check').length,0);db.close();
 }finally{try{rmSync(dir,{recursive:true,force:true});}catch{}}
});
