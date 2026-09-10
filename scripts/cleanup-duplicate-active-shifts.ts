import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const databasePath = process.env.FMS_DB_PATH
  ? path.resolve(process.env.FMS_DB_PATH)
  : path.resolve(scriptDirectory, '../data/fms.db');
const sqlite = new Database(databasePath);
const now = new Date().toISOString();

try {
  const duplicateStaff = sqlite.prepare(`
    SELECT staff_id
    FROM shifts
    WHERE status = 'Active'
    GROUP BY staff_id
    HAVING COUNT(*) > 1
  `).all() as Array<{ staff_id: string }>;

  const findActiveShifts = sqlite.prepare(`
    SELECT id, staff_id
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

  const cleanup = sqlite.transaction(() => {
    let closedCount = 0;

    for (const { staff_id: staffId } of duplicateStaff) {
      const activeShifts = findActiveShifts.all(staffId) as Array<{ id: string; staff_id: string }>;
      const [retainedShift, ...duplicates] = activeShifts;

      for (const duplicate of duplicates) {
        closeDuplicate.run(now, now, duplicate.id);
        closedCount += 1;
      }

      setCurrentShift.run(retainedShift.id, now, staffId);
    }

    sqlite.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_shifts_one_active_per_staff
      ON shifts(staff_id)
      WHERE status = 'Active'
    `);

    return { retainedCount: duplicateStaff.length, closedCount };
  });

  const result = cleanup();
  console.log(`Retained ${result.retainedCount} active shift(s) and closed ${result.closedCount} duplicate active shift(s).`);
} finally {
  sqlite.close();
}
