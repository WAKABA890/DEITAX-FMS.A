import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { CredentialVault } from '../src/automation/security/credential-vault.ts';
import { Pts2Adapter } from '../src/automation/adapters/pts2-adapter.ts';

test('PTS-2 credentials stay encrypted and mapped totalizer/ATG reads follow the documented protocol',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pts2-readonly-')),db=new Database(':memory:');
  db.exec(`CREATE TABLE automation_controllers(id TEXT PRIMARY KEY,credential_ref TEXT,updated_at TEXT);CREATE TABLE automation_controller_credentials(id TEXT PRIMARY KEY,controller_id TEXT UNIQUE NOT NULL,ciphertext TEXT NOT NULL,iv TEXT NOT NULL,auth_tag TEXT NOT NULL,algorithm TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);INSERT INTO automation_controllers(id)VALUES('c1')`);
  const vault=new CredentialVault(db,path.join(dir,'key'));
  vault.set('c1',{username:'operator',password:'secret-value',authenticationType:'BASIC'});
  assert.ok(!(db.prepare('SELECT ciphertext FROM automation_controller_credentials').get() as any).ciphertext.includes('secret-value'));
  const allowed=new Set(['GetUniqueIdentifier','GetControllerType','GetDateTime','GetConfigurationIdentifier','ReportGetPumpTransactions','PumpGetLastSavedTotals','ProbeGetMeasurements','GetPumpsConfiguration','GetPumpNozzlesConfiguration','GetFuelGradesConfiguration','GetTanksConfiguration','GetProbesConfiguration']),seen:string[]=[],events:any[]=[];
  const server=http.createServer((req,res)=>{let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{const body=JSON.parse(raw),packets=body.Packets.map((packet:any)=>{assert.ok(allowed.has(packet.Type),`Unexpected non-read request ${packet.Type}`);seen.push(packet.Type);if(packet.Type==='PumpGetLastSavedTotals')return{Id:packet.Id,Type:'PumpLastSavedTotals',Data:{Pump:1,Nozzle:1,FuelGradeId:1,FuelGradeName:'Diesel',Volume:12345.678,Amount:2345678.9,Transaction:44,User:'operator'}};if(packet.Type==='ProbeGetMeasurements')return{Id:packet.Id,Type:'ProbeMeasurements',Data:{Probe:1,DateTime:'2026-09-08T10:00:00',FuelGradeId:1,FuelGradeName:'Diesel',Status:'OK',ProductHeight:1250.5,ProductVolumeFloat:9876.54,Temperature:24.1}};if(packet.Type==='ReportGetPumpTransactions')return{Id:packet.Id,Type:'ReportPumpTransactions',Data:[]};const type=packet.Type.replace(/^Get/,'');const data=packet.Type==='GetUniqueIdentifier'?{Id:'ABC123'}:packet.Type==='GetConfigurationIdentifier'?{Id:'CF01'}:packet.Type==='GetPumpsConfiguration'?{Pumps:[{Id:1}]}:packet.Type==='GetPumpNozzlesConfiguration'?{PumpNozzles:[{PumpId:1,FuelGradeIds:[1]}]}:packet.Type==='GetFuelGradesConfiguration'?{FuelGrades:[{Id:1,Name:'Diesel'}]}:packet.Type==='GetTanksConfiguration'?{Tanks:[{Id:1,FuelGradeId:1,Height:3000}]}:packet.Type==='GetProbesConfiguration'?{Probes:[{Id:1,Port:'USER',Address:1}]}:{};return{Id:packet.Id,Type:type,Data:data};});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({Protocol:'jsonPTS',Packets:packets}));});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const adapter=new Pts2Adapter();await adapter.initialize({controllerId:'c1',configuration:{host:'127.0.0.1',port:(server.address() as any).port,connectionType:'HTTP',timeoutMs:2000,__credential:vault.get('c1')},getMappedNozzles:()=>[{externalPumpId:'1',externalNozzleId:'1.1',nozzleNumber:1}],getMappedTanks:()=>[{externalTankId:'1',probeNumber:1}],emit:async event=>{events.push(event);},log:()=>{}});await adapter.connect();assert.equal(adapter.getStatus(),'CONNECTED');const discovered=await adapter.discoverDevices();assert.equal(discovered.length,4);assert.equal(discovered.find(x=>x.equipmentType==='TANK')?.metadata?.probeConfigured,true);assert.deepEqual(seen.filter(type=>type==='PumpGetLastSavedTotals'),['PumpGetLastSavedTotals']);const totalizer=events.find(x=>x.eventType==='TOTALIZER_READING_RECEIVED'),atg=events.find(x=>x.eventType==='ATG_TANK_READING');assert.equal(totalizer.payload.totalizerValue,12345.678);assert.equal(totalizer.sourceSequence,null);assert.equal(totalizer.payload.sequenceUnavailable,true);assert.match(totalizer.eventId,/^pts2-totalizer:[a-f0-9]{64}$/);assert.equal(atg.payload.volume,9876.54);assert.equal(atg.payload.level,1250.5);assert.equal(atg.payload.temperature,24.1);assert.equal(atg.payload.waterLevel,undefined);assert.equal(atg.sourceOccurredAt,new Date('2026-09-08T10:00:00').toISOString());assert.match(atg.eventId,/^pts2-atg:[a-f0-9]{64}$/);assert.ok(seen.every(type=>allowed.has(type)));await adapter.shutdown();}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));db.close();rmSync(dir,{recursive:true,force:true});}
});

