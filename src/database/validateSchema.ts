import type Database from 'better-sqlite3';
import { SINGLE_STATION_INSERT_TRIGGER } from './single-station.js';

const requiredColumns: Record<string, string[]> = {
  users: ['id', 'name', 'email', 'role', 'active'],
  auth_sessions: ['token_hash','user_id','expires_at','created_at'],
  custom_roles: ['id', 'name', 'description', 'status', 'system_role', 'created_by', 'created_at', 'updated_at'],
  custom_role_permissions: ['role_id', 'permission', 'granted_by', 'granted_at'],
  fuel_products: ['id', 'name', 'code'],
  fuel_tanks: ['id', 'tank_name', 'fuel_product_id', 'fuel_name'],
  pumps: ['id', 'pump_number', 'pump_name', 'status'],
  pump_nozzles: ['id', 'physical_pump_id', 'nozzle_number', 'fuel_product_id', 'tank_id'],
  shifts: ['id', 'staff_id', 'start_time', 'end_time'],
  transactions: ['id', 'shift_id', 'product_id', 'nozzle_id', 'source'],
  cash_flow_records: ['id', 'date', 'type', 'category', 'amount', 'reference_no'],
  customers: ['id', 'tax_id'],
  suppliers: ['id', 'supplier_name', 'tax_id'],
  station_settings: ['id', 'station_name', 'tax_pin', 'cu_serial'],
  automation_controllers: ['id', 'station_id', 'name', 'adapter_type', 'connection_type', 'timeout_ms', 'credential_ref', 'status', 'enabled', 'last_communication_at', 'last_successful_connection_at', 'last_error', 'capabilities_json', 'created_at', 'updated_at'],
  automation_controller_credentials: ['id','controller_id','ciphertext','iv','auth_tag','algorithm','created_at','updated_at'],
  automation_device_mappings: ['id', 'controller_id', 'equipment_type', 'external_parent_id', 'external_equipment_id', 'external_name', 'external_address', 'metadata_json', 'pump_id', 'nozzle_id', 'tank_id', 'product_id', 'status', 'created_by', 'last_discovered_at', 'created_at', 'updated_at'],
  automation_discovered_devices: ['id', 'controller_id', 'equipment_type', 'external_parent_id', 'external_equipment_id', 'external_name', 'external_address', 'product_external_id', 'metadata_json', 'first_discovered_at', 'last_discovered_at', 'present'],
  automation_mapping_history: ['id', 'mapping_id', 'controller_id', 'action', 'before_json', 'after_json', 'changed_by', 'created_at'],
  automation_event_inbox: ['id', 'controller_id', 'external_event_id', 'event_type', 'external_device_id', 'device_type', 'source_sequence', 'source_occurred_at', 'received_at', 'schema_version', 'payload_json', 'raw_payload_hash', 'correlation_id', 'processing_status', 'processing_attempts', 'processing_started_at', 'processed_at', 'last_error', 'created_at', 'updated_at'],
  automation_sync_cursors: ['id', 'controller_id', 'stream_name', 'cursor_value', 'source_sequence', 'last_event_at', 'synchronized_at', 'created_at', 'updated_at'],
  automation_logs: ['id', 'controller_id', 'event_id', 'timestamp', 'level', 'category', 'message', 'details_json', 'correlation_id'],
  automation_settings: ['id', 'station_id', 'setting_key', 'setting_value_json', 'updated_by', 'created_at', 'updated_at'],
  automation_live_forecourt_state: ['controller_id', 'device_type', 'external_parent_id', 'external_device_id', 'operational_state', 'activity_json', 'last_event_type', 'last_event_id', 'source_occurred_at', 'received_at', 'updated_at'],
  automation_fuel_transaction_processing: ['inbox_id','controller_id','external_event_id','transaction_id','external_device_id','external_parent_id','source_sequence','occurred_at','received_at','processing_status','failure_code','failure_class','failure_detail','processing_attempts','posting_started_at','posted_at','created_at','updated_at'],
  automation_meter_readings: ['id','inbox_id','controller_id','station_id','external_event_id','external_device_id','external_parent_id','device_type','pump_id','nozzle_id','product_id','reading_value','unit','source_sequence','source_occurred_at','received_at','payload_hash','processing_status','anomaly_classification','previous_reading_id','previous_value','calculated_delta','transaction_id','transaction_volume','correlation_status','created_at'],
  automation_meter_processing: ['inbox_id','controller_id','external_event_id','processing_status','failure_code','failure_class','failure_detail','processing_attempts','meter_reading_id','created_at','updated_at'],
  automation_meter_current_state: ['controller_id','station_id','external_parent_id','external_device_id','pump_id','nozzle_id','product_id','current_reading_id','previous_reading_id','current_value','previous_value','calculated_delta','unit','last_sequence','last_source_occurred_at','last_received_at','last_valid_reading_at','last_anomaly','correlation_status','transaction_id','updated_at'],
  automation_atg_readings:['id','inbox_id','controller_id','station_id','external_event_id','external_tank_id','tank_id','product_id','level_value','level_unit','volume_value','volume_unit','temperature_value','temperature_unit','water_level_value','water_level_unit','source_sequence','source_occurred_at','received_at','payload_hash','processing_status','anomaly_classification','previous_reading_id','sensor_reset','created_at'],
  automation_atg_processing:['inbox_id','controller_id','external_event_id','processing_status','failure_code','failure_class','failure_detail','processing_attempts','atg_reading_id','created_at','updated_at'],
  automation_atg_current_state:['controller_id','station_id','external_tank_id','tank_id','product_id','current_reading_id','previous_reading_id','level_value','level_unit','volume_value','volume_unit','temperature_value','temperature_unit','water_level_value','water_level_unit','last_sequence','last_source_occurred_at','last_received_at','last_valid_reading_at','last_anomaly','sensor_reset','updated_at'],
  automation_reconciliation_runs:['id','station_id','reconciliation_type','scope_type','scope_id','period_start','period_end','configuration_json','configuration_version','scope_key','status','result','total_variance','tolerance','created_by','execution_source','notes','failure_detail','created_at','started_at','completed_at','updated_at'],
  automation_reconciliation_items:['id','reconciliation_run_id','station_id','product_id','tank_id','physical_pump_id','nozzle_id','shift_id','period_start','period_end','opening_totalizer','closing_totalizer','totalizer_delta','automated_transaction_quantity','manual_transaction_quantity','dispenser_variance','opening_atg_volume','closing_atg_volume','deliveries','transfers','adjustments','expected_tank_change','actual_atg_change','atg_variance','tolerance','absolute_variance','percentage_variance','result','data_quality_status','explanation','evidence_refs_json','created_at'],
  automation_alert_rules:['id','station_id','rule_code','name','description','enabled','severity','threshold','duration_seconds','cooldown_seconds','repeat_interval_seconds','created_by','updated_by','created_at','updated_at'],
  automation_alerts:['id','station_id','rule_id','alert_type','severity','status','source_domain','source_id','source_reference','title','message','details_json','detected_at','first_detected_at','last_detected_at','acknowledged_at','acknowledged_by','resolved_at','resolved_by','resolution_note','occurrence_count','deduplication_key','created_at','updated_at'],
  automation_notifications:['id','alert_id','station_id','channel','recipient','status','attempted_at','delivered_at','failure_reason','retry_count','created_at'],
};

