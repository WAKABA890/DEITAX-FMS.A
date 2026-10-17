import type Database from 'better-sqlite3';

export interface AutomationFoundationStatus {
  available: boolean;
  enabled: boolean;
  message: string;
}

const FOUNDATION_TABLES = [
  'automation_controllers',
  'automation_device_mappings',
  'automation_event_inbox',
  'automation_sync_cursors',
  'automation_logs',
  'automation_settings',
  'automation_live_forecourt_state',
] as const;

/**
 * Phase 1 initialization performs only a read-only foundation check. It never
 * opens a controller connection, starts polling, or blocks core DEITAX FMS.A startup.
 */
export function initializeAutomationFoundation(
  sqlite: Database.Database,
): AutomationFoundationStatus {
  const enabled = process.env.FMS_AUTOMATION_ENABLED === 'true';

  try {
    const existing = new Set(
      (sqlite.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{ name: string }>)
        .map((row) => row.name),
    );
    const missing = FOUNDATION_TABLES.filter((table) => !existing.has(table));
    if (missing.length) throw new Error(`Missing automation foundation tables: ${missing.join(', ')}`);

    return {
      available: true,
      enabled,
      message: enabled
        ? 'Automation foundation is enabled; no controller runtime is installed in Phase 1.'
        : 'Automation foundation is available and disabled.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Automation] Foundation unavailable; DEITAX FMS.A core will continue: ${message}`);
    return { available: false, enabled: false, message };
  }
}
