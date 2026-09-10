import Database from 'better-sqlite3';
import { AdapterManager } from '../src/automation/adapters/adapter-manager.ts';

const [databasePath,keyPath]=process.argv.slice(2);
if(!databasePath||!keyPath)throw new Error('Validation database and credential key paths are required.');
process.env.FMS_DB_PATH=databasePath;process.env.FMS_AUTOMATION_CREDENTIAL_KEY_PATH=keyPath;
const db=new Database(databasePath);db.pragma('foreign_keys=ON');db.pragma('busy_timeout=10000');
try{
  const controller=db.prepare(`SELECT id FROM automation_controllers WHERE adapter_type='PTS2' AND enabled=1 ORDER BY updated_at DESC LIMIT 1`).get() as any;
  if(!controller)throw new Error('No enabled PTS-2 controller was found.');
  const before={atg:(db.prepare(`SELECT COUNT(*) count FROM automation_atg_readings WHERE controller_id=?`).get(controller.id) as any).count,stock:db.prepare(`SELECT id,current_level_liters FROM fuel_tanks ORDER BY id`).all(),transactions:(db.prepare(`SELECT COUNT(*) count FROM transactions`).get() as any).count,cash:(db.prepare(`SELECT COUNT(*) count FROM cash_flow_records`).get() as any).count};
  const manager=new AdapterManager(db);await manager.start(controller.id);await manager.restart(controller.id);await manager.shutdown();
  const after={atg:(db.prepare(`SELECT COUNT(*) count FROM automation_atg_readings WHERE controller_id=?`).get(controller.id) as any).count,stock:db.prepare(`SELECT id,current_level_liters FROM fuel_tanks ORDER BY id`).all(),transactions:(db.prepare(`SELECT COUNT(*) count FROM transactions`).get() as any).count,cash:(db.prepare(`SELECT COUNT(*) count FROM cash_flow_records`).get() as any).count};
  const reading=db.prepare(`SELECT external_event_id,external_tank_id,level_value,level_unit,volume_value,volume_unit,temperature_value,temperature_unit,water_level_value,water_level_unit,source_occurred_at,processing_status,anomaly_classification FROM automation_atg_readings WHERE controller_id=? ORDER BY created_at DESC LIMIT 1`).get(controller.id) as any;
  const duplicates=(db.prepare(`SELECT COUNT(*) count FROM automation_event_inbox WHERE controller_id=? AND event_type='ATG_TANK_READING' AND external_event_id=?`).get(controller.id,reading?.external_event_id) as any).count;
  if(after.atg-before.atg!==1||duplicates!==1)throw new Error(`Expected one durable reading across reconnect; observed delta ${after.atg-before.atg}, inbox identities ${duplicates}.`);
  if(JSON.stringify(before.stock)!==JSON.stringify(after.stock)||before.transactions!==after.transactions||before.cash!==after.cash)throw new Error('Live ATG validation mutated operational data.');
  if(db.pragma('integrity_check',{simple:true})!=='ok'||db.pragma('foreign_key_check').length)throw new Error('Database integrity validation failed.');
  process.stdout.write(JSON.stringify({controllerId:controller.id,durableReadingsAdded:after.atg-before.atg,duplicateInboxRows:duplicates,reading,stockMutation:'NONE',financialMutation:'NONE',integrityCheck:'ok',foreignKeyCheck:'ok'},null,2));
}finally{db.close();}
