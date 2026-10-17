import {strict as assert} from 'node:assert';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import Database from 'better-sqlite3';
import {buildSync} from 'esbuild';

const root=process.cwd(),runnerDir=mkdtempSync(path.join(root,'build','live-forecourt-test-')),runner=path.join(runnerDir,'server.mjs');
buildSync({entryPoints:[path.join(root,'server.ts')],outfile:runner,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
process.once('exit',()=>{try{rmSync(runnerDir,{recursive:true,force:true});}catch{}});
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));

test('Phase 5 remains observation-only until Phase 6 receives a completed dispensing event',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'dt-fms-live-forecourt-')),databasePath=path.join(directory,'fms.db'),port=3155,base=`http://127.0.0.1:${port}/api`;let server:any;
 const request=async(endpoint:string,options:RequestInit={},cookie?:string)=>{const response=await fetch(base+endpoint,{...options,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(options.headers||{})}});return{response,body:await response.json().catch(()=>null)};};
 try{
  server=spawn(process.execPath,[runner],{cwd:root,env:{...process.env,NODE_ENV:'production',PORT:String(port),FMS_DB_PATH:databasePath,FMS_SKIP_SEEDING:'true',FMS_STATIC_DIR:path.join(root,'dist')},stdio:'pipe'});
  for(let i=0;i<100;i++){try{if((await fetch(base+'/status')).ok)break;}catch{}await delay(100);}
  await request('/users',{method:'POST',body:JSON.stringify({name:'Phase Five Super',username:'phase5-super',email:'phase5@test.local',phone:'0700',pin:'1234'})});
  const login=await request('/auth/verify-pin',{method:'POST',body:JSON.stringify({identifier:'phase5-super',pin:'1234'})}),cookie=login.response.headers.get('set-cookie')?.split(';')[0];assert.ok(cookie);
  const db=new Database(databasePath);db.pragma('foreign_keys=ON');db.exec(`
   INSERT INTO station_settings(id,station_name,tax_pin,address,phone) VALUES('station-1','Phase 5 Station','P000','Test','0700');
   INSERT INTO fuel_products(id,code,name,price_per_liter,cost_per_liter,tax_rate,tax_code,unit) VALUES('prod-pms','PMS','Premium Motor Spirit',100,90,0,'B','L');
   INSERT INTO fuel_tanks(id,tank_name,fuel_product_id,fuel_name,capacity_liters,current_level_liters,reorder_level_liters,last_dip_reading) VALUES('tank-1','Tank 1','prod-pms','PMS',10000,6000,1000,6000);
   INSERT INTO pumps(id,pump_number,pump_name,status) VALUES('pump-1',1,'Pump 01','Active'),('pump-2',2,'Pump 02','Active');
   INSERT INTO pump_nozzles(id,physical_pump_id,nozzle_number,nozzle_name,pump_number,pump_name,tank_id,fuel_product_id,fuel_name,opening_meter_reading,current_meter_reading,status) VALUES('nozzle-1','pump-1',1,'Nozzle 1',1,'Pump 01','tank-1','prod-pms','PMS',1000,1000,'Active'),('nozzle-2','pump-2',1,'Nozzle 1',2,'Pump 02','tank-1','prod-pms','PMS',2000,2000,'Active');
   INSERT INTO automation_controllers(id,station_id,name,adapter_type,connection_type,configuration_json,status,enabled) VALUES('sim-5','station-1','SIM-CTRL-001','SIMULATOR','SIMULATOR','{"simulatorMode":"SUCCESS"}','UNKNOWN',1);
   INSERT INTO automation_device_mappings(id,controller_id,equipment_type,external_parent_id,external_equipment_id,pump_id,status) VALUES('map-pump','sim-5','PUMP','','PUMP-01','pump-1','MAPPED');
   INSERT INTO automation_device_mappings(id,controller_id,equipment_type,external_parent_id,external_equipment_id,nozzle_id,status) VALUES('map-nozzle','sim-5','NOZZLE','PUMP-01','PUMP-01-N1','nozzle-1','MAPPED');
   INSERT INTO automation_discovered_devices(id,controller_id,equipment_type,external_parent_id,external_equipment_id,external_name,metadata_json,present) VALUES('external-unmapped','sim-5','PUMP','','PUMP-04','External Pump 04','{}',1);
  `);
  const before={transactions:(db.prepare('SELECT COUNT(*) c FROM transactions').get() as any).c,level:(db.prepare(`SELECT current_level_liters v FROM fuel_tanks WHERE id='tank-1'`).get() as any).v,meter:(db.prepare(`SELECT current_meter_reading v FROM pump_nozzles WHERE id='nozzle-1'`).get() as any).v};db.close();
  assert.equal((await request('/automation/runtime/sim-5/connect',{method:'POST'},cookie)).response.status,200);
  await request('/automation/runtime/sim-5/scenario',{method:'POST',body:JSON.stringify({scenario:'PUMP_STATE'})},cookie);
  await request('/automation/runtime/sim-5/scenario',{method:'POST',body:JSON.stringify({scenario:'DISPENSING_START',options:{liters:0}})},cookie);
  await request('/automation/runtime/sim-5/scenario',{method:'POST',body:JSON.stringify({scenario:'DISPENSING_PROGRESS',options:{liters:18.42}})},cookie);
  const live=await request('/automation/live-forecourt/snapshot',{},cookie);assert.equal(live.response.status,200,JSON.stringify(live.body));assert.equal(live.body.pumps.length,2);assert.equal(live.body.pumps[0].operationalState,'DISPENSING');assert.equal(live.body.pumps[0].nozzles[0].activity.volumeLiters,18.42);assert.equal(live.body.pumps[1].mappingState,'UNMAPPED');assert.ok(live.body.unmappedDevices.some((device:any)=>device.external_equipment_id==='PUMP-04'));
  const beforeCompletion=new Database(databasePath,{readonly:true});assert.equal((beforeCompletion.prepare('SELECT COUNT(*) c FROM transactions').get() as any).c,before.transactions);beforeCompletion.close();
  await request('/automation/runtime/sim-5/disconnect',{method:'POST'},cookie);const offline=(await request('/automation/live-forecourt/snapshot',{},cookie)).body;assert.equal(offline.pumps.length,2);assert.equal(offline.pumps[0].operationalState,'DISPENSING');assert.equal(offline.pumps[0].connectionState,'OFFLINE');assert.equal(offline.pumps[0].dataFreshness,'STALE');
  await request('/automation/runtime/sim-5/connect',{method:'POST'},cookie);await request('/automation/runtime/sim-5/scenario',{method:'POST',body:JSON.stringify({scenario:'DISPENSING_COMPLETE',options:{liters:20}})},cookie);const reconnected=(await request('/automation/live-forecourt/snapshot',{},cookie)).body;assert.equal(reconnected.pumps[0].nozzles[0].operationalState,'IDLE');assert.equal(reconnected.pumps[0].nozzles[0].dataFreshness,'LIVE');
  const check=new Database(databasePath,{readonly:true}),after={transactions:(check.prepare('SELECT COUNT(*) c FROM transactions').get() as any).c,level:(check.prepare(`SELECT current_level_liters v FROM fuel_tanks WHERE id='tank-1'`).get() as any).v,meter:(check.prepare(`SELECT current_meter_reading v FROM pump_nozzles WHERE id='nozzle-1'`).get() as any).v};assert.deepEqual(after,{...before,transactions:before.transactions+1,meter:before.meter+20});assert.equal((check.prepare(`SELECT source FROM transactions ORDER BY created_at DESC LIMIT 1`).get() as any).source,'AUTOMATION');assert.ok((check.prepare(`SELECT COUNT(*) c FROM automation_event_inbox WHERE processing_status='PROCESSED'`).get() as any).c>=6);assert.equal(check.pragma('foreign_key_check').length,0);check.close();
 }finally{if(server&&server.exitCode===null){server.kill();await Promise.race([new Promise(resolve=>server.once('exit',resolve)),delay(3000)]);}try{rmSync(directory,{recursive:true,force:true});}catch{}}
});