const requiredIndexes: Record<string, string[]> = {
  customers: ['idx_customers_name_unique','idx_customers_tax_id_unique'],
  auth_sessions: ['idx_auth_sessions_user_expiry'],
  suppliers: ['idx_suppliers_name_unique','idx_suppliers_tax_id_unique'],
  custom_roles: ['idx_custom_roles_name', 'idx_custom_roles_status'],
  custom_role_permissions: ['idx_custom_role_permissions_permission'],
  automation_controllers: ['idx_automation_controllers_station_name', 'idx_automation_controllers_station_enabled'],
  automation_controller_credentials: ['idx_automation_credentials_controller'],
  automation_device_mappings: ['idx_automation_mappings_external_identity', 'idx_automation_mappings_active_pump', 'idx_automation_mappings_active_nozzle', 'idx_automation_mappings_active_tank', 'idx_automation_mappings_active_product', 'idx_automation_mappings_pump', 'idx_automation_mappings_nozzle', 'idx_automation_mappings_tank', 'idx_automation_mappings_product', 'idx_automation_mappings_status'],
  automation_discovered_devices: ['idx_automation_discovery_external_identity', 'idx_automation_discovery_controller_present'],
  automation_mapping_history: ['idx_automation_mapping_history_mapping_created', 'idx_automation_mapping_history_controller_created'],
  automation_event_inbox: ['idx_automation_event_controller_external', 'idx_automation_event_status_received', 'idx_automation_event_controller_sequence', 'idx_automation_event_correlation'],
  automation_sync_cursors: ['idx_automation_sync_controller_stream'],
  automation_logs: ['idx_automation_logs_controller_timestamp', 'idx_automation_logs_level_timestamp', 'idx_automation_logs_event'],
  automation_settings: ['idx_automation_settings_station_key'],
  automation_live_forecourt_state: ['idx_live_forecourt_state_freshness', 'idx_live_forecourt_state_controller_type'],
  transactions: ['idx_transactions_source_created'],
  automation_fuel_transaction_processing: ['idx_automation_fuel_controller_event','idx_automation_fuel_processing_status'],
  automation_meter_readings: ['idx_meter_readings_controller_event','idx_meter_readings_device_time','idx_meter_readings_topology','idx_meter_readings_anomaly','idx_meter_readings_correlation'],
  automation_meter_processing: ['idx_meter_processing_controller_event','idx_meter_processing_status'],
  automation_meter_current_state: ['idx_meter_current_topology','idx_meter_current_freshness'],
  automation_atg_readings:['idx_atg_readings_controller_event','idx_atg_readings_tank_time','idx_atg_readings_controller_time','idx_atg_readings_anomaly'],
  automation_atg_processing:['idx_atg_processing_controller_event','idx_atg_processing_status'],
  automation_atg_current_state:['idx_atg_current_tank','idx_atg_current_freshness'],
  automation_reconciliation_runs:['idx_auto_recon_station_period','idx_auto_recon_station_result','idx_auto_recon_scope'],
  automation_reconciliation_items:['idx_auto_recon_items_run','idx_auto_recon_items_topology','idx_auto_recon_items_result'],
  automation_alert_rules:['idx_alert_rules_station_enabled'],automation_alerts:['idx_alerts_station_status','idx_alerts_source','idx_alerts_type_time'],automation_notifications:['idx_notifications_station_status','idx_notifications_alert'],
};

