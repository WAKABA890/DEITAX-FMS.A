import Database from 'better-sqlite3';
import { CredentialVault } from '../src/automation/security/credential-vault.ts';
import { Pts2Adapter } from '../src/automation/adapters/pts2-adapter.ts';

const [databasePath,keyPath]=process.argv.slice(2);
if(!databasePath||!keyPath)throw new Error('Database and credential key paths are required.');
const db=new Database(databasePath,{readonly:true});
try{
  const controller=db.prepare(`SELECT * FROM automation_controllers WHERE adapter_type='PTS2' AND enabled=1 ORDER BY updated_at DESC LIMIT 1`).get() as any;
  if(!controller)throw new Error('No enabled PTS-2 controller was found.');
  const mappings=db.prepare(`SELECT external_parent_id,external_equipment_id FROM automation_device_mappings WHERE controller_id=? AND equipment_type='NOZZLE' AND status='MAPPED' ORDER BY external_parent_id,external_equipment_id`).all(controller.id) as any[];
  const mapped=mappings.flatMap(mapping=>{const pump=String(mapping.external_parent_id||''),externalNozzleId=String(mapping.external_equipment_id||''),match=externalNozzleId.match(/^(\d+)\.(\d+)$/);return match&&match[1]===pump?[{externalPumpId:pump,externalNozzleId,nozzleNumber:Number(match[2])}]:[];});
  if(!mapped.length)throw new Error('No valid mapped PTS-2 nozzles were found.');
  const tankMappings=db.prepare(`SELECT external_equipment_id FROM automation_device_mappings WHERE controller_id=? AND equipment_type='TANK' AND status='MAPPED' ORDER BY external_equipment_id`).all(controller.id) as any[];
  const mappedTanks=tankMappings.flatMap(mapping=>{const id=String(mapping.external_equipment_id||'').trim();return /^\d+$/.test(id)?[{externalTankId:id,probeNumber:Number(id)}]:[];});
  const configuration={...JSON.parse(controller.configuration_json||'{}'),host:controller.host,port:controller.port,connectionType:controller.connection_type,timeoutMs:controller.timeout_ms,totalizerPollIntervalMs:60000,__credential:new CredentialVault(db,keyPath).get(controller.id)};
  const events:any[]=[],logs:any[]=[];
  const adapter=new Pts2Adapter();
  await adapter.initialize({controllerId:controller.id,configuration,getMappedNozzles:()=>mapped,getMappedTanks:()=>mappedTanks,emit:async event=>{if(event.eventType==='TOTALIZER_READING_RECEIVED'||event.eventType==='ATG_TANK_READING')events.push(event);},log:(level,category,message,details)=>logs.push({level,category,message,details})});
  await adapter.connect();const discovered=await adapter.discoverDevices();await adapter.shutdown();
  const totalizers=events.filter(event=>event.eventType==='TOTALIZER_READING_RECEIVED'),atg=events.filter(event=>event.eventType==='ATG_TANK_READING');
  if(!totalizers.length)throw new Error(`No live totalizer response was received. ${JSON.stringify(logs.filter(log=>log.category==='PTS2_TOTALIZER_SYNC'))}`);
  process.stdout.write(JSON.stringify({controllerId:controller.id,mappedNozzles:mapped.length,mappedTanks:mappedTanks.length,discoveredTanks:discovered.filter(device=>device.equipmentType==='TANK').map(device=>({externalTankId:device.externalEquipmentId,productExternalId:device.productExternalId,metadata:device.metadata})),totalizers:totalizers.map(event=>({externalPumpId:event.payload.externalPumpId,externalNozzleId:event.externalDeviceId,totalizerValue:event.payload.totalizerValue,unit:event.payload.unit,transactionNumber:event.payload.transactionNumber,source:event.source,receivedAt:event.receivedAt})),atg:atg.map(event=>({externalTankId:event.externalDeviceId,probeId:event.payload.probeId,status:event.payload.probeStatus,sourceOccurredAt:event.sourceOccurredAt,level:event.payload.level??null,levelUnit:event.payload.levelUnit??null,volume:event.payload.volume??null,volumeUnit:event.payload.volumeUnit??null,temperature:event.payload.temperature??null,temperatureUnit:event.payload.temperatureUnit??null,waterLevel:event.payload.waterLevel??null,waterLevelUnit:event.payload.waterLevelUnit??null,alarms:event.payload.alarms,source:event.source,receivedAt:event.receivedAt})),atgLogs:logs.filter(log=>log.category==='PTS2_ATG_SYNC')},null,2));
}finally{db.close();}
