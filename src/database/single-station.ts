import type Database from 'better-sqlite3';

export const SINGLE_STATION_INSERT_TRIGGER = 'station_settings_singleton_insert';

/**
 * DEITAX FMS.A uses one physical station per SQLite database. Core business
 * rows have no station key, so a second station must be rejected.
 */
export function ensureSingleStationInvariant(sqlite: Database.Database) {
  const count = Number((sqlite.prepare('SELECT COUNT(*) AS count FROM station_settings').get() as {count:number}).count);
  if (count > 1) throw new Error('DEITAX FMS.A supports one station per database. Split station data into separate databases before startup.');

  sqlite.exec([
    'CREATE TRIGGER IF NOT EXISTS ' + SINGLE_STATION_INSERT_TRIGGER,
    'BEFORE INSERT ON station_settings',
    'WHEN EXISTS (SELECT 1 FROM station_settings)',
    'BEGIN',
    "  SELECT RAISE(ABORT, 'DEITAX FMS.A supports one station per database');",
    'END;',
  ].join('\n'));
}
