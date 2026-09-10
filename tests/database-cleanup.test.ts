import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import {
  deleteTankAndLinkedRecords,
  deleteProductAndLinkedRecords,
  ensurePumpRecord,
} from '../src/database/cleanup.ts';

function createTestDatabase() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');

  sqlite.exec(`
    CREATE TABLE fuel_products (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL
    );

    CREATE TABLE fuel_tanks (
      id TEXT PRIMARY KEY,
      tank_name TEXT NOT NULL,
      fuel_product_id TEXT NOT NULL REFERENCES fuel_products(id),
      fuel_name TEXT NOT NULL
    );

    CREATE TABLE pumps (
      id TEXT PRIMARY KEY,
      pump_number INTEGER NOT NULL UNIQUE,
      pump_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE pump_nozzles (
      id TEXT PRIMARY KEY,
      physical_pump_id TEXT REFERENCES pumps(id),
      pump_number INTEGER NOT NULL,
      tank_id TEXT NOT NULL REFERENCES fuel_tanks(id),
      fuel_product_id TEXT NOT NULL REFERENCES fuel_products(id)
    );

    CREATE TABLE nozzle_reading_history (
      id TEXT PRIMARY KEY,
      nozzle_id TEXT NOT NULL REFERENCES pump_nozzles(id),
      pump_id TEXT REFERENCES pumps(id),
      tank_id TEXT NOT NULL REFERENCES fuel_tanks(id),
      fuel_product_id TEXT NOT NULL REFERENCES fuel_products(id)
    );

    CREATE TABLE reading_variances (
      id TEXT PRIMARY KEY,
      nozzle_id TEXT REFERENCES pump_nozzles(id),
      tank_id TEXT NOT NULL REFERENCES fuel_tanks(id),
      fuel_product_id TEXT NOT NULL REFERENCES fuel_products(id)
    );

    CREATE TABLE fuel_deliveries (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      supplier_name TEXT NOT NULL,
      tank_id TEXT NOT NULL REFERENCES fuel_tanks(id),
      fuel_product_id TEXT NOT NULL REFERENCES fuel_products(id),
      quantity REAL NOT NULL,
      unit_price REAL NOT NULL,
      total_cost REAL NOT NULL,
      delivery_date TEXT NOT NULL,
      delivery_time TEXT,
      invoice_number TEXT,
      driver_name TEXT,
      driver_phone TEXT,
      vehicle_reg TEXT,
      received_by TEXT,
      received_by_name TEXT,
      status TEXT NOT NULL DEFAULT 'Completed',
      notes TEXT
    );

    CREATE TABLE transactions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      pump_id TEXT,
      nozzle_id TEXT,
      items_json TEXT,
      product_id TEXT REFERENCES fuel_products(id),
      quantity REAL,
      unit_price REAL,
      subtotal REAL,
      tax REAL,
      total_amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      attendant_id TEXT,
      attendant_name TEXT,
      meter_reading_before REAL,
      meter_reading_after REAL,
      receipt_number TEXT,
      invoice_number TEXT,
      document_type TEXT NOT NULL DEFAULT 'Receipt',
      status TEXT NOT NULL DEFAULT 'Completed'
    );
  `);

  return sqlite;
}

test('ensurePumpRecord reuses an existing pump slot instead of duplicating pump_number', () => {
  const sqlite = createTestDatabase();

  const first = ensurePumpRecord(sqlite, 'pump-1', 7, 'Pump 7');
  const second = ensurePumpRecord(sqlite, 'pump-2', 7, 'Pump 7');

  const rows = sqlite.prepare('SELECT COUNT(*) AS count FROM pumps WHERE pump_number = 7').all() as Array<{ count: number }>;
  assert.equal(rows[0].count, 1);
  assert.equal(first.id, 'pump-1');
  assert.equal(second.id, 'pump-1');
});

test('deleteTankAndLinkedRecords removes dependent nozzle and history rows before deleting tank', () => {
  const sqlite = createTestDatabase();

  sqlite.prepare('INSERT INTO fuel_products (id, code, name) VALUES (?, ?, ?)').run('prod-1', 'PET-UNL', 'Petrol');
  sqlite.prepare('INSERT INTO fuel_tanks (id, tank_name, fuel_product_id, fuel_name) VALUES (?, ?, ?, ?)').run('tank-1', 'Tank 1', 'prod-1', 'Petrol');
  sqlite.prepare('INSERT INTO pumps (id, pump_number, pump_name) VALUES (?, ?, ?)').run('pump-1', 1, 'Pump 1');
  sqlite.prepare('INSERT INTO pump_nozzles (id, physical_pump_id, pump_number, tank_id, fuel_product_id) VALUES (?, ?, ?, ?, ?)')
    .run('noz-1', 'pump-1', 1, 'tank-1', 'prod-1');
  sqlite.prepare('INSERT INTO nozzle_reading_history (id, nozzle_id, pump_id, tank_id, fuel_product_id) VALUES (?, ?, ?, ?, ?)')
    .run('history-1', 'noz-1', 'pump-1', 'tank-1', 'prod-1');

  deleteTankAndLinkedRecords(sqlite, 'tank-1');

  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM fuel_tanks WHERE id = ?').get('tank-1')?.count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM pump_nozzles WHERE tank_id = ?').get('tank-1')?.count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM nozzle_reading_history WHERE tank_id = ?').get('tank-1')?.count, 0);
});

test('deleteProductAndLinkedRecords removes linked tanks and nozzles before deleting product', () => {
  const sqlite = createTestDatabase();

  sqlite.prepare('INSERT INTO fuel_products (id, code, name) VALUES (?, ?, ?)').run('prod-1', 'PET-UNL', 'Petrol');
  sqlite.prepare('INSERT INTO fuel_tanks (id, tank_name, fuel_product_id, fuel_name) VALUES (?, ?, ?, ?)').run('tank-1', 'Tank 1', 'prod-1', 'Petrol');
  sqlite.prepare('INSERT INTO pumps (id, pump_number, pump_name) VALUES (?, ?, ?)').run('pump-1', 1, 'Pump 1');
  sqlite.prepare('INSERT INTO pump_nozzles (id, physical_pump_id, pump_number, tank_id, fuel_product_id) VALUES (?, ?, ?, ?, ?)')
    .run('noz-1', 'pump-1', 1, 'tank-1', 'prod-1');

  deleteProductAndLinkedRecords(sqlite, 'prod-1');

  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM fuel_products WHERE id = ?').get('prod-1')?.count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM fuel_tanks WHERE fuel_product_id = ?').get('prod-1')?.count, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM pump_nozzles WHERE fuel_product_id = ?').get('prod-1')?.count, 0);
});
