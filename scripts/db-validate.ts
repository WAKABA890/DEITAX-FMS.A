import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt-fms-db-validation-'));
process.env.FMS_DB_PATH = path.join(temp, 'fms.db');
process.env.FMS_SKIP_SEEDING = 'true';
const { initializeDatabaseIfNeeded } = await import('../src/database/seed.ts');
const { getSqlite } = await import('../src/database/db.ts');
const { validateDatabaseSchema } = await import('../src/database/validateSchema.ts');
try { initializeDatabaseIfNeeded(); validateDatabaseSchema(getSqlite()); console.log('DATABASE VALIDATION PASSED'); }
catch (error) { console.error('DATABASE VALIDATION FAILED'); console.error(error); process.exitCode = 1; }