const requiredUniqueIndexes = new Set([
  'idx_customers_name_unique','idx_customers_tax_id_unique','idx_suppliers_name_unique','idx_suppliers_tax_id_unique',
  'idx_custom_roles_name',
  'idx_automation_controllers_station_name',
  'idx_automation_credentials_controller',
  'idx_automation_mappings_external_identity',
  'idx_automation_mappings_active_pump',
  'idx_automation_mappings_active_nozzle',
  'idx_automation_mappings_active_tank',
  'idx_automation_mappings_active_product',
  'idx_automation_discovery_external_identity',
  'idx_automation_event_controller_external',
  'idx_automation_sync_controller_stream',
  'idx_automation_settings_station_key',
  'idx_automation_fuel_controller_event',
  'idx_meter_readings_controller_event','idx_meter_processing_controller_event',
  'idx_atg_readings_controller_event','idx_atg_processing_controller_event','idx_atg_current_tank',
]);

type ForeignKeyExpectation = { table: string; from: string; targetTable: string; to: string; onDelete?:'RESTRICT'|'CASCADE' };
const requiredAutomationForeignKeys: ForeignKeyExpectation[] = [
  { table: 'custom_roles', from: 'created_by', targetTable: 'users', to: 'id' },
  { table: 'auth_sessions', from: 'user_id', targetTable: 'users', to: 'id', onDelete:'CASCADE' },
  { table: 'custom_role_permissions', from: 'role_id', targetTable: 'custom_roles', to: 'id' },
  { table: 'custom_role_permissions', from: 'granted_by', targetTable: 'users', to: 'id' },
  { table: 'automation_controllers', from: 'station_id', targetTable: 'station_settings', to: 'id' },
  { table: 'automation_controller_credentials', from: 'controller_id', targetTable: 'automation_controllers', to: 'id', onDelete:'CASCADE' },
  { table: 'automation_device_mappings', from: 'controller_id', targetTable: 'automation_controllers', to: 'id' },
  { table: 'automation_device_mappings', from: 'pump_id', targetTable: 'pumps', to: 'id' },
  { table: 'automation_device_mappings', from: 'nozzle_id', targetTable: 'pump_nozzles', to: 'id' },
  { table: 'automation_device_mappings', from: 'tank_id', targetTable: 'fuel_tanks', to: 'id' },
  { table: 'automation_device_mappings', from: 'product_id', targetTable: 'fuel_products', to: 'id' },
  { table: 'automation_device_mappings', from: 'created_by', targetTable: 'users', to: 'id' },
  { table: 'automation_discovered_devices', from: 'controller_id', targetTable: 'automation_controllers', to: 'id' },
  { table: 'automation_mapping_history', from: 'mapping_id', targetTable: 'automation_device_mappings', to: 'id' },
  { table: 'automation_mapping_history', from: 'controller_id', targetTable: 'automation_controllers', to: 'id' },
  { table: 'automation_mapping_history', from: 'changed_by', targetTable: 'users', to: 'id' },
  { table: 'automation_event_inbox', from: 'controller_id', targetTable: 'automation_controllers', to: 'id' },
  { table: 'automation_sync_cursors', from: 'controller_id', targetTable: 'automation_controllers', to: 'id' },
  { table: 'automation_logs', from: 'controller_id', targetTable: 'automation_controllers', to: 'id' },
  { table: 'automation_logs', from: 'event_id', targetTable: 'automation_event_inbox', to: 'id' },
  { table: 'automation_settings', from: 'station_id', targetTable: 'station_settings', to: 'id' },
  { table: 'automation_settings', from: 'updated_by', targetTable: 'users', to: 'id' },
  { table: 'automation_live_forecourt_state', from: 'controller_id', targetTable: 'automation_controllers', to: 'id' },
  { table: 'automation_fuel_transaction_processing', from: 'inbox_id', targetTable: 'automation_event_inbox', to: 'id' },
  { table: 'automation_fuel_transaction_processing', from: 'controller_id', targetTable: 'automation_controllers', to: 'id' },
  { table: 'automation_fuel_transaction_processing', from: 'transaction_id', targetTable: 'transactions', to: 'id' },
  { table: 'automation_meter_readings', from: 'inbox_id', targetTable: 'automation_event_inbox', to: 'id' },
  { table: 'automation_meter_readings', from: 'controller_id', targetTable: 'automation_controllers', to: 'id' },
  { table: 'automation_meter_readings', from: 'station_id', targetTable: 'station_settings', to: 'id' },
  { table: 'automation_meter_readings', from: 'pump_id', targetTable: 'pumps', to: 'id' },
  { table: 'automation_meter_readings', from: 'nozzle_id', targetTable: 'pump_nozzles', to: 'id' },
  { table: 'automation_meter_readings', from: 'product_id', targetTable: 'fuel_products', to: 'id' },
  { table: 'automation_meter_readings', from: 'previous_reading_id', targetTable: 'automation_meter_readings', to: 'id' },
  { table: 'automation_meter_readings', from: 'transaction_id', targetTable: 'transactions', to: 'id' },
  { table: 'automation_meter_processing', from: 'inbox_id', targetTable: 'automation_event_inbox', to: 'id' },
  { table: 'automation_meter_processing', from: 'controller_id', targetTable: 'automation_controllers', to: 'id' },
  { table: 'automation_meter_processing', from: 'meter_reading_id', targetTable: 'automation_meter_readings', to: 'id' },
  { table: 'automation_meter_current_state', from: 'controller_id', targetTable: 'automation_controllers', to: 'id' },
  { table: 'automation_meter_current_state', from: 'station_id', targetTable: 'station_settings', to: 'id' },
  { table: 'automation_meter_current_state', from: 'pump_id', targetTable: 'pumps', to: 'id' },
  { table: 'automation_meter_current_state', from: 'nozzle_id', targetTable: 'pump_nozzles', to: 'id' },
  { table: 'automation_meter_current_state', from: 'product_id', targetTable: 'fuel_products', to: 'id' },
  { table: 'automation_meter_current_state', from: 'current_reading_id', targetTable: 'automation_meter_readings', to: 'id' },
  { table: 'automation_meter_current_state', from: 'previous_reading_id', targetTable: 'automation_meter_readings', to: 'id' },
  { table: 'automation_meter_current_state', from: 'transaction_id', targetTable: 'transactions', to: 'id' },
  {table:'automation_atg_readings',from:'inbox_id',targetTable:'automation_event_inbox',to:'id'},{table:'automation_atg_readings',from:'controller_id',targetTable:'automation_controllers',to:'id'},{table:'automation_atg_readings',from:'station_id',targetTable:'station_settings',to:'id'},{table:'automation_atg_readings',from:'tank_id',targetTable:'fuel_tanks',to:'id'},{table:'automation_atg_readings',from:'product_id',targetTable:'fuel_products',to:'id'},{table:'automation_atg_readings',from:'previous_reading_id',targetTable:'automation_atg_readings',to:'id'},
  {table:'automation_atg_processing',from:'inbox_id',targetTable:'automation_event_inbox',to:'id'},{table:'automation_atg_processing',from:'controller_id',targetTable:'automation_controllers',to:'id'},{table:'automation_atg_processing',from:'atg_reading_id',targetTable:'automation_atg_readings',to:'id'},
  {table:'automation_atg_current_state',from:'controller_id',targetTable:'automation_controllers',to:'id'},{table:'automation_atg_current_state',from:'station_id',targetTable:'station_settings',to:'id'},{table:'automation_atg_current_state',from:'tank_id',targetTable:'fuel_tanks',to:'id'},{table:'automation_atg_current_state',from:'product_id',targetTable:'fuel_products',to:'id'},{table:'automation_atg_current_state',from:'current_reading_id',targetTable:'automation_atg_readings',to:'id'},{table:'automation_atg_current_state',from:'previous_reading_id',targetTable:'automation_atg_readings',to:'id'},
  {table:'automation_reconciliation_runs',from:'station_id',targetTable:'station_settings',to:'id'},{table:'automation_reconciliation_runs',from:'created_by',targetTable:'users',to:'id'},
  {table:'automation_reconciliation_items',from:'reconciliation_run_id',targetTable:'automation_reconciliation_runs',to:'id',onDelete:'CASCADE'},{table:'automation_reconciliation_items',from:'station_id',targetTable:'station_settings',to:'id'},{table:'automation_reconciliation_items',from:'product_id',targetTable:'fuel_products',to:'id'},{table:'automation_reconciliation_items',from:'tank_id',targetTable:'fuel_tanks',to:'id'},{table:'automation_reconciliation_items',from:'physical_pump_id',targetTable:'pumps',to:'id'},{table:'automation_reconciliation_items',from:'nozzle_id',targetTable:'pump_nozzles',to:'id'},{table:'automation_reconciliation_items',from:'shift_id',targetTable:'shifts',to:'id'},
  {table:'automation_alert_rules',from:'station_id',targetTable:'station_settings',to:'id'},{table:'automation_alert_rules',from:'created_by',targetTable:'users',to:'id'},{table:'automation_alert_rules',from:'updated_by',targetTable:'users',to:'id'},
  {table:'automation_alerts',from:'station_id',targetTable:'station_settings',to:'id'},{table:'automation_alerts',from:'rule_id',targetTable:'automation_alert_rules',to:'id'},{table:'automation_alerts',from:'acknowledged_by',targetTable:'users',to:'id'},{table:'automation_alerts',from:'resolved_by',targetTable:'users',to:'id'},
  {table:'automation_notifications',from:'alert_id',targetTable:'automation_alerts',to:'id',onDelete:'CASCADE'},{table:'automation_notifications',from:'station_id',targetTable:'station_settings',to:'id'},
];

