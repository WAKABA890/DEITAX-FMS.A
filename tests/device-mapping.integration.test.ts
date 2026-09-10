import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { buildSync } from 'esbuild';

const workspace=process.cwd();const runnerDirectory=mkdtempSync(path.join(workspace,'build','dt-fms-mapping-test-'));const serverRunner=path.join(runnerDirectory,'server.mjs');
buildSync({entryPoints:[path.join(workspace,'server.ts')],outfile:serverRunner,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});process.once('exit',()=>rmSync(runnerDirectory,{recursive:true,force:true}));
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));

test('Phase 3 discovery, mapping, validation, permissions, audit and restart persistence',async()=>{
 const directory=mkdtempSync(path.join(tmpdir(),'dt-fms-mapping-api-'));const databasePath=path.join(directory,'fms.db');const port=3141;const base=`http://127.0.0.1:${port}/api`;let server:any;let output='';
 const start=async()=>{server=spawn(process.execPath,[serverRunner],{cwd:workspace,env:{...process.env,NODE_ENV:'production',PORT:String(port),FMS_DB_PATH:databasePath,FMS_STATIC_DIR:path.join(workspace,'dist'),FMS_SKIP_SEEDING:'true'},stdio:'pipe'});server.stdout.on('data',(c:any)=>output+=c);server.stderr.on('data',(c:any)=>output+=c);for(let i=0;i<100;i++){try{if((await fetch(`${base}/status`)).ok)return;}catch{}await delay(100);}throw new Error(output);};
 const stop=async()=>{if(server&&server.exitCode===null){server.kill();await Promise.race([new Promise(r=>server.once('exit',r)),delay(3000)]);}};
 const request=async(endpoint:string,options:RequestInit={},cookie?:string)=>{const response=await fetch(`${base}${endpoint}`,{...options,headers:{'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(options.headers||{})}});return{response,body:await response.json().catch(()=>null)};};
 const login=async(identifier:string,pin:string)=>{const x=await request('/auth/verify-pin',{method:'POST',body:JSON.stringify({identifier,pin})});return x.response.headers.get('set-cookie')?.split(';')[0];};
 try{
  await start();await request('/users',{method:'POST',body:JSON.stringify({name:'Phase Three Super',username:'phase3-super',email:'phase3-super@test.local',phone:'0700',pin:'1234'})});
  const db=new Database(databasePath);db.exec(`
   INSERT INTO station_settings (id,station_name,tax_pin,address,phone) VALUES ('station-1','Mapping Station','P000','Test','0700');
   INSERT INTO fuel_products (id,code,name,price_per_liter,cost_per_liter,tax_rate,tax_code,unit) VALUES ('prod-pms','PMS','PMS',1,1,0,'B','L'),('prod-ago','AGO','AGO',1,1,0,'B','L');
   INSERT INTO fuel_tanks (id,tank_name,fuel_product_id,fuel_name,capacity_liters,current_level_liters,reorder_level_liters,last_dip_reading) VALUES ('tank-1','Tank 1','prod-pms','PMS',1000,500,100,500);
   INSERT INTO pumps (id,pump_number,pump_name,status) VALUES ('pump-1',1,'Physical Pump 1','Active'),('pump-2',2,'Physical Pump 2','Active');
   INSERT INTO pump_nozzles (id,physical_pump_id,nozzle_number,nozzle_name,pump_number,pump_name,tank_id,fuel_product_id,fuel_name,opening_meter_reading,current_meter_reading,status) VALUES ('nozzle-1','pump-1',1,'Nozzle 1',1,'Physical Pump 1','tank-1','prod-pms','PMS',0,0,'Active'),('nozzle-2','pump-2',1,'Nozzle 1',2,'Physical Pump 2','tank-1','prod-pms','PMS',0,0,'Active');`);db.close();
  const superCookie=await login('phase3-super','1234');assert.ok(superCookie);
  const makeUser=async(username:string,pin:string)=>{const x=await request('/users',{method:'POST',body:JSON.stringify({name:username,username,email:`${username}@test.local`,phone:'0701',role:'Admin',pin})},superCookie);return x.body;};
  const manager=await makeUser('phase3-manager','2345');const viewer=await makeUser('phase3-viewer','3456');await makeUser('phase3-denied','4567');
  await request(`/users/${manager.id}/permissions`,{method:'PUT',body:JSON.stringify({permissions:['VIEW_AUTOMATION','MANAGE_CONTROLLERS','VIEW_DEVICE_MAPPINGS','MANAGE_DEVICE_MAPPINGS','VIEW_AUDIT_TRAIL']})},superCookie);
  await request(`/users/${viewer.id}/permissions`,{method:'PUT',body:JSON.stringify({permissions:['VIEW_DEVICE_MAPPINGS']})},superCookie);
  const activate=async(identifier:string,assigned:string,replacement:string)=>{const initial=await login(identifier,assigned);assert.ok(initial);assert.equal((await request('/auth/change-pin',{method:'POST',body:JSON.stringify({currentPin:assigned,newPin:replacement})},initial)).response.status,200);return login(identifier,replacement);};
  const mc=await activate('phase3-manager','2345','2346'),vc=await activate('phase3-viewer','3456','3457'),dc=await activate('phase3-denied','4567','4568');
  assert.equal((await request('/automation/device-mappings',{},dc)).response.status,403);assert.equal((await request('/automation/device-mappings',{},vc)).response.status,200);assert.equal((await request('/automation/device-mappings/discover/x',{method:'POST'},vc)).response.status,403);
  const controllerInput={stationId:'station-1',name:'Discovery Simulator',controllerType:'SIMULATOR',host:null,port:null,connectionType:'SIMULATOR',timeoutMs:5000,configuration:{simulatorMode:'SUCCESS'},capabilities:[],firmwareVersion:null};
  const controller=(await request('/automation/controllers',{method:'POST',body:JSON.stringify(controllerInput)},mc)).body;assert.ok(controller.id);
  const discovered=await request(`/automation/device-mappings/discover/${controller.id}`,{method:'POST'},mc);assert.equal(discovered.response.status,200);for(const type of ['PUMP','NOZZLE','TANK','PRODUCT'])assert.ok(discovered.body.some((d:any)=>d.equipment_type===type));
  const map=async(equipmentType:string,externalEquipmentId:string,targetId:string,externalParentId='')=>request('/automation/device-mappings',{method:'POST',body:JSON.stringify({controllerId:controller.id,equipmentType,externalEquipmentId,externalParentId,targetId})},mc);
  assert.equal((await map('PRODUCT','PMS','prod-pms')).response.status,201);const pumpMap=await map('PUMP','PUMP-01','pump-1');assert.equal(pumpMap.response.status,201);assert.equal((await map('NOZZLE','PUMP-01-N1','nozzle-1','PUMP-01')).response.status,201);assert.equal((await map('TANK','TANK-01','tank-1')).response.status,201);
  assert.equal((await map('PUMP','PUMP-02','pump-1')).response.status,409);assert.equal((await map('NOZZLE','PUMP-01-N2','nozzle-2','PUMP-01')).response.status,400);assert.equal((await map('TANK','TANK-99','tank-1')).response.status,400);
  assert.equal((await request('/automation/device-mappings/validate',{method:'POST',body:JSON.stringify({controllerId:controller.id,stationId:'wrong-station',equipmentType:'PUMP',externalEquipmentId:'PUMP-02',externalParentId:'',targetId:'pump-2'})},mc)).response.status,400);
  assert.equal((await request(`/automation/device-mappings/${pumpMap.body.id}/disable`,{method:'POST'},mc)).body.status,'DISABLED');assert.equal((await request(`/automation/device-mappings/${pumpMap.body.id}/restore`,{method:'POST'},mc)).body.status,'MAPPED');
  const history=await request(`/automation/device-mappings/${pumpMap.body.id}/history`,{},vc);assert.ok(history.body.some((h:any)=>h.action==='DISABLED'));assert.ok(history.body.some((h:any)=>h.action==='RESTORED'));
  const topology=await request('/automation/device-mappings/equipment?stationId=station-1',{},vc);assert.equal(topology.body.pumps.length,2);assert.equal(topology.body.pumps[0].nozzles[0].product_code,'PMS');assert.equal(topology.body.pumps[1].mapping,null);assert.equal(topology.body.pumps[0].connectionStatus,'UNKNOWN');
  const audits=await request('/audit-logs?page=1&pageSize=100&module=Automation',{},mc);assert.ok(audits.body.records.some((a:any)=>a.action==='MAPPING_CREATED'));
  await stop();await start();const after=await login('phase3-manager','2346');const persisted=await request('/automation/device-mappings',{},after);assert.ok(persisted.body.some((m:any)=>m.external_equipment_id==='PUMP-01'&&m.status==='MAPPED'));
  const check=new Database(databasePath,{readonly:true});assert.equal(check.pragma('integrity_check',{simple:true}),'ok');assert.equal(check.pragma('foreign_key_check').length,0);assert.equal((check.prepare('SELECT COUNT(*) count FROM pumps').get() as any).count,2);check.close();
 }finally{await stop();try{rmSync(directory,{recursive:true,force:true});}catch{}}
});
