import {strict as assert} from 'node:assert';
import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import Database from 'better-sqlite3';
import {buildSync} from 'esbuild';
import {AutomationEventIngestor} from '../src/automation/events/event-ingestor.ts';
import {AutomatedFuelTransactionEngine} from '../src/automation/transactions/fuel-transaction-engine.ts';
import {backfillPts2FuelSaleStockAudits,recordManualTankDip} from '../src/automation/tank-stock.ts';
const root=process.cwd(),dir=mkdtempSync(path.join(tmpdir(),'fms-manual-stock-')),file=path.join(dir,'fms.db');
const runner=path.join(root,'build','tank-stock-migration.mjs');
buildSync({entryPoints:[path.join(root,'scripts/db-validate-target.ts')],outfile:runner,bundle:true,platform:'node',format:'esm',packages:'external'});
const migration=spawnSync(process.execPath,[runner],{env:{...process.env,FMS_DB_PATH:file,FMS_SKIP_SEEDING:'true'},encoding:'utf8'});assert.equal(migration.status,0,migration.stdout+migration.stderr);
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

db.exec(`UPDATE automation_controllers SET adapter_type='PTS2' WHERE id='ctrl-1'; INSERT INTO automation_device_mappings(id,controller_id,equipment_type,external_parent_id,external_equipment_id,product_id,status) VALUES('product-map','ctrl-1','PRODUCT','','1','prod-pms','MAPPED');`);
const engine=new AutomatedFuelTransactionEngine(db),ingestor=new AutomationEventIngestor(db,(e,id)=>engine.process(e,id));let n=0;
const event=(id:string,changes:any={})=>({eventId:id,eventType:'DISPENSING_COMPLETED',controllerId:'ctrl-1',externalDeviceId:'PUMP-01-N1',deviceType:'NOZZLE',sourceSequence:String(++n),sourceOccurredAt:new Date().toISOString(),receivedAt:new Date().toISOString(),schemaVersion:1,payload:{externalPumpId:'PUMP-01',externalProductId:'1',productCode:'PMS',quantityLiters:12.5,unitPrice:100,amount:1250,readOnlySource:true,...changes}});
db.exec("INSERT INTO fuel_tanks(id,tank_name,fuel_product_id,fuel_name,capacity_liters,current_level_liters,reorder_level_liters,last_dip_reading) VALUES('other-petrol','Other Petrol','prod-pms','PMS',10000,4000,100,4000)");
const balance=()=>Number((db.prepare("SELECT current_level_liters v FROM fuel_tanks WHERE id='tank-1'").get() as any).v);
ingestor.ingest(event('sale-1'));assert.equal(balance(),5987.5);ingestor.ingest(event('sale-1'));assert.equal(balance(),5987.5);
assert.equal((db.prepare("SELECT current_level_liters v FROM fuel_tanks WHERE id='other-petrol'").get() as any).v,4000);
for(const status of ['Pending','Failed','Voided']){ingestor.ingest(event('status-'+status,{status}));assert.equal(balance(),5987.5);}
const tx=db.prepare('SELECT * FROM transactions').get() as any;assert.equal(tx.status,'Completed');assert.ok(tx.receipt_number);assert.equal(tx.dispensed_without_shift,1);
const cashInflow=db.prepare('SELECT * FROM cash_flow_records WHERE related_transaction_id=?').get(tx.id) as any;assert.equal(cashInflow.type,'Inflow');assert.equal(cashInflow.category,'Fuel Sales');assert.equal(cashInflow.amount,1250);assert.equal(cashInflow.accounting_method,'Unassigned');assert.equal(cashInflow.reference_no,tx.receipt_number);assert.equal(cashInflow.recorded_by_name,'Automation Runtime');assert.match(cashInflow.description,/PTS-2 fuel sale/);assert.equal((db.prepare('SELECT COUNT(*) n FROM cash_flow_records WHERE related_transaction_id=?').get(tx.id) as any).n,1);
db.prepare('DELETE FROM cash_flow_records WHERE related_transaction_id=?').run(tx.id);assert.equal(engine.backfillPts2CashFlowInflows(),1);assert.equal((db.prepare('SELECT COUNT(*) n FROM cash_flow_records WHERE related_transaction_id=?').get(tx.id) as any).n,1);assert.equal(engine.backfillPts2CashFlowInflows(),0);
const move=db.prepare("SELECT * FROM tank_stock_ledger WHERE transaction_id=?").get(tx.id) as any;assert.equal(move.quantity,-12.5);assert.equal(move.tank_id,'tank-1');assert.equal(move.external_event_id,'sale-1');assert.equal(move.before_balance,6000);assert.equal(move.after_balance,5987.5);
const stockAudit=db.prepare('SELECT * FROM stock_adjustments WHERE id=?').get('pts2-stock-'+tx.id) as any;assert.equal(stockAudit.type,'Fuel');assert.equal(stockAudit.reference_id,'tank-1');assert.equal(stockAudit.reference_name,'Tank 1');assert.equal(stockAudit.previous_quantity,6000);assert.equal(stockAudit.adjustment_quantity,-12.5);assert.equal(stockAudit.new_quantity,5987.5);assert.equal(stockAudit.reason,'PTS-2 Fuel Sale');assert.equal(stockAudit.movement_type,'SALE');assert.equal(stockAudit.source,'PTS-2 Transaction');assert.equal(stockAudit.reference_number,tx.receipt_number);assert.match(String(stockAudit.notes),/Tank: Tank 1/);assert.match(String(stockAudit.notes),/Dispensed: 12.500 L/);assert.match(String(stockAudit.notes),/Stock: 6000.000 L to 5987.500 L/);assert.equal((db.prepare('SELECT COUNT(*) n FROM tank_stock_ledger WHERE transaction_id=?').get(tx.id) as any).n,1);
db.prepare('DELETE FROM stock_adjustments WHERE id=?').run('pts2-stock-'+tx.id);assert.equal(backfillPts2FuelSaleStockAudits(db),1);const restoredAudit=db.prepare('SELECT * FROM stock_adjustments WHERE id=?').get('pts2-stock-'+tx.id) as any;assert.equal(restoredAudit.adjustment_quantity,-12.5);assert.equal(restoredAudit.new_quantity,5987.5);assert.equal((db.prepare('SELECT COUNT(*) n FROM tank_stock_ledger WHERE transaction_id=?').get(tx.id) as any).n,1);
assert.equal((db.prepare("SELECT current_meter_reading v FROM pump_nozzles WHERE id='nozzle-1'").get() as any).v,1000);
const dip=recordManualTankDip(db,{tankId:'tank-1',dipValue:1010,dipUnit:'MM',volumeLiters:5937.5,occurredAt:new Date().toISOString(),actorId:'operator',stationId:'station-1',reason:'Physical checkpoint'});assert.equal(dip.variance,-50);assert.equal(balance(),5987.5);assert.equal((db.prepare('SELECT dip_value FROM manual_tank_dips WHERE id=?').get(dip.id) as any).dip_value,1010);assert.throws(()=>db.prepare('DELETE FROM manual_tank_dips WHERE id=?').run(dip.id));
for(const eventType of ['DISPENSING_STARTED','DISPENSING_FAILED','DISPENSING_VOIDED']){engine.process({...event(eventType),eventType} as any,'unused');assert.equal(balance(),5987.5);}
db.exec("DELETE FROM automation_device_mappings WHERE id='product-map'");ingestor.ingest(event('missing-tank'));assert.equal(balance(),5987.5);assert.equal((db.prepare("SELECT failure_code FROM automation_fuel_transaction_processing WHERE external_event_id='missing-tank'").get() as any).failure_code,'PTS2_TANK_MAPPING_REQUIRED');db.exec("INSERT INTO automation_device_mappings(id,controller_id,equipment_type,external_parent_id,external_equipment_id,product_id,status) VALUES('product-map','ctrl-1','PRODUCT','','1','prod-pms','MAPPED')");
db.exec("CREATE TRIGGER fail_stock BEFORE INSERT ON tank_stock_ledger WHEN NEW.movement_type='PTS2_FUEL_SALE' BEGIN SELECT RAISE(ABORT,'test ledger failure'); END");assert.throws(()=>ingestor.ingest(event('rollback')));assert.equal(balance(),5987.5);assert.equal((db.prepare('SELECT COUNT(*) n FROM transactions').get() as any).n,1);db.exec('DROP TRIGGER fail_stock');
ingestor.ingest(event('sale-2'));assert.equal(balance(),5975);
ingestor.ingest(event('oversold',{quantityLiters:6000,amount:600000}));assert.equal(balance(),-25);assert.equal((db.prepare("SELECT anomaly FROM tank_stock_ledger WHERE external_event_id='oversold'").get() as any).anomaly,'NEGATIVE_STOCK_REVIEW_REQUIRED');
for(const productId of ['diesel','kerosene']){
 db.prepare("INSERT INTO fuel_products(id,code,name,price_per_liter,cost_per_liter,tax_rate,tax_code,unit) VALUES(?,?,?,100,90,0,'B','L')").run(productId,productId,productId);
 db.prepare("INSERT INTO fuel_tanks(id,tank_name,fuel_product_id,fuel_name,capacity_liters,current_level_liters,reorder_level_liters,last_dip_reading) VALUES(?,?,?,?,10000,5000,100,5000)").run(productId,productId,productId,productId);
 db.prepare("UPDATE pump_nozzles SET fuel_product_id=?,tank_id=? WHERE id='nozzle-1'").run(productId,productId);
 db.prepare("UPDATE automation_device_mappings SET product_id=? WHERE id='product-map'").run(productId);
 ingestor.ingest(event('sale-'+productId,{productCode:productId}));
 assert.equal((db.prepare('SELECT current_level_liters v FROM fuel_tanks WHERE id=?').get(productId) as any).v,4987.5);assert.equal(balance(),-25);
}
assert.equal(db.pragma('integrity_check',{simple:true}),'ok');db.close();console.log('PASS: manual dip durability, immutable evidence, variance, exact litres, totalizer separation, duplicate/unattended handling, lifecycle, missing mapping, atomic rollback and explicit negative-stock anomaly.');
