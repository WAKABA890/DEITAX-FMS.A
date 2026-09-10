import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDatabase, getDatabasePath, getSqlite } from './db.js';
import { validateDatabaseSchema } from './validateSchema.js';
import * as schema from './schema.js';
import {
  INITIAL_USERS,
  INITIAL_PRODUCTS,
  INITIAL_TANKS,
  INITIAL_PUMPS,
  INITIAL_SHOP_ITEMS,
  INITIAL_SHIFTS,
  INITIAL_SCHEDULES,
  INITIAL_TRANSACTIONS,
  INITIAL_DELIVERIES,
  INITIAL_APPROVALS,
  INITIAL_AUDIT_LOGS,
  INITIAL_STATION_SETTINGS,
  INITIAL_CREDIT_NOTES,
  INITIAL_CUSTOMERS,
  INITIAL_CASH_FLOW,
  INITIAL_SUPPLIERS,
  INITIAL_STOCK_ADJUSTMENTS,
} from '../data/initialData.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = getDatabasePath();
const DB_DIR = path.dirname(DB_PATH);

/**
 * Create all database tables using raw SQL
 */
function createTables() {
  const sqlite = getSqlite();

  const tables = [
    // Users
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      role TEXT NOT NULL,
      pin TEXT NOT NULL,
      employee_id TEXT,
      department TEXT,
      job_title TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      current_shift_id TEXT,
      assigned_pumps TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      last_login TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,

    // Fuel Products
    `CREATE TABLE IF NOT EXISTS fuel_products (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      price_per_liter REAL NOT NULL,
      cost_per_liter REAL NOT NULL,
      tax_rate REAL NOT NULL,
      tax_code TEXT NOT NULL DEFAULT 'B',
      unit TEXT NOT NULL,
      color TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,

    // Fuel Tanks
    `CREATE TABLE IF NOT EXISTS fuel_tanks (
      id TEXT PRIMARY KEY,
      tank_name TEXT NOT NULL,
      fuel_product_id TEXT NOT NULL,
      fuel_name TEXT NOT NULL,
      capacity_liters REAL NOT NULL,
      current_level_liters REAL NOT NULL,
      reorder_level_liters REAL NOT NULL,
      last_dip_reading REAL NOT NULL,
      last_dip_time TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(fuel_product_id) REFERENCES fuel_products(id)
    )`,

    // Pump Nozzles
    `CREATE TABLE IF NOT EXISTS pumps (
      id TEXT PRIMARY KEY,
      pump_number INTEGER NOT NULL UNIQUE,
      pump_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Active',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,

    `CREATE TABLE IF NOT EXISTS pump_nozzles (
      id TEXT PRIMARY KEY,
      physical_pump_id TEXT,
      nozzle_number INTEGER NOT NULL DEFAULT 1,
      nozzle_name TEXT,
      pump_number INTEGER NOT NULL,
      pump_name TEXT NOT NULL,
      tank_id TEXT NOT NULL,
      fuel_product_id TEXT NOT NULL,
      fuel_name TEXT NOT NULL,
      opening_meter_reading REAL NOT NULL,
      current_meter_reading REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(tank_id) REFERENCES fuel_tanks(id),
      FOREIGN KEY(fuel_product_id) REFERENCES fuel_products(id)
    )`,

    `CREATE TABLE IF NOT EXISTS nozzle_reading_history (
      id TEXT PRIMARY KEY,
      nozzle_id TEXT NOT NULL,
      pump_id TEXT,
      tank_id TEXT NOT NULL,
      fuel_product_id TEXT NOT NULL,
      shift_id TEXT,
      transaction_id TEXT,
      previous_reading REAL NOT NULL,
      quantity_dispensed REAL NOT NULL DEFAULT 0,
      current_reading REAL NOT NULL,
      reading_type TEXT NOT NULL,
      recorded_by TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY(nozzle_id) REFERENCES pump_nozzles(id),
      FOREIGN KEY(pump_id) REFERENCES pumps(id),
      FOREIGN KEY(tank_id) REFERENCES fuel_tanks(id),
      FOREIGN KEY(fuel_product_id) REFERENCES fuel_products(id),
      FOREIGN KEY(shift_id) REFERENCES shifts(id),
      FOREIGN KEY(transaction_id) REFERENCES transactions(id),
      FOREIGN KEY(recorded_by) REFERENCES users(id)
    )`,

    // Shop Items
    `CREATE TABLE IF NOT EXISTS shop_items (
      id TEXT PRIMARY KEY,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      unit_price REAL NOT NULL,
      price REAL,
      cost_price REAL NOT NULL,
      stock_qty INTEGER NOT NULL,
      reorder_level INTEGER NOT NULL,
      require_shift_count INTEGER NOT NULL DEFAULT 0,
      tax_code TEXT,
      tax_type TEXT DEFAULT 'A',
      country TEXT DEFAULT 'KE',
      currency TEXT DEFAULT 'KES',
      product_type INTEGER DEFAULT 1,
      unit TEXT DEFAULT 'Pieces',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,

    // Shifts
    `CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      staff_role TEXT NOT NULL,
      shift_type TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      status TEXT NOT NULL,
      opening_cash REAL,
      closing_cash REAL,
      opening_pump_readings_json TEXT,
      opening_tank_dips_json TEXT,
      closing_pump_readings_json TEXT,
      closing_tank_dips_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(staff_id) REFERENCES users(id)
    )`,

    // Shift Schedules
    `CREATE TABLE IF NOT EXISTS shift_schedules (
      id TEXT PRIMARY KEY,
      staff_id TEXT NOT NULL,
      staff_name TEXT NOT NULL,
      role TEXT NOT NULL,
      shift_type TEXT NOT NULL,
      date TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(staff_id) REFERENCES users(id)
    )`,

    // Document counters for unique sequential invoice/receipt numbering
    `CREATE TABLE IF NOT EXISTS document_counters (
      document_type TEXT PRIMARY KEY,
      last_number INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,

    // Transactions
    `CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      pump_id TEXT,
      nozzle_id TEXT,
      items_json TEXT,
      product_id TEXT,
      quantity REAL,
      opening_level REAL,
      closing_level REAL,
      unit_price REAL,
      subtotal REAL,
      tax REAL,
      total_amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      attendant_id TEXT,
      attendant_name TEXT,
      meter_reading_before REAL,
      meter_reading_after REAL,
      receipt_number TEXT UNIQUE,
      invoice_number TEXT UNIQUE,
      document_type TEXT NOT NULL DEFAULT 'Receipt',
      status TEXT NOT NULL,
      shift_id TEXT,
      customer_id TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(product_id) REFERENCES fuel_products(id),
      FOREIGN KEY(attendant_id) REFERENCES users(id),
      FOREIGN KEY(shift_id) REFERENCES shifts(id),
      FOREIGN KEY(customer_id) REFERENCES customers(id)
    )`,

    // Customers
    `CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      business_name TEXT NOT NULL,
      contact_person TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      account_type TEXT,
      credit_limit REAL,
      current_debt REAL,
      status TEXT NOT NULL,
      tax_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,

    // Suppliers
    `CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY,
      supplier_name TEXT NOT NULL,
      contact_person TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      payment_terms TEXT,
      account_balance REAL,
      status TEXT NOT NULL,
      tax_id TEXT,
      bank_name TEXT,
      bank_account TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,

    // Fuel Deliveries
    `CREATE TABLE IF NOT EXISTS fuel_deliveries (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      supplier_name TEXT NOT NULL,
      tank_id TEXT NOT NULL,
      fuel_product_id TEXT NOT NULL,
      quantity REAL NOT NULL,
      opening_level REAL,
      closing_level REAL,
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
      status TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY(tank_id) REFERENCES fuel_tanks(id),
      FOREIGN KEY(fuel_product_id) REFERENCES fuel_products(id),
      FOREIGN KEY(received_by) REFERENCES users(id)
    )`,

    // Stock Adjustments
    `CREATE TABLE IF NOT EXISTS stock_adjustments (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      reference_id TEXT,
      reference_name TEXT,
      previous_quantity REAL NOT NULL,
      adjustment_quantity REAL NOT NULL,
      new_quantity REAL NOT NULL,
      reason TEXT,
      movement_type TEXT,
      source TEXT DEFAULT 'Manual Adjustment',
      reference_number TEXT,
      original_document_number TEXT,
      product_code TEXT,
      performed_by TEXT,
      recorded_by TEXT,
      recorded_by_name TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(recorded_by) REFERENCES users(id)
    )`,

    // Cash Flow Records
    `CREATE TABLE IF NOT EXISTS cash_flow_records (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      amount REAL NOT NULL,
      accounting_method TEXT,
      related_transaction_id TEXT,
      related_delivery_id TEXT,
      related_payment_id TEXT,
      recorded_by TEXT,
      recorded_by_name TEXT,
      approved_by TEXT,
      approved_by_name TEXT,
      notes TEXT,
      status TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(recorded_by) REFERENCES users(id),
      FOREIGN KEY(approved_by) REFERENCES users(id)
    )`,

    // Reconciliations
    `CREATE TABLE IF NOT EXISTS reconciliations (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      shift_id TEXT,
      staff_id TEXT,
      staff_name TEXT,
      tank_dip_before REAL,
      tank_dip_after REAL,
      tank_expected_liters REAL,
      tank_actual_liters REAL,
      tank_variance REAL,
      pump_meter_before REAL,
      pump_meter_after REAL,
      pump_expected_liters REAL,
      pump_actual_liters REAL,
      pump_variance REAL,
      cash_expected REAL,
      cash_actual REAL,
      cash_variance REAL,
      variance_notes TEXT,
      status TEXT NOT NULL,
      approved_by TEXT,
      approved_by_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(shift_id) REFERENCES shifts(id),
      FOREIGN KEY(staff_id) REFERENCES users(id),
      FOREIGN KEY(approved_by) REFERENCES users(id)
    )`,

    // Approvals (original)
    `CREATE TABLE IF NOT EXISTS approvals (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      reference_id TEXT,
      description TEXT,
      requested_by TEXT,
      requested_by_name TEXT,
      requested_at TEXT NOT NULL,
      details TEXT,
      status TEXT NOT NULL,
      approved_by TEXT,
      approved_by_name TEXT,
      approved_at TEXT,
      approval_notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(requested_by) REFERENCES users(id),
      FOREIGN KEY(approved_by) REFERENCES users(id)
    )`,

    // NEW: Manager Approvals (persisted)
    `CREATE TABLE IF NOT EXISTS manager_approvals (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      shift_id TEXT,
      type TEXT NOT NULL,
      requested_by TEXT NOT NULL,
      reason TEXT NOT NULL,
      amount_or_qty TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending',
      manager_id TEXT,
      manager_notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(shift_id) REFERENCES shifts(id),
      FOREIGN KEY(manager_id) REFERENCES users(id)
    )`,

    // Audit Logs
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      user_id TEXT,
      user_name TEXT,
      user_role TEXT,
      action TEXT NOT NULL,
      module TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      severity TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )`,

    // Credit Notes
    `CREATE TABLE IF NOT EXISTS credit_notes (
      id TEXT PRIMARY KEY,
      credit_note_no TEXT,
      customer_id TEXT,
      customer_name TEXT,
      customer_pin TEXT,
      vehicle_plate TEXT,
      amount REAL,
      subtotal REAL,
      tax_amount REAL,
      total_amount REAL,
      reason TEXT,
      narration TEXT,
      status TEXT NOT NULL,
      items_json TEXT,
      original_transaction_id TEXT,
      original_document_type TEXT,
      original_document_no TEXT,
      original_invoice_no TEXT,
      original_receipt_no TEXT,
      issued_by TEXT,
      issued_by_name TEXT,
      approved_by_name TEXT,
      approved_by TEXT,
      applied_to_transaction_id TEXT,
      timestamp TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(customer_id) REFERENCES customers(id),
      FOREIGN KEY(issued_by) REFERENCES users(id),
      FOREIGN KEY(approved_by) REFERENCES users(id),
      FOREIGN KEY(applied_to_transaction_id) REFERENCES transactions(id)
    )`,

    // Supplier Payments
    `CREATE TABLE IF NOT EXISTS supplier_payments (
      id TEXT PRIMARY KEY,
      supplier_id TEXT NOT NULL,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      reference_number TEXT,
      date TEXT NOT NULL,
      approved_by TEXT,
      approved_by_name TEXT,
      notes TEXT,
      status TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(supplier_id) REFERENCES suppliers(id),
      FOREIGN KEY(approved_by) REFERENCES users(id)
    )`,

    // Station Settings
    `CREATE TABLE IF NOT EXISTS station_settings (
      id TEXT PRIMARY KEY DEFAULT 'station-1',
      station_name TEXT,
      tagline TEXT,
      tax_pin TEXT,
      cu_serial TEXT,
      address TEXT,
      phone TEXT,
      email TEXT,
      invoice_terms TEXT,
      paybill_number TEXT,
      paybill_account_number TEXT,
      till_number TEXT,
      show_paybill_on_invoice INTEGER NOT NULL DEFAULT 1,
      show_till_on_invoice INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (const tableSQL of tables) {
    sqlite.exec(tableSQL);
  }
}

type ColumnMigration = {
  table: string;
  columns: Array<{ name: string; sql: string }>;
};

type DatabaseMigration = {
  name: string;
  columns?: ColumnMigration[];
  sql?: string[];
  run?: (sqlite: any) => void;
  foreignKeysOff?: boolean;
};

const usernameBase = (user: { id: string; name?: string | null; email?: string | null }) => {
  const emailLocalPart = String(user.email || '').trim().split('@')[0];
  const identity = emailLocalPart || String(user.name || '').trim() || `user-${user.id}`;
  const normalized = identity.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || `user-${String(user.id).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
};

const migrateUsernames = (sqlite: any) => {
  const columns = tableColumns(sqlite, 'users');
  if (!columns.has('username')) sqlite.exec('ALTER TABLE users ADD COLUMN username TEXT');

  // A previous failed migration may have left an index or partially populated values behind.
  sqlite.exec('DROP INDEX IF EXISTS idx_users_username_unique');
  const users = sqlite.prepare('SELECT id, name, email, username FROM users ORDER BY id').all() as Array<{ id: string; name?: string | null; email?: string | null; username?: string | null }>;
  const reserved = new Set<string>();
  const updateUsername = sqlite.prepare('UPDATE users SET username = ? WHERE id = ?');

  for (const user of users) {
    const existing = String(user.username || '').trim();
    const key = existing.toLowerCase();
    if (existing && !reserved.has(key)) {
      reserved.add(key);
      continue;
    }

    const base = usernameBase(user);
    let username = base;
    let suffix = 2;
    while (reserved.has(username.toLowerCase())) username = `${base}${suffix++}`;
    updateUsername.run(username, user.id);
    reserved.add(username.toLowerCase());
  }

  sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique
    ON users(username COLLATE NOCASE)
    WHERE username IS NOT NULL AND trim(username) <> ''`);
};

const migrations: DatabaseMigration[] = [
  {
    name: '001_initial_schema',
  },
  {
    name: '002_transaction_document_columns',
    columns: [
    {
      table: 'transactions',
      columns: [
        { name: 'nozzle_id', sql: 'ALTER TABLE transactions ADD COLUMN nozzle_id TEXT' },
        { name: 'items_json', sql: 'ALTER TABLE transactions ADD COLUMN items_json TEXT' },
        { name: 'invoice_number', sql: 'ALTER TABLE transactions ADD COLUMN invoice_number TEXT' },
        { name: 'document_type', sql: "ALTER TABLE transactions ADD COLUMN document_type TEXT NOT NULL DEFAULT 'Receipt'" },
        { name: 'customer_name', sql: "ALTER TABLE transactions ADD COLUMN customer_name TEXT" },
        { name: 'customer_pin', sql: "ALTER TABLE transactions ADD COLUMN customer_pin TEXT" },
        { name: 'vehicle_plate', sql: "ALTER TABLE transactions ADD COLUMN vehicle_plate TEXT" },
      ],
    },
    ],
  },
  {
    name: '003_credit_note_document_columns',
    columns: [
    {
      table: 'credit_notes',
      columns: [
        { name: 'credit_note_no', sql: 'ALTER TABLE credit_notes ADD COLUMN credit_note_no TEXT' },
        { name: 'customer_name', sql: 'ALTER TABLE credit_notes ADD COLUMN customer_name TEXT' },
        { name: 'customer_pin', sql: 'ALTER TABLE credit_notes ADD COLUMN customer_pin TEXT' },
        { name: 'vehicle_plate', sql: 'ALTER TABLE credit_notes ADD COLUMN vehicle_plate TEXT' },
        { name: 'subtotal', sql: 'ALTER TABLE credit_notes ADD COLUMN subtotal REAL' },
        { name: 'tax_amount', sql: 'ALTER TABLE credit_notes ADD COLUMN tax_amount REAL' },
        { name: 'total_amount', sql: 'ALTER TABLE credit_notes ADD COLUMN total_amount REAL' },
        { name: 'narration', sql: 'ALTER TABLE credit_notes ADD COLUMN narration TEXT' },
        { name: 'items_json', sql: 'ALTER TABLE credit_notes ADD COLUMN items_json TEXT' },
        { name: 'original_transaction_id', sql: 'ALTER TABLE credit_notes ADD COLUMN original_transaction_id TEXT' },
        { name: 'original_document_type', sql: 'ALTER TABLE credit_notes ADD COLUMN original_document_type TEXT' },
        { name: 'original_document_no', sql: 'ALTER TABLE credit_notes ADD COLUMN original_document_no TEXT' },
        { name: 'original_invoice_no', sql: 'ALTER TABLE credit_notes ADD COLUMN original_invoice_no TEXT' },
        { name: 'original_receipt_no', sql: 'ALTER TABLE credit_notes ADD COLUMN original_receipt_no TEXT' },
        { name: 'timestamp', sql: 'ALTER TABLE credit_notes ADD COLUMN timestamp TEXT' },
      ],
    },
    ],
  },
  {
    name: '004_add_product_tax_code',
    columns: [
    {
      table: 'fuel_products',
      columns: [
        { name: 'tax_code', sql: "ALTER TABLE fuel_products ADD COLUMN tax_code TEXT NOT NULL DEFAULT 'B'" },
      ],
    },
    ],
  },
  {
    name: '005_add_shop_item_columns',
    columns: [
    {
      table: 'shop_items',
      columns: [
        { name: 'price', sql: 'ALTER TABLE shop_items ADD COLUMN price REAL' },
        { name: 'tax_code', sql: 'ALTER TABLE shop_items ADD COLUMN tax_code TEXT' },
        { name: 'tax_type', sql: "ALTER TABLE shop_items ADD COLUMN tax_type TEXT DEFAULT 'A'" },
        { name: 'country', sql: "ALTER TABLE shop_items ADD COLUMN country TEXT DEFAULT 'KE'" },
        { name: 'currency', sql: "ALTER TABLE shop_items ADD COLUMN currency TEXT DEFAULT 'KES'" },
        { name: 'product_type', sql: 'ALTER TABLE shop_items ADD COLUMN product_type INTEGER DEFAULT 1' },
        { name: 'unit', sql: "ALTER TABLE shop_items ADD COLUMN unit TEXT DEFAULT 'Pieces'" },
        { name: 'require_shift_count', sql: 'ALTER TABLE shop_items ADD COLUMN require_shift_count INTEGER NOT NULL DEFAULT 0' },
      ],
    },
    ],
  },
  {
    name: '006_add_pump_nozzle_hierarchy',
    columns: [
    {
      table: 'pump_nozzles',
      columns: [
        { name: 'physical_pump_id', sql: 'ALTER TABLE pump_nozzles ADD COLUMN physical_pump_id TEXT' },
        { name: 'nozzle_number', sql: 'ALTER TABLE pump_nozzles ADD COLUMN nozzle_number INTEGER NOT NULL DEFAULT 1' },
        { name: 'nozzle_name', sql: 'ALTER TABLE pump_nozzles ADD COLUMN nozzle_name TEXT' },
      ],
    },
    ],
  },
  {
    name: '007_add_delivery_invoice_number',
    columns: [
    {
      table: 'fuel_deliveries',
      columns: [
        { name: 'invoice_number', sql: 'ALTER TABLE fuel_deliveries ADD COLUMN invoice_number TEXT' },
      ],
    },
    ],
  },
  {
    name: '008_add_reconciliation_times',
    columns: [
    {
      table: 'reconciliations',
      columns: [
        { name: 'start_time', sql: 'ALTER TABLE reconciliations ADD COLUMN start_time TEXT' },
        { name: 'end_time', sql: 'ALTER TABLE reconciliations ADD COLUMN end_time TEXT' },
      ],
    },
    ],
  },
  {
    name: '009_add_shift_snapshot_columns',
    columns: [
    {
      table: 'shifts',
      columns: [
        { name: 'opening_pump_readings_json', sql: 'ALTER TABLE shifts ADD COLUMN opening_pump_readings_json TEXT' },
        { name: 'opening_tank_dips_json', sql: 'ALTER TABLE shifts ADD COLUMN opening_tank_dips_json TEXT' },
        { name: 'closing_pump_readings_json', sql: 'ALTER TABLE shifts ADD COLUMN closing_pump_readings_json TEXT' },
        { name: 'closing_tank_dips_json', sql: 'ALTER TABLE shifts ADD COLUMN closing_tank_dips_json TEXT' },
      ],
    },
    ],
  },
  {
    name: '010_add_stock_adjustment_columns',
    columns: [
    {
      table: 'stock_adjustments',
      columns: [
        { name: 'movement_type', sql: "ALTER TABLE stock_adjustments ADD COLUMN movement_type TEXT" },
        { name: 'source', sql: "ALTER TABLE stock_adjustments ADD COLUMN source TEXT DEFAULT 'Manual Adjustment'" },
        { name: 'reference_number', sql: 'ALTER TABLE stock_adjustments ADD COLUMN reference_number TEXT' },
        { name: 'original_document_number', sql: 'ALTER TABLE stock_adjustments ADD COLUMN original_document_number TEXT' },
        { name: 'product_code', sql: 'ALTER TABLE stock_adjustments ADD COLUMN product_code TEXT' },
        { name: 'performed_by', sql: 'ALTER TABLE stock_adjustments ADD COLUMN performed_by TEXT' },
        { name: 'recorded_by_name', sql: 'ALTER TABLE stock_adjustments ADD COLUMN recorded_by_name TEXT' },
      ],
    },
    ],
  },
  {
    name: '011_add_station_payment_columns',
    columns: [
    {
      table: 'station_settings',
      columns: [
        { name: 'paybill_account_number', sql: 'ALTER TABLE station_settings ADD COLUMN paybill_account_number TEXT' },
        { name: 'show_paybill_on_invoice', sql: 'ALTER TABLE station_settings ADD COLUMN show_paybill_on_invoice INTEGER NOT NULL DEFAULT 1' },
        { name: 'show_till_on_invoice', sql: 'ALTER TABLE station_settings ADD COLUMN show_till_on_invoice INTEGER NOT NULL DEFAULT 0' },
      ],
    },
    ],
  },
  {
    name: '012_add_shift_roster_management',
    sql: [
      `CREATE TABLE IF NOT EXISTS shift_plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        shift_type TEXT NOT NULL,
        scheduled_start TEXT NOT NULL,
        scheduled_end TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Scheduled',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(created_by) REFERENCES users(id)
      )`,
      `CREATE TABLE IF NOT EXISTS shift_assignments (
        id TEXT PRIMARY KEY,
        shift_plan_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Assigned',
        assigned_at TEXT NOT NULL,
        assigned_by TEXT NOT NULL,
        removed_at TEXT,
        removed_by TEXT,
        clock_in_shift_id TEXT,
        clock_in_time TEXT,
        clock_out_time TEXT,
        FOREIGN KEY(shift_plan_id) REFERENCES shift_plans(id),
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(assigned_by) REFERENCES users(id),
        FOREIGN KEY(removed_by) REFERENCES users(id),
        FOREIGN KEY(clock_in_shift_id) REFERENCES shifts(id)
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_shift_assignments_unique_user ON shift_assignments(shift_plan_id, user_id)',
      'CREATE INDEX IF NOT EXISTS idx_shift_assignments_user ON shift_assignments(user_id, status)',
    ],
  },
  {
    name: '013_add_user_permissions_and_migrate_schedules',
    sql: [
      `CREATE TABLE IF NOT EXISTS user_permissions (
        user_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        granted_by TEXT NOT NULL,
        granted_at TEXT NOT NULL,
        PRIMARY KEY (user_id, permission),
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(granted_by) REFERENCES users(id)
      )`,
      `INSERT OR IGNORE INTO shift_plans (id, name, shift_type, scheduled_start, scheduled_end, status, created_by, created_at, updated_at)
       SELECT 'legacy-schedule-' || id,
              shift_type || ' Shift',
              shift_type,
              date || 'T' || start_time,
              date || 'T' || end_time,
              CASE WHEN status = 'Completed' THEN 'Completed' ELSE 'Scheduled' END,
              staff_id,
              COALESCE(created_at, CURRENT_TIMESTAMP),
              COALESCE(updated_at, CURRENT_TIMESTAMP)
       FROM shift_schedules`,
      `INSERT OR IGNORE INTO shift_assignments (id, shift_plan_id, user_id, status, assigned_at, assigned_by)
       SELECT 'legacy-assignment-' || id,
              'legacy-schedule-' || id,
              staff_id,
              'Assigned',
              COALESCE(created_at, CURRENT_TIMESTAMP),
              staff_id
       FROM shift_schedules`,
    ],
  },
  {
    name: '014_add_clock_in_reading_variances',
    sql: [
      `CREATE TABLE IF NOT EXISTS reading_variances (
        id TEXT PRIMARY KEY,
        shift_id TEXT NOT NULL,
        reading_type TEXT NOT NULL,
        tank_id TEXT NOT NULL,
        nozzle_id TEXT,
        reported_value REAL NOT NULL,
        authoritative_value REAL NOT NULL,
        variance REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'Review Required',
        recorded_by TEXT NOT NULL,
        recorded_at TEXT NOT NULL,
        reviewed_by TEXT,
        reviewed_at TEXT,
        resolved_by TEXT,
        resolved_at TEXT,
        resolution_notes TEXT,
        FOREIGN KEY(shift_id) REFERENCES shifts(id),
        FOREIGN KEY(tank_id) REFERENCES fuel_tanks(id),
        FOREIGN KEY(nozzle_id) REFERENCES pump_nozzles(id),
        FOREIGN KEY(recorded_by) REFERENCES users(id),
        FOREIGN KEY(reviewed_by) REFERENCES users(id),
        FOREIGN KEY(resolved_by) REFERENCES users(id)
      )`,
      'CREATE INDEX IF NOT EXISTS idx_reading_variances_shift ON reading_variances(shift_id, status)',
    ],
  },
  {
    name: '015_add_usernames',
    run: migrateUsernames,
  },
  {
    name: '016_add_user_profile_fields',
    columns: [
      {
        table: 'users',
        columns: [
          { name: 'employee_id', sql: 'ALTER TABLE users ADD COLUMN employee_id TEXT' },
          { name: 'department', sql: 'ALTER TABLE users ADD COLUMN department TEXT' },
          { name: 'job_title', sql: 'ALTER TABLE users ADD COLUMN job_title TEXT' },
        ],
      },
    ],
  },
  {
    name: '017_add_audit_log_indexes',
    sql: [
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC, id DESC)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_module ON audit_logs(module)',
    ],
  },
  {
    name: '018_add_forced_password_reset',
    columns: [{ table: 'users', columns: [
      { name: 'must_change_password', sql: 'ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0' },
    ] }],
  },
  {
    name: '019_add_last_login',
    columns: [{ table: 'users', columns: [
      { name: 'last_login', sql: 'ALTER TABLE users ADD COLUMN last_login TEXT' },
    ] }],
  },
  {
    name: '020_add_safe_customer_supplier_unique_indexes',
    run: (sqlite: any) => {
      const customerDuplicates = sqlite.prepare(`SELECT lower(trim(tax_id)) AS value, COUNT(*) AS count FROM customers
        WHERE tax_id IS NOT NULL AND trim(tax_id) <> '' GROUP BY lower(trim(tax_id)) HAVING COUNT(*) > 1`).all();
      const supplierPinDuplicates = sqlite.prepare(`SELECT lower(trim(tax_id)) AS value, COUNT(*) AS count FROM suppliers
        WHERE tax_id IS NOT NULL AND trim(tax_id) <> '' GROUP BY lower(trim(tax_id)) HAVING COUNT(*) > 1`).all();
      const supplierNameDuplicates = sqlite.prepare(`SELECT lower(trim(supplier_name)) AS value, COUNT(*) AS count FROM suppliers
        GROUP BY lower(trim(supplier_name)) HAVING COUNT(*) > 1`).all();
      if (customerDuplicates.length || supplierPinDuplicates.length || supplierNameDuplicates.length) {
        console.warn('Unique indexes were not created because legacy duplicate KRA PINs/names exist. Resolve duplicates without deleting history, then create the indexes manually.');
        return;
      }
      sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_tax_id_unique ON customers(lower(trim(tax_id))) WHERE tax_id IS NOT NULL AND trim(tax_id) <> ''`);
      sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_tax_id_unique ON suppliers(lower(trim(tax_id))) WHERE tax_id IS NOT NULL AND trim(tax_id) <> ''`);
      sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_suppliers_name_unique ON suppliers(lower(trim(supplier_name)))`);
    },
  },
  {
    name: '021_add_cash_flow_reference_number',
    columns: [{
      table: 'cash_flow_records',
      columns: [
        {
          name: 'reference_no',
          sql: 'ALTER TABLE cash_flow_records ADD COLUMN reference_no TEXT',
        },
      ],
    }],
  },
  {
    name: '022_reconcile_station_settings_schema',
    columns: [{
      table: 'station_settings',
      columns: [
        {
          name: 'cu_serial',
          sql: 'ALTER TABLE station_settings ADD COLUMN cu_serial TEXT',
        },
      ],
    }],
  },
  {
    name: '023_add_automation_foundation',
    sql: [
      `CREATE TABLE IF NOT EXISTS automation_controllers (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL,
        name TEXT NOT NULL,
        adapter_type TEXT NOT NULL,
        host TEXT,
        port INTEGER,
        connection_type TEXT NOT NULL DEFAULT 'TCP',
        credential_ref TEXT,
        configuration_json TEXT,
        status TEXT NOT NULL DEFAULT 'DISABLED'
          CHECK(status IN ('ONLINE', 'OFFLINE', 'CONNECTING', 'ERROR', 'DISABLED')),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
        last_communication_at TEXT,
        firmware_version TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_automation_controllers_port CHECK(port IS NULL OR (port BETWEEN 1 AND 65535)),
        FOREIGN KEY(station_id) REFERENCES station_settings(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_controllers_station_name ON automation_controllers(station_id, name)',
      'CREATE INDEX IF NOT EXISTS idx_automation_controllers_station_enabled ON automation_controllers(station_id, enabled)',

      `CREATE TABLE IF NOT EXISTS automation_device_mappings (
        id TEXT PRIMARY KEY,
        controller_id TEXT NOT NULL,
        equipment_type TEXT NOT NULL CHECK(equipment_type IN ('PUMP', 'NOZZLE', 'TANK')),
        external_parent_id TEXT NOT NULL DEFAULT '',
        external_equipment_id TEXT NOT NULL,
        pump_id TEXT,
        nozzle_id TEXT,
        tank_id TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE', 'DISABLED', 'CONFLICT')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_automation_mappings_target CHECK(
          (equipment_type = 'PUMP' AND pump_id IS NOT NULL AND nozzle_id IS NULL AND tank_id IS NULL)
          OR (equipment_type = 'NOZZLE' AND pump_id IS NULL AND nozzle_id IS NOT NULL AND tank_id IS NULL)
          OR (equipment_type = 'TANK' AND pump_id IS NULL AND nozzle_id IS NULL AND tank_id IS NOT NULL)
        ),
        FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(pump_id) REFERENCES pumps(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(nozzle_id) REFERENCES pump_nozzles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(tank_id) REFERENCES fuel_tanks(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_mappings_external_identity
        ON automation_device_mappings(controller_id, equipment_type, external_parent_id, external_equipment_id)`,
      'CREATE INDEX IF NOT EXISTS idx_automation_mappings_pump ON automation_device_mappings(pump_id)',
      'CREATE INDEX IF NOT EXISTS idx_automation_mappings_nozzle ON automation_device_mappings(nozzle_id)',
      'CREATE INDEX IF NOT EXISTS idx_automation_mappings_tank ON automation_device_mappings(tank_id)',

      `CREATE TABLE IF NOT EXISTS automation_event_inbox (
        id TEXT PRIMARY KEY,
        controller_id TEXT NOT NULL,
        external_event_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        source_sequence TEXT,
        source_occurred_at TEXT NOT NULL,
        received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version >= 1),
        payload_json TEXT NOT NULL,
        raw_payload_hash TEXT NOT NULL,
        correlation_id TEXT,
        processing_status TEXT NOT NULL DEFAULT 'RECEIVED'
          CHECK(processing_status IN ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED')),
        processing_attempts INTEGER NOT NULL DEFAULT 0 CHECK(processing_attempts >= 0),
        processing_started_at TEXT,
        processed_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_event_controller_external
        ON automation_event_inbox(controller_id, external_event_id)`,
      'CREATE INDEX IF NOT EXISTS idx_automation_event_status_received ON automation_event_inbox(processing_status, received_at)',
      'CREATE INDEX IF NOT EXISTS idx_automation_event_controller_sequence ON automation_event_inbox(controller_id, source_sequence)',
      'CREATE INDEX IF NOT EXISTS idx_automation_event_correlation ON automation_event_inbox(correlation_id)',

      `CREATE TABLE IF NOT EXISTS automation_sync_cursors (
        id TEXT PRIMARY KEY,
        controller_id TEXT NOT NULL,
        stream_name TEXT NOT NULL,
        cursor_value TEXT,
        source_sequence TEXT,
        last_event_at TEXT,
        synchronized_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_sync_controller_stream
        ON automation_sync_cursors(controller_id, stream_name)`,

      `CREATE TABLE IF NOT EXISTS automation_logs (
        id TEXT PRIMARY KEY,
        controller_id TEXT,
        event_id TEXT,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        level TEXT NOT NULL DEFAULT 'INFO' CHECK(level IN ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL')),
        category TEXT NOT NULL,
        message TEXT NOT NULL,
        details_json TEXT,
        correlation_id TEXT,
        FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(event_id) REFERENCES automation_event_inbox(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      'CREATE INDEX IF NOT EXISTS idx_automation_logs_controller_timestamp ON automation_logs(controller_id, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_automation_logs_level_timestamp ON automation_logs(level, timestamp)',
      'CREATE INDEX IF NOT EXISTS idx_automation_logs_event ON automation_logs(event_id)',

      `CREATE TABLE IF NOT EXISTS automation_settings (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL,
        setting_key TEXT NOT NULL,
        setting_value_json TEXT NOT NULL,
        updated_by TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(station_id) REFERENCES station_settings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(updated_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_settings_station_key
        ON automation_settings(station_id, setting_key)`,
    ],
  },
  {
    name: '024_expand_controller_management',
    foreignKeysOff: true,
    sql: [
      `CREATE TABLE automation_controllers_phase2 (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL,
        name TEXT NOT NULL,
        adapter_type TEXT NOT NULL,
        host TEXT,
        port INTEGER,
        connection_type TEXT NOT NULL DEFAULT 'TCP',
        timeout_ms INTEGER NOT NULL DEFAULT 5000 CHECK(timeout_ms BETWEEN 100 AND 60000),
        credential_ref TEXT,
        configuration_json TEXT,
        status TEXT NOT NULL DEFAULT 'DISABLED'
          CHECK(status IN ('ONLINE', 'OFFLINE', 'CONNECTING', 'ERROR', 'DISABLED', 'UNKNOWN')),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1)),
        last_communication_at TEXT,
        last_successful_connection_at TEXT,
        last_error TEXT,
        capabilities_json TEXT NOT NULL DEFAULT '[]',
        firmware_version TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_automation_controllers_port CHECK(port IS NULL OR (port BETWEEN 1 AND 65535)),
        FOREIGN KEY(station_id) REFERENCES station_settings(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      `INSERT INTO automation_controllers_phase2 (
        id, station_id, name, adapter_type, host, port, connection_type,
        credential_ref, configuration_json, status, enabled,
        last_communication_at, firmware_version, created_at, updated_at
      )
      SELECT id, station_id, name, adapter_type, host, port, connection_type,
        credential_ref, configuration_json, status, enabled,
        last_communication_at, firmware_version, created_at, updated_at
      FROM automation_controllers`,
      'DROP TABLE automation_controllers',
      'ALTER TABLE automation_controllers_phase2 RENAME TO automation_controllers',
      'CREATE UNIQUE INDEX idx_automation_controllers_station_name ON automation_controllers(station_id, name)',
      'CREATE INDEX idx_automation_controllers_station_enabled ON automation_controllers(station_id, enabled)',
    ],
  },
  {
    name: '025_device_discovery_and_mapping',
    foreignKeysOff: true,
    sql: [
      `CREATE TABLE automation_device_mappings_phase3 (
        id TEXT PRIMARY KEY,
        controller_id TEXT NOT NULL,
        equipment_type TEXT NOT NULL CHECK(equipment_type IN ('PUMP', 'NOZZLE', 'TANK', 'PRODUCT')),
        external_parent_id TEXT NOT NULL DEFAULT '',
        external_equipment_id TEXT NOT NULL,
        external_name TEXT,
        external_address TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        pump_id TEXT,
        nozzle_id TEXT,
        tank_id TEXT,
        product_id TEXT,
        status TEXT NOT NULL DEFAULT 'MAPPED' CHECK(status IN ('MAPPED', 'DISABLED', 'CONFLICT', 'ORPHANED')),
        created_by TEXT,
        last_discovered_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_automation_mappings_target CHECK(
          (equipment_type = 'PUMP' AND pump_id IS NOT NULL AND nozzle_id IS NULL AND tank_id IS NULL AND product_id IS NULL)
          OR (equipment_type = 'NOZZLE' AND pump_id IS NULL AND nozzle_id IS NOT NULL AND tank_id IS NULL AND product_id IS NULL)
          OR (equipment_type = 'TANK' AND pump_id IS NULL AND nozzle_id IS NULL AND tank_id IS NOT NULL AND product_id IS NULL)
          OR (equipment_type = 'PRODUCT' AND pump_id IS NULL AND nozzle_id IS NULL AND tank_id IS NULL AND product_id IS NOT NULL)
        ),
        FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(pump_id) REFERENCES pumps(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(nozzle_id) REFERENCES pump_nozzles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(tank_id) REFERENCES fuel_tanks(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(product_id) REFERENCES fuel_products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      `INSERT INTO automation_device_mappings_phase3 (
        id, controller_id, equipment_type, external_parent_id, external_equipment_id,
        pump_id, nozzle_id, tank_id, status, created_at, updated_at
      ) SELECT id, controller_id, equipment_type, external_parent_id, external_equipment_id,
        pump_id, nozzle_id, tank_id,
        CASE status WHEN 'ACTIVE' THEN 'MAPPED' ELSE status END, created_at, updated_at
        FROM automation_device_mappings`,
      'DROP TABLE automation_device_mappings',
      'ALTER TABLE automation_device_mappings_phase3 RENAME TO automation_device_mappings',
      `CREATE UNIQUE INDEX idx_automation_mappings_external_identity
        ON automation_device_mappings(controller_id, equipment_type, external_parent_id, external_equipment_id)`,
      `CREATE UNIQUE INDEX idx_automation_mappings_active_pump ON automation_device_mappings(pump_id)
        WHERE pump_id IS NOT NULL AND status = 'MAPPED'`,
      `CREATE UNIQUE INDEX idx_automation_mappings_active_nozzle ON automation_device_mappings(nozzle_id)
        WHERE nozzle_id IS NOT NULL AND status = 'MAPPED'`,
      `CREATE UNIQUE INDEX idx_automation_mappings_active_tank ON automation_device_mappings(tank_id)
        WHERE tank_id IS NOT NULL AND status = 'MAPPED'`,
      `CREATE UNIQUE INDEX idx_automation_mappings_active_product ON automation_device_mappings(controller_id, product_id)
        WHERE product_id IS NOT NULL AND status = 'MAPPED'`,
      'CREATE INDEX idx_automation_mappings_pump ON automation_device_mappings(pump_id)',
      'CREATE INDEX idx_automation_mappings_nozzle ON automation_device_mappings(nozzle_id)',
      'CREATE INDEX idx_automation_mappings_tank ON automation_device_mappings(tank_id)',
      'CREATE INDEX idx_automation_mappings_product ON automation_device_mappings(product_id)',
      'CREATE INDEX idx_automation_mappings_status ON automation_device_mappings(controller_id, status)',
      `CREATE TABLE automation_discovered_devices (
        id TEXT PRIMARY KEY,
        controller_id TEXT NOT NULL,
        equipment_type TEXT NOT NULL CHECK(equipment_type IN ('PUMP', 'NOZZLE', 'TANK', 'PRODUCT')),
        external_parent_id TEXT NOT NULL DEFAULT '',
        external_equipment_id TEXT NOT NULL,
        external_name TEXT,
        external_address TEXT,
        product_external_id TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        first_discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        last_discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        present INTEGER NOT NULL DEFAULT 1 CHECK(present IN (0, 1)),
        FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      `CREATE UNIQUE INDEX idx_automation_discovery_external_identity
        ON automation_discovered_devices(controller_id, equipment_type, external_parent_id, external_equipment_id)`,
      'CREATE INDEX idx_automation_discovery_controller_present ON automation_discovered_devices(controller_id, present, equipment_type)',
      `CREATE TABLE automation_mapping_history (
        id TEXT PRIMARY KEY,
        mapping_id TEXT NOT NULL,
        controller_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('CREATED', 'UPDATED', 'DISABLED', 'RESTORED', 'CONFLICT_RESOLVED')),
        before_json TEXT,
        after_json TEXT,
        changed_by TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(mapping_id) REFERENCES automation_device_mappings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(changed_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      'CREATE INDEX idx_automation_mapping_history_mapping_created ON automation_mapping_history(mapping_id, created_at)',
      'CREATE INDEX idx_automation_mapping_history_controller_created ON automation_mapping_history(controller_id, created_at)',
    ],
  },
  {
    name: '026_custom_roles',
    run: (sqlite: any) => {
      const roleColumns = tableColumns(sqlite, 'custom_roles');
      const permissionColumns = tableColumns(sqlite, 'custom_role_permissions');
      const hasLegacyRoles = roleColumns.size > 0 && !roleColumns.has('id');
      const hasLegacyPermissions = permissionColumns.size > 0 && !permissionColumns.has('role_id');

      if (hasLegacyPermissions) sqlite.exec('ALTER TABLE custom_role_permissions RENAME TO custom_role_permissions_legacy_026');
      if (hasLegacyRoles) sqlite.exec('ALTER TABLE custom_roles RENAME TO custom_roles_legacy_026');

      sqlite.exec(`CREATE TABLE IF NOT EXISTS custom_roles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','INACTIVE')),
        system_role INTEGER NOT NULL DEFAULT 0 CHECK(system_role IN (0,1)),
        created_by TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )`);
      sqlite.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_roles_name ON custom_roles(name)');
      sqlite.exec('CREATE INDEX IF NOT EXISTS idx_custom_roles_status ON custom_roles(status, name)');
      sqlite.exec(`CREATE TABLE IF NOT EXISTS custom_role_permissions (
        role_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        granted_by TEXT,
        granted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(role_id, permission),
        FOREIGN KEY(role_id) REFERENCES custom_roles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(granted_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )`);
      sqlite.exec('CREATE INDEX IF NOT EXISTS idx_custom_role_permissions_permission ON custom_role_permissions(permission)');

      if (hasLegacyRoles) {
        sqlite.exec(`INSERT OR IGNORE INTO custom_roles (id,name,description,status,system_role,created_by,created_at,updated_at)
          SELECT 'role-legacy-' || lower(hex(name)), name, description,
            CASE WHEN active=1 THEN 'ACTIVE' ELSE 'INACTIVE' END,
            CASE WHEN name IN ('Super Admin','Admin') THEN 1 ELSE 0 END,
            created_by, created_at, updated_at
          FROM custom_roles_legacy_026`);
      }
      if (hasLegacyPermissions) {
        sqlite.exec(`INSERT OR IGNORE INTO custom_role_permissions (role_id,permission)
          SELECT roles.id, legacy.permission
          FROM custom_role_permissions_legacy_026 legacy
          JOIN custom_roles roles ON lower(roles.name)=lower(legacy.role_name)`);
      }

      sqlite.exec(`INSERT OR IGNORE INTO custom_roles (id,name,description,status,system_role)
       SELECT 'role-' || lower(replace(replace(role,' ','-'),'/','-')), role, 'Migrated existing DT-FMS role', 'ACTIVE',
       CASE WHEN role IN ('Super Admin','Admin') THEN 1 ELSE 0 END FROM users WHERE trim(role) <> ''`);
    },
  },
  {
    name: '027_seed_legacy_roles_as_configurable_records',
    sql: [
      `INSERT OR IGNORE INTO custom_roles(id,name,description,status,system_role) VALUES
       ('role-super-admin','Super Admin','Protected system role','ACTIVE',1),
       ('role-admin','Admin','Protected administrator role','ACTIVE',1),
       ('role-station-manager','Station Manager','Migrated legacy role','ACTIVE',0),
       ('role-auditor','Auditor','Migrated legacy role','ACTIVE',0),
       ('role-fuel-attendant','Fuel Attendant','Migrated legacy role','ACTIVE',0),
       ('role-shop-attendant','Shop Attendant','Migrated legacy role','ACTIVE',0),
       ('role-cashier','Cashier','Migrated legacy role','ACTIVE',0),
       ('role-normal-user','Normal User','Migrated legacy role','ACTIVE',0),
       ('role-standard-user','Standard User','Migrated legacy role','ACTIVE',0)`,
    ],
  },
  {
    name: '028_live_forecourt_projection',
    sql: [
      `CREATE TABLE automation_live_forecourt_state (
        controller_id TEXT NOT NULL,
        device_type TEXT NOT NULL CHECK(device_type IN ('CONTROLLER','PUMP','NOZZLE')),
        external_parent_id TEXT NOT NULL DEFAULT '',
        external_device_id TEXT NOT NULL DEFAULT '',
        operational_state TEXT NOT NULL DEFAULT 'UNKNOWN' CHECK(operational_state IN ('ONLINE','OFFLINE','IDLE','AUTHORIZED','DISPENSING','STOPPED','ERROR','UNKNOWN')),
        activity_json TEXT NOT NULL DEFAULT '{}',
        last_event_type TEXT NOT NULL,
        last_event_id TEXT NOT NULL,
        source_occurred_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(controller_id,device_type,external_parent_id,external_device_id),
        FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      'CREATE INDEX idx_live_forecourt_state_freshness ON automation_live_forecourt_state(received_at)',
      'CREATE INDEX idx_live_forecourt_state_controller_type ON automation_live_forecourt_state(controller_id,device_type)',
      `INSERT OR IGNORE INTO automation_settings(id,station_id,setting_key,setting_value_json)
       SELECT 'live-forecourt-freshness-' || id,id,'live_forecourt_freshness_seconds','{"seconds":30}' FROM station_settings`,
    ],
  },
  {
    name: '029_enforce_customer_supplier_identity_uniqueness',
    run: (sqlite: any) => {
      const definitions = [
        { table:'customers', column:'business_name', index:'idx_customers_name_unique', label:'customer name', where:'' },
        { table:'customers', column:'tax_id', index:'idx_customers_tax_id_unique', label:'customer KRA PIN', where:`WHERE tax_id IS NOT NULL AND trim(tax_id) <> ''` },
        { table:'suppliers', column:'supplier_name', index:'idx_suppliers_name_unique', label:'supplier name', where:'' },
        { table:'suppliers', column:'tax_id', index:'idx_suppliers_tax_id_unique', label:'supplier KRA PIN', where:`WHERE tax_id IS NOT NULL AND trim(tax_id) <> ''` },
      ];
      for(const definition of definitions){
        const duplicate=sqlite.prepare(`SELECT lower(trim(${definition.column})) value,COUNT(*) count FROM ${definition.table} ${definition.where} GROUP BY lower(trim(${definition.column})) HAVING COUNT(*)>1 LIMIT 1`).get();
        if(duplicate)throw new Error(`Cannot enforce unique ${definition.label}: legacy duplicate '${duplicate.value}' exists. No data was deleted; resolve the duplicate and rerun migration.`);
        sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${definition.index} ON ${definition.table}(lower(trim(${definition.column}))) ${definition.where}`);
      }
    },
  },
  {
    name: '030_automated_fuel_transaction_engine',
    run: (sqlite: any) => {
      const transactionColumns = tableColumns(sqlite, 'transactions');
      if (!transactionColumns.has('source')) sqlite.exec(`ALTER TABLE transactions ADD COLUMN source TEXT NOT NULL DEFAULT 'MANUAL'`);
      const inboxColumns = tableColumns(sqlite, 'automation_event_inbox');
      if (!inboxColumns.has('external_device_id')) sqlite.exec(`ALTER TABLE automation_event_inbox ADD COLUMN external_device_id TEXT`);
      if (!inboxColumns.has('device_type')) sqlite.exec(`ALTER TABLE automation_event_inbox ADD COLUMN device_type TEXT`);
      sqlite.exec(`
        CREATE INDEX IF NOT EXISTS idx_transactions_source_created ON transactions(source, created_at);
        CREATE TABLE IF NOT EXISTS automation_fuel_transaction_processing (
          inbox_id TEXT PRIMARY KEY,
          controller_id TEXT NOT NULL,
          external_event_id TEXT NOT NULL,
          transaction_id TEXT UNIQUE,
          external_device_id TEXT,
          external_parent_id TEXT,
          source_sequence TEXT,
          occurred_at TEXT NOT NULL,
          received_at TEXT NOT NULL,
          processing_status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK(processing_status IN ('RECEIVED','VALIDATING','VALIDATED','POSTING','POSTED','REJECTED','FAILED')),
          failure_code TEXT,
          failure_class TEXT CHECK(failure_class IS NULL OR failure_class IN ('PERMANENT','TEMPORARY')),
          failure_detail TEXT,
          processing_attempts INTEGER NOT NULL DEFAULT 0 CHECK(processing_attempts >= 0),
          posting_started_at TEXT,
          posted_at TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(inbox_id) REFERENCES automation_event_inbox(id) ON UPDATE CASCADE ON DELETE RESTRICT,
          FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
          FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON UPDATE CASCADE ON DELETE RESTRICT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_fuel_controller_event ON automation_fuel_transaction_processing(controller_id, external_event_id);
        CREATE INDEX IF NOT EXISTS idx_automation_fuel_processing_status ON automation_fuel_transaction_processing(processing_status, updated_at);
      `);
    },
  },
  {
    name: '031_persist_authentication_sessions',
    sql: [
      `CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
      )`,
      'CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_expiry ON auth_sessions(user_id, expires_at)',
    ],
  },
  {
    name: '032_meter_totalizer_evidence',
    sql: [
      `CREATE TABLE automation_meter_readings (
        id TEXT PRIMARY KEY,
        inbox_id TEXT NOT NULL UNIQUE,
        controller_id TEXT NOT NULL,
        station_id TEXT NOT NULL,
        external_event_id TEXT NOT NULL,
        external_device_id TEXT NOT NULL,
        external_parent_id TEXT NOT NULL,
        device_type TEXT NOT NULL CHECK(device_type='NOZZLE'),
        pump_id TEXT NOT NULL,
        nozzle_id TEXT NOT NULL,
        product_id TEXT,
        reading_value REAL NOT NULL CHECK(reading_value>=0),
        unit TEXT NOT NULL CHECK(unit='L'),
        source_sequence TEXT,
        source_occurred_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        processing_status TEXT NOT NULL CHECK(processing_status IN ('ACCEPTED','ANOMALY')),
        anomaly_classification TEXT,
        previous_reading_id TEXT,
        previous_value REAL,
        calculated_delta REAL CHECK(calculated_delta IS NULL OR calculated_delta>=0),
        transaction_id TEXT,
        transaction_volume REAL,
        correlation_status TEXT NOT NULL DEFAULT 'NOT_AVAILABLE' CHECK(correlation_status IN ('NOT_AVAILABLE','MATCHED','MISMATCH')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(inbox_id) REFERENCES automation_event_inbox(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(station_id) REFERENCES station_settings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(pump_id) REFERENCES pumps(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(nozzle_id) REFERENCES pump_nozzles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(product_id) REFERENCES fuel_products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(previous_reading_id) REFERENCES automation_meter_readings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        UNIQUE(controller_id,external_event_id)
      )`,
      'CREATE UNIQUE INDEX idx_meter_readings_controller_event ON automation_meter_readings(controller_id,external_event_id)',
      'CREATE INDEX idx_meter_readings_device_time ON automation_meter_readings(controller_id,external_parent_id,external_device_id,source_occurred_at DESC)',
      'CREATE INDEX idx_meter_readings_topology ON automation_meter_readings(pump_id,nozzle_id,product_id,source_occurred_at DESC)',
      'CREATE INDEX idx_meter_readings_anomaly ON automation_meter_readings(anomaly_classification,source_occurred_at DESC)',
      'CREATE INDEX idx_meter_readings_correlation ON automation_meter_readings(correlation_status,source_occurred_at DESC)',
      `CREATE TABLE automation_meter_processing (
        inbox_id TEXT PRIMARY KEY,
        controller_id TEXT NOT NULL,
        external_event_id TEXT NOT NULL,
        processing_status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK(processing_status IN ('RECEIVED','VALIDATING','METER_PROCESSING','PROCESSED','REJECTED','FAILED')),
        failure_code TEXT,
        failure_class TEXT CHECK(failure_class IS NULL OR failure_class IN ('PERMANENT','TEMPORARY')),
        failure_detail TEXT,
        processing_attempts INTEGER NOT NULL DEFAULT 0 CHECK(processing_attempts>=0),
        meter_reading_id TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(inbox_id) REFERENCES automation_event_inbox(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(meter_reading_id) REFERENCES automation_meter_readings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        UNIQUE(controller_id,external_event_id)
      )`,
      'CREATE UNIQUE INDEX idx_meter_processing_controller_event ON automation_meter_processing(controller_id,external_event_id)',
      'CREATE INDEX idx_meter_processing_status ON automation_meter_processing(processing_status,updated_at)',
      `CREATE TABLE automation_meter_current_state (
        controller_id TEXT NOT NULL,
        station_id TEXT NOT NULL,
        external_parent_id TEXT NOT NULL,
        external_device_id TEXT NOT NULL,
        pump_id TEXT NOT NULL,
        nozzle_id TEXT NOT NULL,
        product_id TEXT,
        current_reading_id TEXT NOT NULL,
        previous_reading_id TEXT,
        current_value REAL NOT NULL CHECK(current_value>=0),
        previous_value REAL,
        calculated_delta REAL CHECK(calculated_delta IS NULL OR calculated_delta>=0),
        unit TEXT NOT NULL CHECK(unit='L'),
        last_sequence TEXT,
        last_source_occurred_at TEXT NOT NULL,
        last_received_at TEXT NOT NULL,
        last_valid_reading_at TEXT NOT NULL,
        last_anomaly TEXT,
        correlation_status TEXT NOT NULL DEFAULT 'NOT_AVAILABLE' CHECK(correlation_status IN ('NOT_AVAILABLE','MATCHED','MISMATCH')),
        transaction_id TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(controller_id,external_parent_id,external_device_id),
        FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(station_id) REFERENCES station_settings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(pump_id) REFERENCES pumps(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(nozzle_id) REFERENCES pump_nozzles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(product_id) REFERENCES fuel_products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(current_reading_id) REFERENCES automation_meter_readings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(previous_reading_id) REFERENCES automation_meter_readings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(transaction_id) REFERENCES transactions(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      'CREATE INDEX idx_meter_current_topology ON automation_meter_current_state(pump_id,nozzle_id)',
      'CREATE INDEX idx_meter_current_freshness ON automation_meter_current_state(last_received_at)',
    ],
  },
  {
    name: '033_atg_tank_evidence',
    sql: [
      `CREATE TABLE automation_atg_readings (
        id TEXT PRIMARY KEY,
        inbox_id TEXT NOT NULL UNIQUE,
        controller_id TEXT NOT NULL,
        station_id TEXT NOT NULL,
        external_event_id TEXT NOT NULL,
        external_tank_id TEXT NOT NULL,
        tank_id TEXT NOT NULL,
        product_id TEXT,
        level_value REAL,
        level_unit TEXT CHECK(level_unit IS NULL OR level_unit='MM'),
        volume_value REAL,
        volume_unit TEXT CHECK(volume_unit IS NULL OR volume_unit='L'),
        temperature_value REAL,
        temperature_unit TEXT CHECK(temperature_unit IS NULL OR temperature_unit='C'),
        water_level_value REAL,
        water_level_unit TEXT CHECK(water_level_unit IS NULL OR water_level_unit='MM'),
        source_sequence TEXT,
        source_occurred_at TEXT NOT NULL,
        received_at TEXT NOT NULL,
        payload_hash TEXT NOT NULL,
        processing_status TEXT NOT NULL CHECK(processing_status IN ('ACCEPTED','ANOMALY')),
        anomaly_classification TEXT,
        previous_reading_id TEXT,
        sensor_reset INTEGER NOT NULL DEFAULT 0 CHECK(sensor_reset IN (0,1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK(level_value IS NOT NULL OR volume_value IS NOT NULL OR temperature_value IS NOT NULL OR water_level_value IS NOT NULL),
        CHECK(level_value IS NULL OR level_value>=0),
        CHECK(volume_value IS NULL OR volume_value>=0),
        CHECK(water_level_value IS NULL OR water_level_value>=0),
        FOREIGN KEY(inbox_id) REFERENCES automation_event_inbox(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(station_id) REFERENCES station_settings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(tank_id) REFERENCES fuel_tanks(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(product_id) REFERENCES fuel_products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(previous_reading_id) REFERENCES automation_atg_readings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        UNIQUE(controller_id,external_event_id)
      )`,
      'CREATE UNIQUE INDEX idx_atg_readings_controller_event ON automation_atg_readings(controller_id,external_event_id)',
      'CREATE INDEX idx_atg_readings_tank_time ON automation_atg_readings(tank_id,source_occurred_at DESC)',
      'CREATE INDEX idx_atg_readings_controller_time ON automation_atg_readings(controller_id,source_occurred_at DESC)',
      'CREATE INDEX idx_atg_readings_anomaly ON automation_atg_readings(anomaly_classification,source_occurred_at DESC)',
      `CREATE TABLE automation_atg_processing (
        inbox_id TEXT PRIMARY KEY,
        controller_id TEXT NOT NULL,
        external_event_id TEXT NOT NULL,
        processing_status TEXT NOT NULL DEFAULT 'RECEIVED' CHECK(processing_status IN ('RECEIVED','VALIDATING','ATG_PROCESSING','PROCESSED','REJECTED','FAILED')),
        failure_code TEXT,
        failure_class TEXT CHECK(failure_class IS NULL OR failure_class IN ('PERMANENT','TEMPORARY')),
        failure_detail TEXT,
        processing_attempts INTEGER NOT NULL DEFAULT 0 CHECK(processing_attempts>=0),
        atg_reading_id TEXT UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(inbox_id) REFERENCES automation_event_inbox(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(atg_reading_id) REFERENCES automation_atg_readings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        UNIQUE(controller_id,external_event_id)
      )`,
      'CREATE UNIQUE INDEX idx_atg_processing_controller_event ON automation_atg_processing(controller_id,external_event_id)',
      'CREATE INDEX idx_atg_processing_status ON automation_atg_processing(processing_status,updated_at)',
      `CREATE TABLE automation_atg_current_state (
        controller_id TEXT NOT NULL,
        station_id TEXT NOT NULL,
        external_tank_id TEXT NOT NULL,
        tank_id TEXT NOT NULL,
        product_id TEXT,
        current_reading_id TEXT NOT NULL,
        previous_reading_id TEXT,
        level_value REAL,
        level_unit TEXT,
        volume_value REAL,
        volume_unit TEXT,
        temperature_value REAL,
        temperature_unit TEXT,
        water_level_value REAL,
        water_level_unit TEXT,
        last_sequence TEXT,
        last_source_occurred_at TEXT NOT NULL,
        last_received_at TEXT NOT NULL,
        last_valid_reading_at TEXT NOT NULL,
        last_anomaly TEXT,
        sensor_reset INTEGER NOT NULL DEFAULT 0 CHECK(sensor_reset IN (0,1)),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY(controller_id,external_tank_id),
        FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(station_id) REFERENCES station_settings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(tank_id) REFERENCES fuel_tanks(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(product_id) REFERENCES fuel_products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(current_reading_id) REFERENCES automation_atg_readings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(previous_reading_id) REFERENCES automation_atg_readings(id) ON UPDATE CASCADE ON DELETE RESTRICT
      )`,
      'CREATE UNIQUE INDEX idx_atg_current_tank ON automation_atg_current_state(tank_id)',
      'CREATE INDEX idx_atg_current_freshness ON automation_atg_current_state(last_received_at)',
    ],
  },
  {
    name: '034_automation_reconciliation_engine',
    sql: [
      `CREATE TABLE automation_reconciliation_runs (
        id TEXT PRIMARY KEY,
        station_id TEXT NOT NULL,
        reconciliation_type TEXT NOT NULL CHECK(reconciliation_type IN ('TRANSACTION_TOTALIZER','DISPENSER_ATG','CROSS_DOMAIN')),
        scope_type TEXT NOT NULL CHECK(scope_type IN ('STATION','SHIFT','PUMP','NOZZLE','PRODUCT','TANK')),
        scope_id TEXT NOT NULL DEFAULT '',
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        configuration_json TEXT NOT NULL,
        configuration_version INTEGER NOT NULL DEFAULT 1 CHECK(configuration_version>=1),
        scope_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','RUNNING','COMPLETED','FAILED')),
        result TEXT CHECK(result IS NULL OR result IN ('MATCH','WITHIN_TOLERANCE','VARIANCE','INSUFFICIENT_DATA','DATA_QUALITY_ISSUE','FAILED')),
        total_variance REAL,
        tolerance REAL,
        created_by TEXT,
        execution_source TEXT NOT NULL CHECK(execution_source IN ('USER','SYSTEM','RETRY')),
        notes TEXT,
        failure_detail TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        started_at TEXT,
        completed_at TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(station_id) REFERENCES station_settings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        CHECK(period_end>period_start)
      )`,
      'CREATE INDEX idx_auto_recon_station_period ON automation_reconciliation_runs(station_id,period_start DESC,period_end DESC)',
      'CREATE INDEX idx_auto_recon_station_result ON automation_reconciliation_runs(station_id,result,created_at DESC)',
      'CREATE INDEX idx_auto_recon_scope ON automation_reconciliation_runs(station_id,reconciliation_type,scope_type,scope_id)',
      `CREATE TABLE automation_reconciliation_items (
        id TEXT PRIMARY KEY,
        reconciliation_run_id TEXT NOT NULL,
        station_id TEXT NOT NULL,
        product_id TEXT,
        tank_id TEXT,
        physical_pump_id TEXT,
        nozzle_id TEXT,
        shift_id TEXT,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        opening_totalizer REAL,
        closing_totalizer REAL,
        totalizer_delta REAL,
        automated_transaction_quantity REAL,
        manual_transaction_quantity REAL,
        dispenser_variance REAL,
        opening_atg_volume REAL,
        closing_atg_volume REAL,
        deliveries REAL,
        transfers REAL,
        adjustments REAL,
        expected_tank_change REAL,
        actual_atg_change REAL,
        atg_variance REAL,
        tolerance REAL NOT NULL CHECK(tolerance>=0),
        absolute_variance REAL,
        percentage_variance REAL,
        result TEXT NOT NULL CHECK(result IN ('MATCH','WITHIN_TOLERANCE','VARIANCE','INSUFFICIENT_DATA','DATA_QUALITY_ISSUE')),
        data_quality_status TEXT NOT NULL,
        explanation TEXT NOT NULL,
        evidence_refs_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(reconciliation_run_id) REFERENCES automation_reconciliation_runs(id) ON UPDATE CASCADE ON DELETE CASCADE,
        FOREIGN KEY(station_id) REFERENCES station_settings(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(product_id) REFERENCES fuel_products(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(tank_id) REFERENCES fuel_tanks(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(physical_pump_id) REFERENCES pumps(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(nozzle_id) REFERENCES pump_nozzles(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        FOREIGN KEY(shift_id) REFERENCES shifts(id) ON UPDATE CASCADE ON DELETE RESTRICT,
        UNIQUE(reconciliation_run_id,product_id,tank_id,physical_pump_id,nozzle_id,shift_id)
      )`,
      'CREATE INDEX idx_auto_recon_items_run ON automation_reconciliation_items(reconciliation_run_id)',
      'CREATE INDEX idx_auto_recon_items_topology ON automation_reconciliation_items(station_id,tank_id,physical_pump_id,nozzle_id,product_id)',
      'CREATE INDEX idx_auto_recon_items_result ON automation_reconciliation_items(station_id,result,created_at DESC)',
    ],
  },
  {
    name: '035_alerts_notifications_engine',
    sql: [
      `CREATE TABLE automation_alert_rules (id TEXT PRIMARY KEY,station_id TEXT NOT NULL,rule_code TEXT NOT NULL,name TEXT NOT NULL,description TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),severity TEXT NOT NULL CHECK(severity IN('INFO','LOW','MEDIUM','HIGH','CRITICAL')),threshold REAL,duration_seconds INTEGER CHECK(duration_seconds IS NULL OR duration_seconds>=0),cooldown_seconds INTEGER NOT NULL DEFAULT 300 CHECK(cooldown_seconds>=0),repeat_interval_seconds INTEGER CHECK(repeat_interval_seconds IS NULL OR repeat_interval_seconds>=0),created_by TEXT,updated_by TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(station_id) REFERENCES station_settings(id) ON UPDATE CASCADE ON DELETE RESTRICT,FOREIGN KEY(created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,FOREIGN KEY(updated_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,UNIQUE(station_id,rule_code))`,
      'CREATE INDEX idx_alert_rules_station_enabled ON automation_alert_rules(station_id,enabled,rule_code)',
      `CREATE TABLE automation_alerts (id TEXT PRIMARY KEY,station_id TEXT NOT NULL,rule_id TEXT,alert_type TEXT NOT NULL,severity TEXT NOT NULL CHECK(severity IN('INFO','LOW','MEDIUM','HIGH','CRITICAL')),status TEXT NOT NULL CHECK(status IN('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED')),source_domain TEXT NOT NULL,source_id TEXT,source_reference TEXT,title TEXT NOT NULL,message TEXT NOT NULL,details_json TEXT NOT NULL DEFAULT '{}',detected_at TEXT NOT NULL,first_detected_at TEXT NOT NULL,last_detected_at TEXT NOT NULL,acknowledged_at TEXT,acknowledged_by TEXT,resolved_at TEXT,resolved_by TEXT,resolution_note TEXT,occurrence_count INTEGER NOT NULL DEFAULT 1 CHECK(occurrence_count>=1),deduplication_key TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(station_id) REFERENCES station_settings(id) ON UPDATE CASCADE ON DELETE RESTRICT,FOREIGN KEY(rule_id) REFERENCES automation_alert_rules(id) ON UPDATE CASCADE ON DELETE RESTRICT,FOREIGN KEY(acknowledged_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,FOREIGN KEY(resolved_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,UNIQUE(station_id,deduplication_key))`,
      'CREATE INDEX idx_alerts_station_status ON automation_alerts(station_id,status,severity,last_detected_at DESC)',
      'CREATE INDEX idx_alerts_source ON automation_alerts(station_id,source_domain,source_id)',
      'CREATE INDEX idx_alerts_type_time ON automation_alerts(station_id,alert_type,last_detected_at DESC)',
      `CREATE TABLE automation_notifications (id TEXT PRIMARY KEY,alert_id TEXT NOT NULL,station_id TEXT NOT NULL,channel TEXT NOT NULL CHECK(channel IN('IN_APP','EMAIL','SMS')),recipient TEXT,status TEXT NOT NULL CHECK(status IN('PENDING','DELIVERED','FAILED','NOT_CONFIGURED')),attempted_at TEXT,delivered_at TEXT,failure_reason TEXT,retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count>=0),created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(alert_id) REFERENCES automation_alerts(id) ON UPDATE CASCADE ON DELETE CASCADE,FOREIGN KEY(station_id) REFERENCES station_settings(id) ON UPDATE CASCADE ON DELETE RESTRICT,UNIQUE(alert_id,channel,recipient))`,
      'CREATE INDEX idx_notifications_station_status ON automation_notifications(station_id,status,created_at DESC)',
      'CREATE INDEX idx_notifications_alert ON automation_notifications(alert_id,created_at DESC)',
    ],
  },
  {
    name: '036_add_delivery_tank_levels',
    columns: [
      {
        table: 'fuel_deliveries',
        columns: [
          { name: 'opening_level', sql: 'ALTER TABLE fuel_deliveries ADD COLUMN opening_level REAL' },
          { name: 'closing_level', sql: 'ALTER TABLE fuel_deliveries ADD COLUMN closing_level REAL' },
        ],
      },
    ],
  },
  {
    name: '037_add_transaction_tank_levels',
    columns: [
      {
        table: 'transactions',
        columns: [
          { name: 'opening_level', sql: 'ALTER TABLE transactions ADD COLUMN opening_level REAL' },
          { name: 'closing_level', sql: 'ALTER TABLE transactions ADD COLUMN closing_level REAL' },
        ],
      },
    ],
  },
  {
    name: '038_add_recurring_shift_rosters',
    columns: [
      {
        table: 'shift_plans',
        columns: [
          { name: 'recurrence_id', sql: 'ALTER TABLE shift_plans ADD COLUMN recurrence_id TEXT' },
        ],
      },
      {
        table: 'shift_assignments',
        columns: [
          { name: 'expired_at', sql: 'ALTER TABLE shift_assignments ADD COLUMN expired_at TEXT' },
          { name: 'missed_reason', sql: 'ALTER TABLE shift_assignments ADD COLUMN missed_reason TEXT' },
        ],
      },
    ],
    sql: [
      `CREATE TABLE IF NOT EXISTS shift_recurrences (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        shift_type TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        weekdays_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'Active',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(created_by) REFERENCES users(id)
      )`,
      'CREATE INDEX IF NOT EXISTS idx_shift_plans_recurrence ON shift_plans(recurrence_id, scheduled_start)',
      'CREATE INDEX IF NOT EXISTS idx_shift_assignments_expiry ON shift_assignments(status, expired_at)',
    ],
  },
  {
    name: '039_add_encrypted_controller_credentials',
    sql: [
      `CREATE TABLE IF NOT EXISTS automation_controller_credentials (
        id TEXT PRIMARY KEY,
        controller_id TEXT NOT NULL UNIQUE,
        ciphertext TEXT NOT NULL,
        iv TEXT NOT NULL,
        auth_tag TEXT NOT NULL,
        algorithm TEXT NOT NULL CHECK(algorithm = 'AES-256-GCM'),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(controller_id) REFERENCES automation_controllers(id) ON UPDATE CASCADE ON DELETE CASCADE
      )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_automation_credentials_controller ON automation_controller_credentials(controller_id)',
    ],
  },
  {
    name: '040_shift_meter_continuity_and_reading_reviews',
    columns: [
      { table:'transactions', columns:[
        {name:'dispensed_without_shift',sql:'ALTER TABLE transactions ADD COLUMN dispensed_without_shift INTEGER NOT NULL DEFAULT 0'},
        {name:'meter_reconciliation_shift_id',sql:'ALTER TABLE transactions ADD COLUMN meter_reconciliation_shift_id TEXT REFERENCES shifts(id)'},
        {name:'settlement_shift_id',sql:'ALTER TABLE transactions ADD COLUMN settlement_shift_id TEXT REFERENCES shifts(id)'},
        {name:'settled_at',sql:'ALTER TABLE transactions ADD COLUMN settled_at TEXT'},
      ]},
      { table:'manager_approvals', columns:[
        {name:'reading_variance_id',sql:'ALTER TABLE manager_approvals ADD COLUMN reading_variance_id TEXT REFERENCES reading_variances(id)'},
        {name:'review_scope',sql:'ALTER TABLE manager_approvals ADD COLUMN review_scope TEXT'},
      ]},
    ],
    sql:[
      "UPDATE transactions SET dispensed_without_shift=1 WHERE source='AUTOMATION' AND shift_id IS NULL",
      'CREATE INDEX IF NOT EXISTS idx_unattended_meter_reconciliation ON transactions(dispensed_without_shift,meter_reconciliation_shift_id,nozzle_id)',
    ],
  },
];

function ensureMigrationTable(sqlite: any) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function tableColumns(sqlite: any, table: string): Set<string> {
  return new Set(sqlite.prepare(`PRAGMA table_info(${table})`).all().map((column: any) => column.name));
}

function applyMigrations(sqlite: any) {
  ensureMigrationTable(sqlite);
  const isApplied = sqlite.prepare('SELECT 1 FROM schema_migrations WHERE migration_name = ?');
  const recordApplied = sqlite.prepare('INSERT INTO schema_migrations (migration_name) VALUES (?)');

  for (const migration of migrations) {
    if (isApplied.get(migration.name)) continue;

    const executeMigration = () => {
      for (const tableMigration of migration.columns ?? []) {
        const existingColumns = tableColumns(sqlite, tableMigration.table);
        for (const column of tableMigration.columns) {
          if (!existingColumns.has(column.name)) {
            sqlite.exec(column.sql);
            existingColumns.add(column.name);
            console.log(`✓ Added missing column ${tableMigration.table}.${column.name}`);
          }
        }
      }

      for (const statement of migration.sql ?? []) sqlite.exec(statement);
      migration.run?.(sqlite);
      recordApplied.run(migration.name);
    };

    if (migration.foreignKeysOff) {
      sqlite.pragma('foreign_keys = OFF');
      try {
        sqlite.transaction(executeMigration)();
      } finally {
        sqlite.pragma('foreign_keys = ON');
      }
    } else {
      sqlite.transaction(executeMigration)();
    }
    console.log(`✓ Applied database migration ${migration.name}`);
  }
}

function applyDataMigration(sqlite: any, migrationName: string, migrate: () => void) {
  ensureMigrationTable(sqlite);
  const isApplied = sqlite.prepare('SELECT 1 FROM schema_migrations WHERE migration_name = ?');
  if (isApplied.get(migrationName)) return;

  sqlite.transaction(() => {
    migrate();
    sqlite.prepare('INSERT INTO schema_migrations (migration_name) VALUES (?)').run(migrationName);
  })();
  console.log(`✓ Applied database migration ${migrationName}`);
}

function normalizeSqliteValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value) || (typeof value === 'object' && !(value instanceof Date))) {
    return JSON.stringify(value);
  }

  return value;
}

function insertMany<T>(table: any, rows: T[]) {
  const db = getDatabase();
  if (!rows || rows.length === 0) return;

  for (const row of rows) {
    const normalizedRow = Object.fromEntries(
      Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, normalizeSqliteValue(value)])
    );

    db.insert(table).values(normalizedRow as any).run();
  }
}

function normalizeName(value?: string | null): string {
  return (value ?? '').replace(/\s+\([^)]*\)$/, '').trim();
}

function getUserIdByName(name?: string | null): string | null {
  const normalized = normalizeName(name);
  const match = INITIAL_USERS.find((user) => normalizeName(user.name) === normalized);
  return match?.id ?? null;
}

function getCustomerIdByName(name?: string | null): string | null {
  const normalized = normalizeName(name);
  const match = (INITIAL_CUSTOMERS || []).find((customer) => normalizeName(customer.name) === normalized);
  return match?.id ?? null;
}

function getSupplierIdByName(name?: string | null): string | null {
  const normalized = normalizeName(name);
  const match = (INITIAL_SUPPLIERS || []).find((supplier) => normalizeName(supplier.name) === normalized);
  return match?.id ?? null;
}

function dateFromIso(value?: string | null): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function timeFromIso(value?: string | null): string {
  if (!value) return '00:00:00';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '00:00:00' : date.toISOString().slice(11, 19);
}

function enforceOneActiveShiftPerStaff() {
  const sqlite = getSqlite();
  const duplicateStaff = sqlite.prepare(`
    SELECT staff_id
    FROM shifts
    WHERE status = 'Active'
    GROUP BY staff_id
    HAVING COUNT(*) > 1
  `).all() as Array<{ staff_id: string }>;

  const findActiveShifts = sqlite.prepare(`
    SELECT id
    FROM shifts
    WHERE staff_id = ? AND status = 'Active'
    ORDER BY start_time ASC, id ASC
  `);
  const closeDuplicate = sqlite.prepare(`
    UPDATE shifts
    SET status = 'Cancelled',
        end_time = COALESCE(end_time, ?),
        closing_cash = COALESCE(closing_cash, opening_cash),
        updated_at = ?
    WHERE id = ?
  `);
  const setCurrentShift = sqlite.prepare(`
    UPDATE users
    SET current_shift_id = ?, updated_at = ?
    WHERE id = ?
  `);
  const now = new Date().toISOString();

  const enforce = sqlite.transaction(() => {
    for (const { staff_id: staffId } of duplicateStaff) {
      const [retainedShift, ...duplicates] = findActiveShifts.all(staffId) as Array<{ id: string }>;
      for (const duplicate of duplicates) {
        closeDuplicate.run(now, now, duplicate.id);
      }
      setCurrentShift.run(retainedShift.id, now, staffId);
    }

    sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_active_per_staff
      ON shifts(staff_id)
      WHERE status = 'Active'
    `);
  });

  enforce();
}

function migrateLegacyPumpNozzles() {
  const sqlite = getSqlite();
  const originalNozzleCount = (sqlite.prepare('SELECT COUNT(*) AS count FROM pump_nozzles').get() as { count: number }).count;
  const legacyNozzles = sqlite.prepare(`
    SELECT id, pump_number, pump_name
    FROM pump_nozzles
    WHERE physical_pump_id IS NULL OR physical_pump_id = ''
    ORDER BY pump_number, id
  `).all() as Array<{ id: string; pump_number: number; pump_name: string }>;

  const findPump = sqlite.prepare('SELECT id FROM pumps WHERE pump_number = ?');
  const createPump = sqlite.prepare(`
    INSERT INTO pumps (id, pump_number, pump_name, status)
    VALUES (?, ?, ?, 'Active')
  `);
  const nextNozzleNumber = sqlite.prepare(`
    SELECT COALESCE(MAX(nozzle_number), 0) + 1 AS number
    FROM pump_nozzles
    WHERE physical_pump_id = ?
  `);
  const updateNozzle = sqlite.prepare(`
    UPDATE pump_nozzles
    SET physical_pump_id = ?, nozzle_number = ?, nozzle_name = COALESCE(nozzle_name, ?)
    WHERE id = ?
  `);

  let createdPumpCount = 0;
  const migrate = sqlite.transaction(() => {
    for (const nozzle of legacyNozzles) {
      const existingPump = findPump.get(nozzle.pump_number) as { id: string } | undefined;
      const physicalPumpId = existingPump?.id || `pump-${nozzle.pump_number}`;
      if (!existingPump) {
        createPump.run(physicalPumpId, nozzle.pump_number, nozzle.pump_name || `Pump ${nozzle.pump_number}`);
        createdPumpCount += 1;
      }
      const nozzleNumber = (nextNozzleNumber.get(physicalPumpId) as { number: number }).number;
      updateNozzle.run(physicalPumpId, nozzleNumber, `Nozzle ${nozzleNumber}`, nozzle.id);
    }

    sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_nozzles_physical_pump_number
      ON pump_nozzles(physical_pump_id, nozzle_number)
    `);

    sqlite.exec(`
      INSERT OR IGNORE INTO nozzle_reading_history (
        id, nozzle_id, pump_id, tank_id, fuel_product_id,
        previous_reading, quantity_dispensed, current_reading,
        reading_type, timestamp
      )
      SELECT
        'nr-legacy-' || id,
        id,
        physical_pump_id,
        tank_id,
        fuel_product_id,
        opening_meter_reading,
        0,
        current_meter_reading,
        'Opening',
        COALESCE(created_at, CURRENT_TIMESTAMP)
      FROM pump_nozzles
      WHERE physical_pump_id IS NOT NULL
    `);
  });

  migrate();

  const migratedNozzleCount = (sqlite.prepare('SELECT COUNT(*) AS count FROM pump_nozzles').get() as { count: number }).count;
  const orphanedNozzleCount = (sqlite.prepare(`
    SELECT COUNT(*) AS count
    FROM pump_nozzles nozzle
    LEFT JOIN pumps pump ON pump.id = nozzle.physical_pump_id
    WHERE nozzle.physical_pump_id IS NULL OR nozzle.physical_pump_id = '' OR pump.id IS NULL
  `).get() as { count: number }).count;

  if (orphanedNozzleCount > 0 || migratedNozzleCount !== originalNozzleCount) {
    throw new Error(`Pump hierarchy migration failed: original nozzles ${originalNozzleCount}, migrated nozzles ${migratedNozzleCount}, orphaned nozzles ${orphanedNozzleCount}.`);
  }

  if (legacyNozzles.length > 0) {
    console.log(`✓ Pump hierarchy migration: original nozzle records ${originalNozzleCount}, created physical pumps ${createdPumpCount}, migrated nozzles ${legacyNozzles.length}, orphaned nozzle records 0.`);
  }
}

/**
 * Seed database with initial data
 * Clears existing data and inserts fresh data
 */
export function seedDatabase() {
  const db = getDatabase();

  try {
    console.log('🌱 Seeding database with initial data...');

    // Create tables first
    createTables();
    console.log('✓ Tables created');

    // Clear existing data (in reverse order of dependencies)
    db.delete(schema.auditLogs).run();
    db.delete(schema.approvals).run();
    db.delete(schema.reconciliations).run();
    db.delete(schema.cashFlowRecords).run();
    db.delete(schema.stockAdjustments).run();
    db.delete(schema.supplierPayments).run();
    db.delete(schema.creditNotes).run();
    db.delete(schema.fuelDeliveries).run();
    db.delete(schema.transactions).run();
    db.delete(schema.shiftSchedules).run();
    db.delete(schema.shifts).run();
    db.delete(schema.shopItems).run();
    db.delete(schema.pumpNozzles).run();
    db.delete(schema.fuelTanks).run();
    db.delete(schema.suppliers).run();
    db.delete(schema.customers).run();
    db.delete(schema.users).run();
    db.delete(schema.fuelProducts).run();
    db.delete(schema.stationSettings).run();

    // Insert station settings
    db.insert(schema.stationSettings).values(INITIAL_STATION_SETTINGS as any).run();
    console.log('✓ Station settings seeded');

    // Insert fuel products
    insertMany(schema.fuelProducts, INITIAL_PRODUCTS as any);
    console.log('✓ Fuel products seeded');

    // Insert users
    insertMany(schema.users, INITIAL_USERS as any);
    console.log('✓ Users seeded');

    // Insert fuel tanks
    insertMany(schema.fuelTanks, INITIAL_TANKS as any);
    console.log('✓ Fuel tanks seeded');

    // Insert pump nozzles
    insertMany(schema.pumpNozzles, INITIAL_PUMPS as any);
    console.log('✓ Pump nozzles seeded');

    // Insert shop items
    insertMany(schema.shopItems, INITIAL_SHOP_ITEMS as any);
    console.log('✓ Shop items seeded');

    // Insert customers using legacy field mapping when valid parent rows exist
    const initialCustomers = (INITIAL_CUSTOMERS || []).map((customer: any) => ({
      id: customer.id,
      businessName: customer.name,
      contactPerson: customer.name,
      email: customer.email ?? null,
      phone: customer.phone,
      address: customer.address ?? null,
      accountType: 'Retail',
      creditLimit: Number(customer.creditLimit ?? 0),
      currentDebt: Number(customer.currentBalance ?? 0),
      status: customer.status ?? 'Active',
      taxId: customer.kraPin ?? null,
    }));
    insertMany(schema.customers, initialCustomers as any);
    console.log('✓ Customers seeded');

    // Insert suppliers using legacy field mapping when valid parent rows exist
    const initialSuppliers = (INITIAL_SUPPLIERS || []).map((supplier: any) => ({
      id: supplier.id,
      supplierName: supplier.name,
      contactPerson: supplier.contactPerson ?? supplier.name,
      email: supplier.email ?? null,
      phone: supplier.phone,
      address: supplier.address ?? null,
      paymentTerms: supplier.paymentTerms ?? null,
      accountBalance: Number(supplier.currentBalance ?? 0),
      status: supplier.status ?? 'Active',
      taxId: supplier.kraPin ?? null,
      bankName: null,
      bankAccount: null,
    }));
    insertMany(schema.suppliers, initialSuppliers as any);
    console.log('✓ Suppliers seeded');

    const validUserIds = new Set((db.select().from(schema.users).all() as any[]).map((user: any) => user.id));
    const validCustomerIds = new Set((db.select().from(schema.customers).all() as any[]).map((customer: any) => customer.id));
    const validSupplierIds = new Set((db.select().from(schema.suppliers).all() as any[]).map((supplier: any) => supplier.id));
    const validProductIds = new Set((db.select().from(schema.fuelProducts).all() as any[]).map((product: any) => product.id));

    // Insert shifts only when referenced staff rows are present
    const validShiftRows = (INITIAL_SHIFTS || []).filter((shift: any) => validUserIds.has(shift.staffId)).map((shift: any) => ({
      id: shift.id,
      staffId: shift.staffId,
      staffName: shift.staffName,
      staffRole: shift.staffRole,
      shiftType: shift.shiftType,
      date: dateFromIso(shift.startTime),
      startTime: timeFromIso(shift.startTime),
      endTime: shift.endTime ? timeFromIso(shift.endTime) : '00:00:00',
      status: shift.status ?? 'Active',
      openingCash: Number(shift.openingCash ?? 0),
      closingCash: shift.actualCashCount ?? shift.closingCash ?? null,
    }));
    insertMany(schema.shifts, validShiftRows as any);
    console.log('✓ Shifts seeded');

    // Insert shift schedules only when referenced staff rows are present
    const validScheduleRows = (INITIAL_SCHEDULES || []).filter((schedule: any) => validUserIds.has(schedule.staffId)).map((schedule: any) => ({
      id: schedule.id,
      staffId: schedule.staffId,
      staffName: schedule.staffName,
      role: schedule.role,
      shiftType: schedule.shiftType,
      date: schedule.date,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      status: schedule.status ?? 'Scheduled',
    }));
    insertMany(schema.shiftSchedules, validScheduleRows as any);
    console.log('✓ Shift schedules seeded');

    // Insert transactions only when valid parent rows exist
    const validTransactionRows = (INITIAL_TRANSACTIONS || []).map((transaction: any) => {
      const firstItem = Array.isArray(transaction.items) && transaction.items.length > 0 ? transaction.items[0] : null;
      const isFuelTransaction = transaction.type === 'Fuel' || (firstItem && firstItem.type === 'Fuel');
      const productId = isFuelTransaction && firstItem?.itemId && validProductIds.has(firstItem.itemId) ? firstItem.itemId : null;
      const customerId = transaction.customerName ? getCustomerIdByName(transaction.customerName) ?? (validCustomerIds.has(transaction.customerName) ? transaction.customerName : null) : null;
      const attendantId = transaction.staffName ? getUserIdByName(transaction.staffName) ?? (validUserIds.has(transaction.staffName) ? transaction.staffName : null) : null;
      const isoDate = transaction.timestamp ?? new Date().toISOString();

      return {
        id: transaction.id,
        date: dateFromIso(isoDate),
        time: timeFromIso(isoDate),
        pumpId: null,
        productId,
        quantity: Number(firstItem?.qty ?? 0),
        unitPrice: Number(firstItem?.unitPrice ?? transaction.totalAmount ?? 0),
        subtotal: Number(transaction.subtotal ?? 0),
        tax: Number(transaction.taxAmount ?? 0),
        totalAmount: Number(transaction.totalAmount ?? 0),
        paymentMethod: transaction.paymentMethod ?? 'Cash',
        attendantId,
        attendantName: transaction.staffName ?? null,
        meterReadingBefore: null,
        meterReadingAfter: null,
        receiptNumber: transaction.receiptNo ?? null,
        status: transaction.status ?? 'Completed',
        shiftId: transaction.shiftId ?? null,
        customerId,
        notes: transaction.customerName ? `Sale for ${transaction.customerName}` : null,
      };
    }).filter((row: any) => !row.attendantId || validUserIds.has(row.attendantId) || row.attendantId === null);
    insertMany(schema.transactions, validTransactionRows as any);
    console.log('✓ Transactions seeded');

    // Insert audit logs only when valid user refs exist
    const validAuditRows = (INITIAL_AUDIT_LOGS || []).map((log: any) => ({
      id: log.id,
      timestamp: log.timestamp,
      userId: getUserIdByName(log.userName) ?? (log.userId && validUserIds.has(log.userId) ? log.userId : null),
      userName: log.userName,
      userRole: log.userRole,
      action: log.action,
      module: log.module,
      details: log.details,
      ipAddress: log.ipAddress ?? '127.0.0.1',
      severity: log.severity ?? 'Info',
    })).filter((row: any) => !row.userId || validUserIds.has(row.userId));
    insertMany(schema.auditLogs, validAuditRows as any);
    console.log('✓ Audit logs seeded');

    // Insert approvals only when valid user refs exist
    const validApprovalRows = (INITIAL_APPROVALS || []).map((approval: any) => ({
      id: approval.id,
      type: approval.type,
      referenceId: approval.shiftId ?? approval.id,
      description: approval.reason,
      requestedBy: getUserIdByName(approval.requestedBy) ?? (approval.requestedBy && validUserIds.has(approval.requestedBy) ? approval.requestedBy : null),
      requestedByName: approval.requestedBy,
      requestedAt: approval.timestamp,
      details: Buffer.from(JSON.stringify({
        shiftId: approval.shiftId,
        amountOrQty: approval.amountOrQty,
        managerNotes: approval.managerNotes,
      })),
      status: approval.status ?? 'Pending',
      approvedBy: approval.managerId ? getUserIdByName(approval.managerId) ?? (validUserIds.has(approval.managerId) ? approval.managerId : null) : null,
      approvedByName: approval.managerId ?? null,
      approvedAt: approval.status === 'Approved' ? approval.timestamp : null,
      approvalNotes: approval.managerNotes ?? null,
    })).filter((row: any) => !row.requestedBy || validUserIds.has(row.requestedBy));
    insertMany(schema.approvals, validApprovalRows as any);
    console.log('✓ Approvals seeded');

    // Insert cash flow records with valid recorded user refs
    const validCashFlowRows = (INITIAL_CASH_FLOW || []).map((entry: any) => ({
      id: entry.id,
      date: dateFromIso(entry.timestamp),
      type: entry.type === 'Inflow' ? 'Income' : 'Expense',
      category: entry.category,
      description: entry.description,
      amount: Number(entry.amount ?? 0),
      accountingMethod: entry.paymentMethod ?? 'Cash',
      relatedTransactionId: null,
      relatedDeliveryId: null,
      relatedPaymentId: null,
      recordedBy: getUserIdByName(entry.recordedBy) ?? (entry.recordedBy && validUserIds.has(entry.recordedBy) ? entry.recordedBy : null),
      recordedByName: normalizeName(entry.recordedBy),
      approvedBy: null,
      approvedByName: null,
      notes: null,
      status: 'Recorded',
    })).filter((row: any) => !row.recordedBy || validUserIds.has(row.recordedBy));
    insertMany(schema.cashFlowRecords, validCashFlowRows as any);
    console.log('✓ Cash flow records seeded');

    // Insert credit notes only when customer and issuer are valid
    const validCreditRows = (INITIAL_CREDIT_NOTES || []).map((note: any) => ({
      id: note.id,
      customerId: getCustomerIdByName(note.customerName) ?? (note.customerId && validCustomerIds.has(note.customerId) ? note.customerId : null),
      amount: Number(note.totalAmount ?? 0),
      reason: note.reason,
      status: note.status ?? 'Issued',
      issuedBy: getUserIdByName(note.issuedBy) ?? (note.issuedBy && validUserIds.has(note.issuedBy) ? note.issuedBy : null),
      issuedByName: normalizeName(note.issuedBy),
      approvedBy: null,
      approvedByName: null,
      appliedToTransactionId: null,
    })).filter((row: any) => row.customerId && validCustomerIds.has(row.customerId) && (!row.issuedBy || validUserIds.has(row.issuedBy)));
    insertMany(schema.creditNotes, validCreditRows as any);
    console.log('✓ Credit notes seeded');

    // Insert stock adjustments only when valid user refs exist
    const validStockRows = (INITIAL_STOCK_ADJUSTMENTS || []).map((adjustment: any) => ({
      id: adjustment.id,
      type: adjustment.type,
      referenceId: adjustment.itemId,
      referenceName: adjustment.itemName,
      previousQuantity: Number(adjustment.previousQty ?? 0),
      adjustmentQuantity: Number(adjustment.differenceQty ?? 0),
      newQuantity: Number(adjustment.adjustedQty ?? 0),
      reason: adjustment.reason,
      recordedBy: getUserIdByName(adjustment.recordedBy) ?? (adjustment.recordedBy && validUserIds.has(adjustment.recordedBy) ? adjustment.recordedBy : null),
      recordedByName: normalizeName(adjustment.recordedBy),
      notes: null,
    })).filter((row: any) => !row.recordedBy || validUserIds.has(row.recordedBy));
    insertMany(schema.stockAdjustments, validStockRows as any);
    console.log('✓ Stock adjustments seeded');

    // Demo nozzle rows are legacy-shaped; safely create their physical pump parents.
    migrateLegacyPumpNozzles();
    console.log('✅ Database seeded successfully!');
    return true;
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    throw error;
  }
}

/**
 * Check if database has initial data
 */
function getRowCountForTable(sqlite: any, tableName: string): number {
  try {
    const row = sqlite.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get();
    return Number(row?.count ?? 0);
  } catch (error) {
    return 0;
  }
}

function hasAnyPersistedRows(sqlite: any): boolean {
  const tables = [
    'users',
    'fuel_products',
    'fuel_tanks',
    'pump_nozzles',
    'shop_items',
    'shifts',
    'transactions',
    'customers',
    'suppliers',
    'station_settings',
  ];

  for (const tableName of tables) {
    try {
      if (getRowCountForTable(sqlite, tableName) > 0) {
        return true;
      }
    } catch (error) {
      // Ignore table-level errors and continue checking the rest.
    }
  }

  return false;
}

export function isDatabaseSeeded(): boolean {
  try {
    return hasAnyPersistedRows(getSqlite());
  } catch (error) {
    return false;
  }
}

/**
 * Initialize database with schema and seed data if needed
 */
export function initializeDatabaseIfNeeded() {
  const databaseExistedBeforeInitialization = fs.existsSync(DB_PATH);
  const db = getDatabase();

  try {
    createTables();
    applyMigrations(getSqlite());
    // Normalize the legacy physical pump/nozzle hierarchy before validating
    // logical references. This migration is idempotent and preserves all rows.
    applyDataMigration(getSqlite(), '012_migrate_legacy_pump_nozzles', migrateLegacyPumpNozzles);
    validateDatabaseSchema(getSqlite());
    enforceOneActiveShiftPerStaff();

    if (process.env.FMS_RESET_DB === 'true') {
      console.log('🔄 FMS_RESET_DB=true requested. Resetting database...');
      seedDatabase();
      return;
    }

    if (!databaseExistedBeforeInitialization) {
      if (process.env.FMS_SKIP_SEEDING === 'true') {
        console.log('📊 Database file was newly created. FMS_SKIP_SEEDING=true; schema is ready without demo data.');
        return;
      }
      console.log('📊 Database file was newly created. Initializing optional demo data...');
      seedDatabase();
      return;
    }

    if (!isDatabaseSeeded()) {
      if (process.env.FMS_SKIP_SEEDING === 'true') {
        console.log('📊 Database is empty but FMS_SKIP_SEEDING=true. Keeping empty database without reseeding.');
        return;
      }

      console.log('📊 Existing database is empty. Schema is ready; no demo data was added. Set FMS_RESET_DB=true only when an explicit demo reset is intended.');
      return;
    }

    console.log('✓ Database already initialized with existing data');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

/**
 * Reset database to initial state
 */
export function resetDatabase() {
  console.log('🔄 Resetting database...');
  seedDatabase();
  console.log('✅ Database reset complete');
}

/**
 * Export database statistics
 */
export function getDatabaseStats() {
  const sqlite = getSqlite();

  const stats = {
    users: getRowCountForTable(sqlite, 'users'),
    products: getRowCountForTable(sqlite, 'fuel_products'),
    tanks: getRowCountForTable(sqlite, 'fuel_tanks'),
    pumps: getRowCountForTable(sqlite, 'pump_nozzles'),
    shopItems: getRowCountForTable(sqlite, 'shop_items'),
    transactions: getRowCountForTable(sqlite, 'transactions'),
    customers: getRowCountForTable(sqlite, 'customers'),
    suppliers: getRowCountForTable(sqlite, 'suppliers'),
    shifts: getRowCountForTable(sqlite, 'shifts'),
    auditLogs: getRowCountForTable(sqlite, 'audit_logs'),
  };

  return stats;
}
