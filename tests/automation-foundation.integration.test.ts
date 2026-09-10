import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { buildSync } from 'esbuild';
import {
  markAutomationEventFailed,
  markAutomationEventProcessed,
  markAutomationEventProcessing,
  receiveAutomationEvent,
} from '../src/automation/events/event-inbox.ts';
import { initializeAutomationFoundation } from '../src/automation/initialize.ts';

const workspace = process.cwd();
const runnerDirectory = mkdtempSync(path.join(workspace, 'build', 'dt-fms-auto-runner-'));
const validationRunner = path.join(runnerDirectory, 'db-validate-target.mjs');
buildSync({
  entryPoints: [path.join(workspace, 'scripts', 'db-validate-target.ts')],
  outfile: validationRunner,
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  logLevel: 'silent',
});
process.once('exit', () => rmSync(runnerDirectory, { recursive: true, force: true }));

function migrateAndValidate(databasePath: string) {
  const result = spawnSync(process.execPath, [validationRunner], {
    cwd: workspace,
    env: { ...process.env, FMS_DB_PATH: databasePath, FMS_SKIP_SEEDING: 'true' },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function coreCounts(sqlite: Database.Database) {
  const tables = ['users', 'user_permissions', 'fuel_products', 'fuel_tanks', 'pumps', 'pump_nozzles', 'shifts', 'transactions'];
  return Object.fromEntries(tables.map((table) => [
    table,
    Number((sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count),
  ]));
}

function removeAutomationFoundation(sqlite: Database.Database) {
  sqlite.exec(`
    DROP TABLE IF EXISTS automation_logs;
    DROP TABLE IF EXISTS automation_sync_cursors;
    DROP TABLE IF EXISTS automation_event_inbox;
    DROP TABLE IF EXISTS automation_mapping_history;
    DROP TABLE IF EXISTS automation_discovered_devices;
    DROP TABLE IF EXISTS automation_device_mappings;
    DROP TABLE IF EXISTS automation_settings;
    DROP TABLE IF EXISTS automation_controllers;
    DELETE FROM schema_migrations WHERE migration_name IN (
      '022_reconcile_station_settings_schema',
      '023_add_automation_foundation',
      '024_expand_controller_management',
      '025_device_discovery_and_mapping'
    );
  `);
}

test('Phase 1 migrations and validation succeed on a fresh empty database', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dt-fms-auto-fresh-'));
  const databasePath = path.join(directory, 'fms.db');
  try {
    migrateAndValidate(databasePath);
    const sqlite = new Database(databasePath, { readonly: true });
    assert.equal(sqlite.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(sqlite.pragma('foreign_key_check').length, 0);
    assert.ok(sqlite.prepare(`SELECT 1 FROM schema_migrations WHERE migration_name = '023_add_automation_foundation'`).get());
    assert.equal(sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'automation_transactions'`).get(), undefined);
    sqlite.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Phase 1 upgrades an existing DT-FMS copy without changing core row counts', () => {
  const source = path.join(workspace, 'data', 'fms.db');
  assert.ok(existsSync(source), 'Existing DT-FMS database fixture is required.');
  const directory = mkdtempSync(path.join(tmpdir(), 'dt-fms-auto-existing-'));
  const databasePath = path.join(directory, 'fms.db');
  try {
    cpSync(source, databasePath);
    const beforeDb = new Database(databasePath);
    removeAutomationFoundation(beforeDb);
    const before = coreCounts(beforeDb);
    beforeDb.close();

    migrateAndValidate(databasePath);

    const afterDb = new Database(databasePath, { readonly: true });
    assert.deepEqual(coreCounts(afterDb), before);
    assert.equal(afterDb.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(afterDb.pragma('foreign_key_check').length, 0);
    afterDb.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('production-like copied database migration is idempotent and preserves data', () => {
  const source = path.join(workspace, 'data', 'fms.db');
  const directory = mkdtempSync(path.join(tmpdir(), 'dt-fms-auto-production-copy-'));
  const databasePath = path.join(directory, 'fms.db');
  try {
    cpSync(source, databasePath);
    const legacy = new Database(databasePath);
    removeAutomationFoundation(legacy);
    const before = coreCounts(legacy);
    legacy.close();

    migrateAndValidate(databasePath);
    migrateAndValidate(databasePath);

    const upgraded = new Database(databasePath, { readonly: true });
    assert.deepEqual(coreCounts(upgraded), before);
    assert.equal((upgraded.prepare(`SELECT COUNT(*) AS count FROM schema_migrations WHERE migration_name = '023_add_automation_foundation'`).get() as { count: number }).count, 1);
    upgraded.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('durable inbox enforces idempotency and the Phase 1 event lifecycle', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'dt-fms-auto-events-'));
  const databasePath = path.join(directory, 'fms.db');
  try {
    migrateAndValidate(databasePath);
    const sqlite = new Database(databasePath);
    sqlite.pragma('foreign_keys = ON');
    sqlite.prepare(`INSERT INTO station_settings (id, station_name, tax_pin, address, phone) VALUES (?, ?, ?, ?, ?)`)
      .run('station-test', 'Test Station', 'P000000000A', 'Test', '0700000000');
    sqlite.prepare(`INSERT INTO automation_controllers (id, station_id, name, adapter_type) VALUES (?, ?, ?, ?)`)
      .run('controller-test', 'station-test', 'Simulator', 'SIMULATOR');
    assert.throws(() => sqlite.prepare(`INSERT INTO automation_controllers (id, station_id, name, adapter_type, port) VALUES (?, ?, ?, ?, ?)`)
      .run('controller-invalid-port', 'station-test', 'Invalid Port', 'SIMULATOR', 70000));

    sqlite.prepare(`INSERT INTO fuel_products (id, code, name, price_per_liter, cost_per_liter, tax_rate, unit) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run('product-test', 'TEST', 'Test Fuel', 100, 80, 0.16, 'L');
    sqlite.prepare(`INSERT INTO fuel_tanks (id, tank_name, fuel_product_id, fuel_name, capacity_liters, current_level_liters, reorder_level_liters, last_dip_reading) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('tank-test', 'Tank Test', 'product-test', 'Test Fuel', 10000, 5000, 1000, 5000);
    sqlite.prepare(`INSERT INTO pumps (id, pump_number, pump_name) VALUES (?, ?, ?)`)
      .run('pump-test', 99, 'Pump Test');
    sqlite.prepare(`INSERT INTO pump_nozzles (id, physical_pump_id, nozzle_number, pump_number, pump_name, tank_id, fuel_product_id, fuel_name, opening_meter_reading, current_meter_reading, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('nozzle-test', 'pump-test', 1, 99, 'Pump Test', 'tank-test', 'product-test', 'Test Fuel', 0, 0, 'Active');
    sqlite.prepare(`INSERT INTO automation_device_mappings (id, controller_id, equipment_type, external_equipment_id, pump_id) VALUES (?, ?, ?, ?, ?)`)
      .run('mapping-pump', 'controller-test', 'PUMP', 'external-pump-99', 'pump-test');
    assert.throws(() => sqlite.prepare(`INSERT INTO automation_device_mappings (id, controller_id, equipment_type, external_equipment_id, pump_id) VALUES (?, ?, ?, ?, ?)`)
      .run('mapping-duplicate', 'controller-test', 'PUMP', 'external-pump-99', 'pump-test'));
    assert.throws(() => sqlite.prepare(`INSERT INTO automation_device_mappings (id, controller_id, equipment_type, external_equipment_id, nozzle_id) VALUES (?, ?, ?, ?, ?)`)
      .run('mapping-invalid-target', 'controller-test', 'PUMP', 'invalid-target', 'nozzle-test'));

    const event = {
      eventId: 'external-event-1',
      eventType: 'PUMP_STATUS_CHANGED' as const,
      controllerId: 'controller-test',
      sourceSequence: '1',
      sourceOccurredAt: '2026-08-31T00:00:00.000Z',
      receivedAt: '2026-08-31T00:00:01.000Z',
      schemaVersion: 1,
      payload: { pump: '1', state: 'IDLE' },
      rawPayloadHash: 'sha256:test',
    };
    const first = receiveAutomationEvent(sqlite, event);
    const duplicate = receiveAutomationEvent(sqlite, event);
    assert.equal(first.duplicate, false);
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.inboxId, first.inboxId);
    assert.equal(markAutomationEventProcessed(sqlite, first.inboxId), false, 'RECEIVED cannot skip PROCESSING.');
    assert.equal(markAutomationEventProcessing(sqlite, first.inboxId), true);
    assert.equal(markAutomationEventFailed(sqlite, first.inboxId, 'temporary failure'), true);
    assert.equal(markAutomationEventProcessing(sqlite, first.inboxId), true, 'FAILED can be retried.');
    assert.equal(markAutomationEventProcessed(sqlite, first.inboxId), true);
    assert.equal(markAutomationEventProcessing(sqlite, first.inboxId), false, 'PROCESSED is terminal.');
    const row = sqlite.prepare(`SELECT processing_status, processing_attempts FROM automation_event_inbox WHERE id = ?`).get(first.inboxId) as { processing_status: string; processing_attempts: number };
    assert.deepEqual(row, { processing_status: 'PROCESSED', processing_attempts: 2 });
    assert.throws(() => sqlite.prepare(`INSERT INTO automation_event_inbox (id, controller_id, external_event_id, event_type, source_occurred_at, payload_json, raw_payload_hash, processing_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run('invalid-event', 'controller-test', 'invalid', 'PUMP_STATUS_CHANGED', event.sourceOccurredAt, '{}', 'hash', 'UNKNOWN'));
    sqlite.prepare(`INSERT INTO automation_sync_cursors (id, controller_id, stream_name, cursor_value) VALUES (?, ?, ?, ?)`)
      .run('cursor-test', 'controller-test', 'transactions', '1');
    assert.throws(() => sqlite.prepare(`INSERT INTO automation_sync_cursors (id, controller_id, stream_name, cursor_value) VALUES (?, ?, ?, ?)`)
      .run('cursor-duplicate', 'controller-test', 'transactions', '2'));
    sqlite.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('automation foundation failure degrades without throwing or starting controllers', () => {
  const sqlite = new Database(':memory:');
  const status = initializeAutomationFoundation(sqlite);
  assert.deepEqual(status.available, false);
  assert.deepEqual(status.enabled, false);
  sqlite.close();
});