export function validateDatabaseSchema(sqlite: Database.Database) {
  const failures: string[] = [];
  console.log('[DB] Schema validation started');

  for (const [table, columns] of Object.entries(requiredColumns)) {
    const actual = new Set((sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name));
    if (!actual.size) {
      failures.push(`Table ${table} is missing`);
      continue;
    }
    for (const column of columns) if (!actual.has(column)) failures.push(`Table ${table} is missing column ${column}`);
  }

  for (const [table, indexes] of Object.entries(requiredIndexes)) {
    const actual = new Map((sqlite.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string; unique: number }>).map((row) => [row.name, Boolean(row.unique)]));
    for (const indexName of indexes) {
      if (!actual.has(indexName)) failures.push(`Table ${table} is missing index ${indexName}`);
      if (requiredUniqueIndexes.has(indexName) && actual.has(indexName) && !actual.get(indexName)) failures.push(`Index ${indexName} must be unique`);
    }
  }

  const foreignKeysByTable = new Map<string, Array<{ from: string; table: string; to: string; on_update: string; on_delete: string }>>();
  for (const expectation of requiredAutomationForeignKeys) {
    if (!foreignKeysByTable.has(expectation.table)) {
      foreignKeysByTable.set(expectation.table, sqlite.prepare(`PRAGMA foreign_key_list(${expectation.table})`).all() as Array<{ from: string; table: string; to: string; on_update: string; on_delete: string }>);
    }
    const match = foreignKeysByTable.get(expectation.table)?.find((foreignKey) =>
      foreignKey.from === expectation.from && foreignKey.table === expectation.targetTable && foreignKey.to === expectation.to,
    );
    if (!match) failures.push(`${expectation.table}.${expectation.from} is missing FK to ${expectation.targetTable}.${expectation.to}`);
    else if (match.on_update !== 'CASCADE' || match.on_delete !== (expectation.onDelete||'RESTRICT')) failures.push(`${expectation.table}.${expectation.from} must use ON UPDATE CASCADE ON DELETE ${expectation.onDelete||'RESTRICT'}`);
  }

  const stationCount = Number((sqlite.prepare('SELECT COUNT(*) AS count FROM station_settings').get() as {count:number}).count);
  if (stationCount > 1) failures.push('station_settings contains more than one station; DEITAX FMS.A is single-station per database');
  const stationTrigger = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(SINGLE_STATION_INSERT_TRIGGER);
  if (!stationTrigger) failures.push('station_settings is missing the single-station insertion guard');

  if (sqlite.pragma('integrity_check', { simple: true }) !== 'ok') failures.push('integrity_check failed');
  if ((sqlite.pragma('foreign_key_check') as unknown[]).length) failures.push('foreign_key_check found violations');
  if (sqlite.prepare(`SELECT physical_pump_id FROM pump_nozzles WHERE physical_pump_id IS NOT NULL AND physical_pump_id <> '' GROUP BY physical_pump_id, nozzle_number HAVING COUNT(*) > 1`).all().length) failures.push('pump_nozzles has duplicate physical pump/nozzle numbers');
  if (sqlite.prepare(`SELECT nozzle.id FROM pump_nozzles nozzle LEFT JOIN pumps pump ON pump.id = nozzle.physical_pump_id WHERE nozzle.physical_pump_id IS NOT NULL AND nozzle.physical_pump_id <> '' AND pump.id IS NULL LIMIT 1`).get()) failures.push('pump_nozzles contains an orphaned logical physical_pump_id reference');

  // Preserve historical pre-hierarchy values rather than deleting operational evidence.
  const legacyOrphanCount = Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM transactions transaction_row LEFT JOIN pump_nozzles nozzle ON nozzle.id = transaction_row.nozzle_id WHERE transaction_row.nozzle_id IS NOT NULL AND transaction_row.nozzle_id <> '' AND nozzle.id IS NULL`).get() as { count: number }).count);
  if (legacyOrphanCount > 0) console.warn(`[DB] Preserved ${legacyOrphanCount} legacy transaction nozzle reference(s) that predate physical FK enforcement.`);

  if (failures.length) throw new Error(`Database schema validation failed:\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
  console.log('[DB] Schema validation passed');
}
