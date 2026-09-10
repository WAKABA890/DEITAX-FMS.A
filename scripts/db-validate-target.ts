import { initializeDatabaseIfNeeded } from '../src/database/seed.ts';
import { getSqlite } from '../src/database/db.ts';
import { validateDatabaseSchema } from '../src/database/validateSchema.ts';

try {
  initializeDatabaseIfNeeded();
  validateDatabaseSchema(getSqlite());
  console.log('TARGET DATABASE VALIDATION PASSED');
} catch (error) {
  console.error('TARGET DATABASE VALIDATION FAILED');
  console.error(error);
  process.exitCode = 1;
}

