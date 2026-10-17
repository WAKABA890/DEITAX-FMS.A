import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';

const root = process.cwd();
const validator = path.join(root, 'scripts', 'db-validate-target.ts');

test('single-station databases reject a second station without changing the configured station', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'deitax-single-station-'));
  const file = path.join(dir, 'fms.db');
  try {
    const initialized = spawnSync(process.execPath, ['--import', 'tsx', validator], {
      cwd: root,
      env: { ...process.env, FMS_DB_PATH: file, FMS_SKIP_SEEDING: 'true' },
      encoding: 'utf8',
    });
    assert.equal(initialized.status, 0, initialized.stdout + initialized.stderr);

    const db = new Database(file);
    db.prepare("INSERT INTO station_settings(id,station_name,tax_pin,address,phone) VALUES('station-1','Single Station','P','A','0')").run();
    assert.throws(
      () => db.prepare("INSERT INTO station_settings(id,station_name,tax_pin,address,phone) VALUES('station-2','Second Station','P2','B','1')").run(),
      /one station per database/,
    );
    assert.deepEqual(db.prepare('SELECT id FROM station_settings ORDER BY id').all(), [{ id: 'station-1' }]);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
