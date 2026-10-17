import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { buildSync } from 'esbuild';
import { AutomatedFuelTransactionEngine } from '../src/automation/transactions/fuel-transaction-engine.ts';
import { AdapterManager } from '../src/automation/adapters/adapter-manager.ts';
import { AdapterRegistry } from '../src/automation/adapters/adapter-registry.ts';
import { Pts2Adapter } from '../src/automation/adapters/pts2-adapter.ts';
import { CredentialVault } from '../src/automation/security/credential-vault.ts';
import { buildOpeningNozzleReadings, buildClosingNozzleReadings } from '../src/utils/shift-meter-readings.ts';

test('PTS-2 opening, per-transaction and closing snapshots use hardware meters without synthetic increments',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'pts2-shift-meter-'));
  const runnerDir=mkdtempSync(path.join(process.cwd(),'build','pts2-shift-'));
  const file=path.join(dir,'test.db'),runner=path.join(runnerDir,'migrate.mjs');
  const priorKey=process.env.FMS_AUTOMATION_CREDENTIAL_KEY_PATH;
  process.env.FMS_AUTOMATION_CREDENTIAL_KEY_PATH=path.join(dir,'key');
  let db:Database.Database|undefined,manager:AdapterManager|undefined;
  let app:ReturnType<typeof spawn>|undefined;
  let volume=1000,failed=false,reads=0,activeReads=0,maxActiveReads=0;
  const sales:any[]=[],metersAtRequest:number[]=[];
  const mock=http.createServer((req,res)=>{let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{
    const body=JSON.parse(raw);assert.equal(body.Protocol,'jsonPTS');
    const packets=body.Packets.map((packet:any)=>{
      if(packet.Type==='PumpGetLastSavedTotals'){
        assert.deepEqual(packet.Data,{Pump:1,Nozzle:1});reads++;activeReads++;maxActiveReads=Math.max(maxActiveReads,activeReads);
        metersAtRequest.push(Number((db!.prepare("SELECT current_meter_reading v FROM pump_nozzles WHERE id='n'").get() as any).v));
        return failed?{Id:packet.Id,Type:packet.Type,Error:true,Message:'DATA_NOT_READY'}:{Id:packet.Id,Type:'PumpLastSavedTotals',Data:{Pump:1,Nozzles:[{Nozzle:2,Volume:999999},{Nozzle:1,Volume:volume,Amount:volume*100}]}};
      }
      if(packet.Type==='ReportGetPumpTransactions')return{Id:packet.Id,Type:'ReportPumpTransactions',Data:sales};
      return{Id:packet.Id,Type:packet.Type.replace(/^Get/,''),Data:{}};
    });
    setTimeout(()=>{if(body.Packets.some((packet:any)=>packet.Type==='PumpGetLastSavedTotals'))activeReads--;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({Protocol:'jsonPTS',Packets:packets}));},5);
  });});
  try{
    buildSync({entryPoints:['scripts/db-validate-target.ts'],outfile:runner,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
    const migrated=spawnSync(process.execPath,[runner],{env:{...process.env,FMS_DB_PATH:file,FMS_SKIP_SEEDING:'true'},encoding:'utf8'});
    assert.equal(migrated.status,0,migrated.stdout+migrated.stderr);
    db=new Database(file);db.pragma('foreign_keys=ON');
    db.exec(`INSERT INTO station_settings(id,station_name,tax_pin,address,phone) VALUES('station-1','Test','P000','Test','0700');
      INSERT INTO fuel_products(id,code,name,price_per_liter,cost_per_liter,tax_rate,tax_code,unit,color) VALUES('product','PMS','Petrol',100,90,0.16,'B','L','#fff');
      INSERT INTO fuel_tanks(id,tank_name,fuel_product_id,fuel_name,capacity_liters,current_level_liters,reorder_level_liters,last_dip_reading) VALUES('tank','Tank','product','PMS',10000,6000,1000,6000);
      INSERT INTO pumps(id,pump_number,pump_name,status) VALUES('pump',1,'Pump','Active');
      INSERT INTO pump_nozzles(id,physical_pump_id,nozzle_number,nozzle_name,pump_number,pump_name,tank_id,fuel_product_id,fuel_name,opening_meter_reading,current_meter_reading,status) VALUES('n','pump',1,'Nozzle',1,'Pump','tank','product','PMS',500,500,'Active');
      INSERT INTO automation_controllers(id,station_id,name,adapter_type,connection_type,status,enabled,host,port,timeout_ms,configuration_json) VALUES('c','station-1','PTS2','PTS2','HTTP','ONLINE',1,'127.0.0.1',1,2000,'{"salesPollIntervalMs":3600000,"totalizerPollIntervalMs":3600000,"atgPollIntervalMs":3600000}');
      INSERT INTO automation_device_mappings(id,controller_id,equipment_type,external_parent_id,external_equipment_id,pump_id,status) VALUES('pm','c','PUMP','','1','pump','MAPPED');
      INSERT INTO automation_device_mappings(id,controller_id,equipment_type,external_parent_id,external_equipment_id,nozzle_id,status) VALUES('nm','c','NOZZLE','1','1.1','n','MAPPED');`);
    db.exec("INSERT INTO automation_device_mappings(id,controller_id,equipment_type,external_parent_id,external_equipment_id,product_id,status) VALUES('product-map','c','PRODUCT','','1','product','MAPPED')");
    await new Promise<void>(resolve=>mock.listen(0,'127.0.0.1',resolve));
    db.prepare("UPDATE automation_controllers SET port=? WHERE id='c'").run((mock.address() as any).port);
    new CredentialVault(db).set('c',{username:'test',password:'test',authenticationType:'BASIC'});
    class Registry extends AdapterRegistry{adapter=new Pts2Adapter();create(){return this.adapter;}}
    const registry=new Registry();manager=new AdapterManager(db,registry);await manager.start('c');
    const meter=()=>Number((db!.prepare("SELECT current_meter_reading v FROM pump_nozzles WHERE id='n'").get() as any).v);
    const opening=await manager.captureNozzleMeters(['n']);assert.equal(opening.get('n'),1000);
    const firstReading=(db.prepare("SELECT current_reading_id id FROM automation_meter_current_state WHERE nozzle_id='n'").get() as any).id;
    await Promise.all([manager.captureNozzleMeters(['n']),manager.captureNozzleMeters(['n'])]);
    assert.notEqual((db.prepare("SELECT current_reading_id id FROM automation_meter_current_state WHERE nozzle_id='n'").get() as any).id,firstReading);
    assert.equal(maxActiveReads,1);assert.equal(meter(),1000);
    assert.equal((db.prepare("SELECT COUNT(*) c FROM automation_meter_readings WHERE anomaly_classification IS NOT NULL").get() as any).c,0);
    const now=new Date(),pad=(n:number)=>String(n).padStart(2,'0');
    const dateTime=`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    sales.push({Pump:1,Nozzle:1,FuelGradeId:1,FuelGradeName:'Petrol',Volume:5,Price:100,Amount:500,Transaction:1,DateTime:dateTime});
    volume=1005;const beforeReads=reads;await registry.adapter.refreshTransactions();
    assert.equal(reads,beforeReads+1);assert.equal(metersAtRequest.at(-1),1000);assert.equal(meter(),1005);
    assert.equal((db.prepare('SELECT COUNT(*) c FROM transactions').get() as any).c,1);
    const firstSale=db.prepare('SELECT * FROM transactions').get() as any;
    assert.equal(firstSale.status,'Completed');assert.equal(firstSale.document_type,'Receipt');
    assert.match(firstSale.receipt_number,/^Rcpt-\d{4}-\d+$/);
    assert.equal(firstSale.quantity,5);assert.equal(firstSale.unit_price,100);assert.equal(firstSale.total_amount,500);
    assert.equal(firstSale.dispensed_without_shift,1);assert.equal(firstSale.attendant_id,null);
    await registry.adapter.refreshTransactions();assert.equal((db.prepare('SELECT receipt_number FROM transactions WHERE id=?').get(firstSale.id) as any).receipt_number,firstSale.receipt_number);
    assert.equal(reads,beforeReads+1);assert.equal(meter(),1005);
    sales.push({...sales[0],Volume:3,Amount:300,Transaction:2});volume=1008;
    const closing=await manager.captureNozzleMeters(['n']);assert.equal(closing.get('n'),1008);
    const transactions=(db.prepare('SELECT * FROM transactions').all() as any[]).map(tx=>({shiftId:'shift',nozzleId:tx.nozzle_id,source:tx.source,status:tx.status,items:JSON.parse(tx.items_json)}));
    const result=buildClosingNozzleReadings([{pumpId:'n',openingMeter:opening.get('n')}],[{pumpId:'n',openingMeter:0,closingMeter:1,posSalesLiters:999}],closing,transactions,'shift')[0];
    assert.equal(result.openingMeter,1000);assert.equal(result.closingMeter,1008);assert.equal(result.meterSalesLiters,8);assert.equal(result.posSalesLiters,8);assert.equal(result.varianceLiters,0);
    volume=1010;failed=true;
    await assert.rejects(()=>manager!.captureNozzleMeters(['n']),/DATA_NOT_READY/);assert.equal(meter(),1008);
    sales.push({...sales[0],Volume:2,Amount:200,Transaction:3});await registry.adapter.refreshTransactions();
    assert.equal((db.prepare('SELECT COUNT(*) c FROM transactions').get() as any).c,3);assert.equal(meter(),1008);
    failed=false;assert.equal((await manager.captureNozzleMeters(['n'])).get('n'),1010);
    volume=900;assert.equal((await manager.captureNozzleMeters(['n'])).get('n'),900);assert.equal(meter(),900);assert.equal((db.prepare("SELECT last_anomaly FROM automation_meter_current_state WHERE nozzle_id='n'").get() as any).last_anomaly,'METER_RESET');
    await manager.disconnect('c');await assert.rejects(()=>manager!.captureNozzleMeters(['n']),/unavailable/);
    assert.deepEqual(await manager.captureNozzleMeters(['manual']),new Map());
    await manager.shutdown();
    // Existing validated pending captures are upgraded once without changing their evidence/amounts.
    const legacy=db.prepare('SELECT id FROM transactions ORDER BY id LIMIT 1').get() as any;
    db.prepare("UPDATE transactions SET status='Payment Pending',document_type='Automation Capture',receipt_number=NULL WHERE id=?").run(legacy.id);
    const engine=new AutomatedFuelTransactionEngine(db);
    assert.equal(engine.completePendingPts2Receipts(),1);const upgraded=(db.prepare('SELECT receipt_number FROM transactions WHERE id=?').get(legacy.id) as any).receipt_number;
    assert.equal(engine.completePendingPts2Receipts(),0);assert.equal((db.prepare('SELECT receipt_number FROM transactions WHERE id=?').get(legacy.id) as any).receipt_number,upgraded);

    // Exercise the actual shift and sale endpoints with stale browser inputs.
    volume=1200;
    const appRunner=path.join(runnerDir,'server.mjs');
    buildSync({entryPoints:['server.ts'],outfile:appRunner,bundle:true,platform:'node',format:'esm',packages:'external',logLevel:'silent'});
    const reservation=http.createServer();await new Promise<void>(resolve=>reservation.listen(0,'127.0.0.1',resolve));
    const port=(reservation.address() as any).port;await new Promise<void>(resolve=>reservation.close(()=>resolve()));
    let output='';
    app=spawn(process.execPath,[appRunner],{env:{...process.env,PORT:String(port),NODE_ENV:'production',FMS_DB_PATH:file,FMS_SKIP_SEEDING:'true',FMS_AUTOMATION_ENABLED:'true',FMS_STATIC_DIR:path.join(process.cwd(),'dist')},stdio:'pipe'});
    app.stdout?.on('data',chunk=>{output+=chunk;});app.stderr?.on('data',chunk=>{output+=chunk;});
    const base=`http://127.0.0.1:${port}/api`;
    for(let attempt=0;attempt<200;attempt++){
      try{if((await fetch(base+'/status')).ok)break;}catch{}
      assert.equal(app.exitCode,null,output);await new Promise(resolve=>setTimeout(resolve,100));
    }
    let cookie='';
    const request=async(url:string,body?:any)=>{
      const response=await fetch(base+url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});
      const data=await response.json();return{response,data};
    };
    assert.equal((await request('/tanks/dip',{tankId:'tank',dipReadingLiters:5900})).response.status,401);
    await request('/users',{name:'Shift Test',username:'shift-test',email:'shift@test.local',phone:'0700',pin:'1234'});
    const login=await request('/auth/verify-pin',{identifier:'shift-test',pin:'1234'});
    cookie=login.response.headers.get('set-cookie')?.split(';')[0]||'';assert.ok(cookie,JSON.stringify(login.data));
    const userId=login.data.user.id;
    const beforeDip=Number((db.prepare("SELECT current_level_liters v FROM fuel_tanks WHERE id='tank'").get() as any).v);
    const manualDip=await request('/tanks/dip',{tankId:'tank',dipValue:1010,dipUnit:'MM',volumeLiters:beforeDip,reason:'Test physical dip'});assert.equal(manualDip.response.status,200,JSON.stringify(manualDip.data));
    assert.equal((db.prepare('SELECT COUNT(*) n FROM manual_tank_dips').get() as any).n,1);
    assert.equal((db.prepare("SELECT current_level_liters v FROM fuel_tanks WHERE id='tank'").get() as any).v,beforeDip);
    const originalRole=(db.prepare('SELECT role FROM users WHERE id=?').get(userId) as any).role;
    db.prepare('UPDATE users SET role=? WHERE id=?').run('No Tank Permissions',userId);
    assert.equal((await request('/tanks/dip',{tankId:'tank',dipReadingLiters:beforeDip})).response.status,403);
    db.prepare('UPDATE users SET role=? WHERE id=?').run(originalRole,userId);

    const plan=await request('/shift-plans',{name:'Meter Test',shiftType:'Day',scheduledStart:new Date(Date.now()-60000).toISOString(),scheduledEnd:new Date(Date.now()+3600000).toISOString(),userIds:[userId]});
    assert.equal(plan.response.status,201,JSON.stringify(plan.data));
    const openBody={userId,pin:'1234',shiftPlanId:plan.data.id,openingCash:0,openingPumpReadings:[{pumpId:'n',openingMeter:50}],openingTankDips:[]};
    failed=true;const unavailable=await request('/shifts/clock-in',openBody);assert.equal(unavailable.response.status,503,JSON.stringify(unavailable.data));
    assert.equal((db.prepare('SELECT COUNT(*) c FROM shifts').get() as any).c,0);
    failed=false;const opened=await request('/shifts/clock-in',openBody);assert.equal(opened.response.status,200,JSON.stringify(opened.data));
    assert.equal(opened.data.openingPumpReadings[0].openingMeter,1200);
    assert.equal(opened.data.openingPumpReadings[0].variance,-1150);
    assert.equal(opened.data.openingPumpReadings[0].reportedOpeningMeter,50);
    const openingReview=(await request('/approvals')).data.find((review:any)=>review.shiftId===opened.data.id&&review.reviewScope==='READING');
    assert.ok(openingReview);
    const approve=async(id:string)=>request('/approvals/resolve',{approvalId:id,action:'Approved',managerId:userId,managerPin:'1234',notes:'Verified against physical controller evidence.'});
    assert.equal((await approve(openingReview.id)).response.status,200);
    assert.equal((db.prepare('SELECT status FROM shifts WHERE id=?').get(opened.data.id) as any).status,'Active');
    assert.equal(meter(),1200);
    assert.equal((db.prepare("SELECT current_reading FROM nozzle_reading_history WHERE reading_type='Opening'").get() as any).current_reading,1200);
    const live=await request('/pumps');assert.equal(live.data[0].meterSource,'PTS2');
    volume=1205;const manual=await request('/sales',{shiftId:opened.data.id,staffId:userId,staffName:'Shift Test',type:'Fuel',paymentMethod:'Cash',items:[{itemId:'product',nozzleId:'n',pumpId:'n',name:'Petrol',type:'Fuel',qty:5,unitPrice:100,taxCode:'B'}]});
    assert.equal(manual.response.status,200,JSON.stringify(manual.data)+output);assert.equal(meter(),1205);
    const closeBody={shiftId:opened.data.id,cashCount:{notes500:1},pumpReadings:[{pumpId:'n',openingMeter:0,closingMeter:2,posSalesLiters:999}],tankDips:[]};
    db.exec("CREATE TRIGGER reject_close_review BEFORE INSERT ON manager_approvals BEGIN SELECT RAISE(ABORT,'test approval save failure');END;");
    failed=true;const blockedClose=await request('/reconciliations',closeBody);assert.equal(blockedClose.response.status,500,JSON.stringify(blockedClose.data));
    assert.equal((db.prepare('SELECT COUNT(*) c FROM reconciliations WHERE shift_id=?').get(opened.data.id) as any).c,0);
    db.exec('DROP TRIGGER reject_close_review');
    assert.equal((db.prepare('SELECT status FROM shifts WHERE id=?').get(opened.data.id) as any).status,'Active');
    failed=false;volume=1211;
    const closingRequest=request('/reconciliations',closeBody);await request('/shifts');
    const closed=await closingRequest;assert.equal(closed.response.status,200,JSON.stringify(closed.data)+output);
    const saved=JSON.parse((db.prepare('SELECT closing_pump_readings_json FROM shifts WHERE id=?').get(opened.data.id) as any).closing_pump_readings_json)[0];
    assert.equal(saved.openingMeter,1200);assert.equal(saved.closingMeter,1211);assert.equal(saved.meterSalesLiters,11);assert.equal(saved.posSalesLiters,5);assert.equal(saved.varianceLiters,6);
    assert.notEqual((await request('/shifts')).data.find((shift:any)=>shift.id===opened.data.id).status,'Active');
    assert.equal((await request('/reconciliations',closeBody)).response.status,409);
    assert.equal(saved.reportedClosingMeter,2);assert.equal(saved.reportedVarianceLiters,-1209);
    const reviews=(await request('/approvals')).data.filter((review:any)=>review.shiftId===opened.data.id);
    const shiftReview=reviews.find((review:any)=>review.reviewScope==='SHIFT'&&review.type==='Shift Variance Review'&&review.status==='Pending');
    assert.ok(shiftReview);assert.equal(reviews.length,1);
    const resolvedShiftReview=await approve(shiftReview.id);
    assert.equal(resolvedShiftReview.response.status,200);assert.equal(resolvedShiftReview.data.status,'Approved');assert.equal(meter(),1211);
    const reconciledAfterApproval=(await request('/reconciliations')).data.find((record:any)=>record.shiftId===opened.data.id);
    const approvalAfterResolution=(await request('/approvals')).data.find((record:any)=>record.id===shiftReview.id);
    assert.equal(reconciledAfterApproval.status,'Approved');assert.equal(approvalAfterResolution.status,'Approved');assert.equal(approvalAfterResolution.shiftId,reconciledAfterApproval.shiftId);
    // A new sale occurs after clock-out and before the next user clocks in.
    await new Promise(resolve=>setTimeout(resolve,1100));
    const gapDate=new Date(),padGap=(value:number)=>String(value).padStart(2,'0');
    const gapTime=`${gapDate.getFullYear()}-${padGap(gapDate.getMonth()+1)}-${padGap(gapDate.getDate())}T${padGap(gapDate.getHours())}:${padGap(gapDate.getMinutes())}:${padGap(gapDate.getSeconds())}`;
    sales.push({...sales[0],Volume:7,Amount:700,Transaction:4,DateTime:gapTime});volume=1218;
    const nextPlan=await request('/shift-plans',{name:'Next Meter Test',shiftType:'Day',scheduledStart:new Date(Date.now()-60000).toISOString(),scheduledEnd:new Date(Date.now()+3600000).toISOString(),userIds:[userId]});
    assert.equal(nextPlan.response.status,201,JSON.stringify(nextPlan.data));
    const nextOpened=await request('/shifts/clock-in',{...openBody,shiftPlanId:nextPlan.data.id,openingPumpReadings:[{pumpId:'n',openingMeter:1218}]});
    assert.equal(nextOpened.response.status,200,JSON.stringify(nextOpened.data));
    const baseline=nextOpened.data.openingPumpReadings[0];
    assert.equal(baseline.openingMeter,1218);assert.equal(baseline.authoritativeOpeningMeter,1218);
    assert.equal(baseline.unattendedMeterLiters,7);assert.equal(baseline.unattendedSalesLiters,7);assert.equal(baseline.unattendedVarianceLiters,0);
    assert.equal(baseline.unattendedTransactionIds.length,1);
    const gapId=baseline.unattendedTransactionIds[0];
    let gapRecord=db.prepare('SELECT * FROM transactions WHERE id=?').get(gapId) as any;
    assert.equal(gapRecord.shift_id,null);assert.equal(gapRecord.dispensed_without_shift,1);assert.equal(gapRecord.meter_reconciliation_shift_id,nextOpened.data.id);
    assert.equal(gapRecord.status,'Completed');assert.equal(gapRecord.document_type,'Receipt');assert.match(gapRecord.receipt_number,/^Rcpt-/);
    const originalGapReceipt=gapRecord.receipt_number;
    const paidGap=await request('/sales/'+gapId+'/settle',{paymentMethod:'Cash'});
    assert.equal(paidGap.response.status,409,JSON.stringify(paidGap.data));
    gapRecord=db.prepare('SELECT * FROM transactions WHERE id=?').get(gapId) as any;
    assert.equal(gapRecord.shift_id,null);assert.equal(gapRecord.settlement_shift_id,null);assert.equal(gapRecord.meter_reconciliation_shift_id,nextOpened.data.id);
    assert.equal(gapRecord.receipt_number,originalGapReceipt);
    assert.equal(meter(),1218);
    volume=1221;
    const staffedSale=await request('/sales',{shiftId:nextOpened.data.id,staffId:userId,staffName:'Shift Test',type:'Fuel',paymentMethod:'Cash',items:[{itemId:'product',nozzleId:'n',pumpId:'n',name:'Petrol',type:'Fuel',qty:3,unitPrice:100,taxCode:'B'}]});
    assert.equal(staffedSale.response.status,200,JSON.stringify(staffedSale.data));
    const nextClose=await request('/reconciliations',{shiftId:nextOpened.data.id,cashCount:{notes1000:1},pumpReadings:[{pumpId:'n',closingMeter:1221}],tankDips:[]});
    assert.equal(nextClose.response.status,200,JSON.stringify(nextClose.data));
    const finalReading=nextClose.data.reconciliation.pumpReadings[0];
    assert.equal(finalReading.openingMeter,1218);assert.equal(finalReading.closingMeter,1221);
    assert.equal(finalReading.meterSalesLiters,3);assert.equal(finalReading.posSalesLiters,3);assert.equal(finalReading.totalAssociatedSalesLiters,10);
    assert.equal(finalReading.unattendedSalesLiters,7);assert.equal(finalReading.staffedMeterLiters,3);assert.equal(finalReading.varianceLiters,0);
    assert.equal(nextClose.data.reconciliation.expectedCash,1000);assert.equal(nextClose.data.reconciliation.cashVariance,0);
    assert.equal(nextClose.data.shift.status,'Completed');

    const observed=await request('/pumps',{pumpNumber:1,pumpName:'Pump',nozzleConfigs:[{nozzleNumber:1,nozzleName:'Nozzle',tankId:'tank',openingMeterReading:99}]});
    assert.equal(observed.response.status,200,JSON.stringify(observed.data));assert.equal(meter(),1221);
    assert.equal((db.prepare("SELECT current_reading FROM nozzle_reading_history WHERE reading_type='Observation' ORDER BY timestamp DESC LIMIT 1").get() as any).current_reading,99);
    const configReview=(await request('/approvals')).data.find((review:any)=>review.reviewScope==='READING'&&!review.shiftId&&review.status==='Pending');
    assert.ok(configReview);assert.equal((await approve(configReview.id)).response.status,200);assert.equal(meter(),1221);
    // Reset and offline readings close the shift; evidence and approval remain durable.
    for(const scenario of ['reset','offline','small-variance']){
      failed=false;
      const plan=await request('/shift-plans',{name:'Close '+scenario,shiftType:'Day',scheduledStart:new Date(Date.now()-60000).toISOString(),scheduledEnd:new Date(Date.now()+3600000).toISOString(),userIds:[userId]});
      assert.equal(plan.response.status,201,JSON.stringify(plan.data));
      const openedReview=await request('/shifts/clock-in',{...openBody,shiftPlanId:plan.data.id,openingPumpReadings:[]});
      assert.equal(openedReview.response.status,200,JSON.stringify(openedReview.data));
      if(scenario==='reset')volume=100;
      if(scenario==='offline')failed=true;
      const response=await request('/reconciliations',{shiftId:openedReview.data.id,cashCount:{coins:0.01},pumpReadings:[],tankDips:[{tankId:'tank',openingDip:6000,closingDip:5999.999,actualSales:0}]});
      assert.equal(response.response.status,200,JSON.stringify(response.data));
      assert.equal(response.data.shift.status,'Pending Approval');assert.ok(response.data.shift.endTime);
      assert.equal((db.prepare('SELECT current_shift_id FROM users WHERE id=?').get(userId) as any).current_shift_id,null);
      const review=(await request('/approvals')).data.find((a:any)=>a.shiftId===openedReview.data.id&&a.reviewScope==='SHIFT'&&a.type==='Shift Variance Review');
      assert.ok(review);assert.equal(review.status,'Pending');
      assert.match(review.reason,/0.01/);assert.match(review.reason,/0.001/);
      const evidence=response.data.reconciliation.pumpReadings[0];
      if(scenario==='reset'){assert.equal(evidence.closingMeter,100);assert.equal(evidence.meterSalesLiters,null);assert.equal(evidence.meterIssue,'METER_RESET_OR_DECREASE');}
      if(scenario==='offline'){assert.equal(evidence.closingMeter,null);assert.equal(evidence.meterSalesLiters,null);assert.equal(evidence.meterIssue,'METER_UNAVAILABLE');}
      const retry=await request('/reconciliations',{shiftId:openedReview.data.id,cashCount:{},pumpReadings:[],tankDips:[]});
      assert.equal(retry.response.status,409);
      assert.equal((db.prepare('SELECT COUNT(*) c FROM reconciliations WHERE shift_id=?').get(openedReview.data.id) as any).c,1);
    }
    assert.equal(db.pragma('foreign_key_check').length,0);
  }finally{
    if(app&&app.exitCode===null){const exited=new Promise(resolve=>app!.once('exit',resolve));app.kill();await exited;}
    await manager?.shutdown();await new Promise<void>(resolve=>mock.close(()=>resolve()));db?.close();
    if(priorKey===undefined)delete process.env.FMS_AUTOMATION_CREDENTIAL_KEY_PATH;else process.env.FMS_AUTOMATION_CREDENTIAL_KEY_PATH=priorKey;
    rmSync(dir,{recursive:true,force:true});rmSync(runnerDir,{recursive:true,force:true});
  }
});

test('closing reconciliation retains meter-sales discrepancies and requires valid readings',()=>{
  const openings=[{pumpId:'n',openingMeter:100}];
  const tx=[{shiftId:'s',status:'Completed',items:[{type:'Fuel',nozzleId:'n',qty:5}]}];
  const result=buildClosingNozzleReadings(openings,[{pumpId:'n',closingMeter:110,posSalesLiters:10}],new Map([['n',110]]),tx,'s')[0];
  assert.equal(result.varianceLiters,5);
  assert.throws(()=>buildClosingNozzleReadings(openings,[],new Map(),tx,'s'),/Invalid system closing/);
  assert.throws(()=>buildClosingNozzleReadings(openings,[],new Map([['n',99]]),tx,'s'),/Invalid system closing/);
});
