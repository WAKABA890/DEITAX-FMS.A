import Database from 'better-sqlite3';
import { AlertEngine } from '../../src/automation/alerts/alert-engine.js';
const file=process.argv[2];const db=new Database(file);db.pragma('busy_timeout=10000');db.pragma('foreign_keys=ON');const engine=new AlertEngine(db);engine.ensureDefaults('s');engine.observe({stationId:'s',ruleCode:'CONTROLLER_OFFLINE',sourceDomain:'CONNECTIVITY',sourceId:'c',sourceReference:'c',deduplicationKey:'controller-offline:c',title:'Controller offline',message:'Controller is offline.',details:{controllerId:'c'}});db.close();
