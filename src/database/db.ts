import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import * as schema from './schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.FMS_DB_PATH ? path.resolve(process.env.FMS_DB_PATH) : path.join(__dirname, '../../data/fms.db');
const DB_DIR = path.dirname(DB_PATH);

/**
 * Initialize SQLite database with Drizzle ORM
 * Creates database file if it doesn't exist
 */
export function initializeDatabase() {
  // Create data directory if it doesn't exist
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const sqlite = new Database(DB_PATH);

  // Durable SQLite settings for business-critical data persistence.
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('busy_timeout = 5000');

  console.log(`📦 Using persistent SQLite database: ${DB_PATH}`);

  const db = drizzle(sqlite, { schema });

  return { db, sqlite };
}

/**
 * Close database connection
 */
export function closeDatabase(sqlite: Database.Database) {
  sqlite.close();
}

/**
 * Get database instance
 */
export let globalDb: ReturnType<typeof drizzle> | null = null;
export let globalSqlite: Database.Database | null = null;

export function getDatabasePath() {
  return DB_PATH;
}

export function getDatabase() {
  if (!globalDb || !globalSqlite) {
    const { db, sqlite } = initializeDatabase();
    globalDb = db;
    globalSqlite = sqlite;
  }
  return globalDb;
}

export function getSqlite() {
  if (!globalSqlite) {
    const { sqlite } = initializeDatabase();
    globalSqlite = sqlite;
  }
  return globalSqlite;
}

export function closeGlobalDatabase() {
  if (globalSqlite?.open) globalSqlite.close();
  globalSqlite = null;
  globalDb = null;
}

/**
 * Export all database tables and utilities
 */
export {
  users,
  fuelProducts,
  fuelTanks,
  pumpNozzles,
  shopItems,
  shifts,
  shiftSchedules,
  transactions,
  customers,
  creditNotes,
  suppliers,
  supplierPayments,
  fuelDeliveries,
  stockAdjustments,
  cashFlowRecords,
  reconciliations,
  approvals,
  stationSettings,
  auditLogs,
  managerApprovals,
} from './schema.js';