test('PTS-2 totalizer polling never overlaps one pump and ignores unmapped nozzles',async()=>{
  const seen:string[]=[];
  const server=http.createServer((req,res)=>{let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{const body=JSON.parse(raw),packets=body.Packets.map((packet:any)=>{seen.push(packet.Type+':'+String(packet.Data?.Nozzle??''));if(packet.Type==='PumpGetLastSavedTotals'){assert.equal(body.Protocol,'jsonPTS');assert.equal(packet.Data.Pump,1);assert.ok(Number.isInteger(packet.Id));return{Id:packet.Id,Type:'PumpLastSavedTotals',Data:{Pump:1,Nozzles:[{Nozzle:3,Volume:999},{Nozzle:2,Volume:200},{Nozzle:1,Volume:100}]}};}if(packet.Type==='ReportGetPumpTransactions')return{Id:packet.Id,Type:'ReportPumpTransactions',Data:[]};return{Id:packet.Id,Type:packet.Type.replace(/^Get/,''),Data:{}};});res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({Protocol:'jsonPTS',Packets:packets}));});});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{const adapter=new Pts2Adapter(),events:any[]=[];await adapter.initialize({controllerId:'c',configuration:{host:'127.0.0.1',port:(server.address() as any).port,connectionType:'HTTP',timeoutMs:2000,__credential:{username:'u',password:'p'}},getMappedNozzles:()=>[{externalPumpId:'1',externalNozzleId:'1.1',nozzleNumber:1},{externalPumpId:'1',externalNozzleId:'1.2',nozzleNumber:2}],emit:async event=>{events.push(event);},log:()=>{}});await adapter.connect();assert.deepEqual(seen.filter(x=>x.startsWith('Pump')),['PumpGetLastSavedTotals:1','PumpGetLastSavedTotals:2']);assert.equal(events.length,2);assert.deepEqual(events.map(event=>[event.externalDeviceId,event.payload.totalizerValue]),[['1.1',100],['1.2',200]]);await adapter.shutdown();}finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('saved-total configuration errors fall back to live totals without changing controller configuration',async()=>{
  const seen:string[]=[],events:any[]=[];let configuredError=true,statusCalls=0;
  const server=http.createServer((req,res)=>{let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
    const body=JSON.parse(raw),packets=body.Packets.map((packet:any)=>{
      seen.push(packet.Type);
      if(packet.Type==='PumpGetLastSavedTotals')return{Id:packet.Id,Type:packet.Type,Error:true,Message:configuredError?'JSONPTS_ERROR_AUTOREAD_PUMPS_TOTALS_NOT_CONFIGURED':'OTHER_ERROR'};
      if(packet.Type==='PumpGetTotals'){assert.deepEqual(packet.Data,{Pump:1,Nozzle:2});return{Id:packet.Id,Type:packet.Type,Message:'OK'};}
      if(packet.Type==='PumpGetStatus'){statusCalls++;return{Id:packet.Id,Type:'PumpTotals',Data:{Pump:1,Nozzle:statusCalls===1?1:2,Volume:456.789}};}
      if(packet.Type==='ReportGetPumpTransactions')return{Id:packet.Id,Type:'ReportPumpTransactions',Data:[]};
      return{Id:packet.Id,Type:packet.Type.replace(/^Get/,''),Data:{}};
    });
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({Protocol:'jsonPTS',Packets:packets}));
  });});
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const adapter=new Pts2Adapter();
  try{
    await adapter.initialize({controllerId:'c',configuration:{host:'127.0.0.1',port:(server.address() as any).port,timeoutMs:2000,totalizerStatusPollMs:100,__credential:{username:'u',password:'p'}},getMappedNozzles:()=>[{externalPumpId:'1',externalNozzleId:'1.2',nozzleNumber:2}],emit:async event=>{events.push(event);},log:()=>{}});
    await adapter.connect();assert.equal(events.length,1);assert.equal(events[0].payload.totalizerValue,456.789);assert.equal(events[0].payload.meterReadMethod,'PumpGetTotals');
    assert.deepEqual(seen.filter(type=>type.startsWith('Pump')),['PumpGetLastSavedTotals','PumpGetTotals','PumpGetStatus','PumpGetStatus']);
    configuredError=false;const liveCount=seen.filter(type=>type==='PumpGetTotals').length;
    await assert.rejects(()=>adapter.refreshTotalizers(),/OTHER_ERROR/);
    assert.equal(seen.filter(type=>type==='PumpGetTotals').length,liveCount);
    assert.ok(seen.every(type=>!type.startsWith('Set')&&!type.includes('Authorize')));
  }finally{await adapter.shutdown();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
