import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AutomationCapability } from '../types/capabilities.js';
import type { ControllerState } from '../types/states.js';

export type ControllerType = 'SIMULATOR' | 'GENERIC' | 'PTS2' | 'WAYNE' | 'OTHER';
export type ControllerConnectionType = 'SIMULATOR' | 'TCP' | 'HTTP' | 'HTTPS';

export interface ControllerRecord {
  id: string;
  stationId: string;
  stationName: string;
  name: string;
  controllerType: ControllerType;
  host: string | null;
  port: number | null;
  connectionType: ControllerConnectionType;
  timeoutMs: number;
  configuration: Record<string, unknown>;
  status: ControllerState;
  enabled: boolean;
  lastCommunicationAt: string | null;
  lastSuccessfulConnectionAt: string | null;
  lastError: string | null;
  capabilities: AutomationCapability[];
  firmwareVersion: string | null;
  authenticationConfigured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ControllerWriteInput {
  stationId: string;
  name: string;
  controllerType: ControllerType;
  host?: string | null;
  port?: number | null;
  connectionType: ControllerConnectionType;
  timeoutMs: number;
  configuration?: Record<string, unknown>;
  capabilities?: AutomationCapability[];
  firmwareVersion?: string | null;
}

type ControllerRow = Record<string, unknown>;

const parseJsonObject = (value: unknown): Record<string, unknown> => {
  try {
    const parsed = JSON.parse(String(value || '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const parseCapabilities = (value: unknown): AutomationCapability[] => {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const mapController = (row: ControllerRow): ControllerRecord => ({
  id: String(row.id),
  stationId: String(row.station_id),
  stationName: String(row.station_name || ''),
  name: String(row.name),
  controllerType: String(row.adapter_type) as ControllerType,
  host: row.host == null ? null : String(row.host),
  port: row.port == null ? null : Number(row.port),
  connectionType: String(row.connection_type) as ControllerConnectionType,
  timeoutMs: Number(row.timeout_ms),
  configuration: parseJsonObject(row.configuration_json),
  status: String(row.status) as ControllerState,
  enabled: Boolean(row.enabled),
  lastCommunicationAt: row.last_communication_at == null ? null : String(row.last_communication_at),
  lastSuccessfulConnectionAt: row.last_successful_connection_at == null ? null : String(row.last_successful_connection_at),
  lastError: row.last_error == null ? null : String(row.last_error),
  capabilities: parseCapabilities(row.capabilities_json),
  firmwareVersion: row.firmware_version == null ? null : String(row.firmware_version),
  authenticationConfigured: Boolean(row.credential_ref),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
});

const controllerSelect = `
  SELECT controller.*, station.station_name
  FROM automation_controllers controller
  JOIN station_settings station ON station.id = controller.station_id
`;

export class ControllerRepository {
  constructor(private readonly sqlite: Database.Database) {}

  list(): ControllerRecord[] {
    return (this.sqlite.prepare(`${controllerSelect} ORDER BY controller.name COLLATE NOCASE, controller.id`).all() as ControllerRow[])
      .map(mapController);
  }

  findById(id: string): ControllerRecord | null {
    const row = this.sqlite.prepare(`${controllerSelect} WHERE controller.id = ?`).get(id) as ControllerRow | undefined;
    return row ? mapController(row) : null;
  }

  stationExists(stationId: string): boolean {
    return Boolean(this.sqlite.prepare('SELECT 1 FROM station_settings WHERE id = ?').get(stationId));
  }

  create(input: ControllerWriteInput): ControllerRecord {
    const id = `controller-${randomUUID()}`;
    const now = new Date().toISOString();
    this.sqlite.prepare(`
      INSERT INTO automation_controllers (
        id, station_id, name, adapter_type, host, port, connection_type,
        timeout_ms, configuration_json, status, enabled, capabilities_json,
        firmware_version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DISABLED', 0, ?, ?, ?, ?)
    `).run(
      id,
      input.stationId,
      input.name,
      input.controllerType,
      input.host ?? null,
      input.port ?? null,
      input.connectionType,
      input.timeoutMs,
      JSON.stringify(input.configuration ?? {}),
      JSON.stringify(input.capabilities ?? []),
      input.firmwareVersion ?? null,
      now,
      now,
    );
    return this.findById(id)!;
  }

  update(id: string, input: ControllerWriteInput): ControllerRecord | null {
    const now = new Date().toISOString();
    const result = this.sqlite.prepare(`
      UPDATE automation_controllers
      SET station_id = ?, name = ?, adapter_type = ?, host = ?, port = ?,
          connection_type = ?, timeout_ms = ?, configuration_json = ?,
          capabilities_json = ?, firmware_version = ?, updated_at = ?
      WHERE id = ?
    `).run(
      input.stationId,
      input.name,
      input.controllerType,
      input.host ?? null,
      input.port ?? null,
      input.connectionType,
      input.timeoutMs,
      JSON.stringify(input.configuration ?? {}),
      JSON.stringify(input.capabilities ?? []),
      input.firmwareVersion ?? null,
      now,
      id,
    );
    return result.changes === 1 ? this.findById(id) : null;
  }

  setEnabled(id: string, enabled: boolean): ControllerRecord | null {
    const result = this.sqlite.prepare(`
      UPDATE automation_controllers
      SET enabled = ?, status = ?, last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(enabled ? 1 : 0, enabled ? 'UNKNOWN' : 'DISABLED', new Date().toISOString(), id);
    return result.changes === 1 ? this.findById(id) : null;
  }

  recordConnectionTest(id: string, result: { success: boolean; timestamp: string; error?: string }): ControllerRecord | null {
    this.sqlite.prepare(`
      UPDATE automation_controllers
      SET status = ?, last_communication_at = ?,
          last_successful_connection_at = CASE WHEN ? = 1 THEN ? ELSE last_successful_connection_at END,
          last_error = ?, updated_at = ?
      WHERE id = ?
    `).run(
      result.success ? 'UNKNOWN' : 'ERROR',
      result.timestamp,
      result.success ? 1 : 0,
      result.timestamp,
      result.success ? null : result.error ?? 'Simulator connection test failed.',
      result.timestamp,
      id,
    );
    return this.findById(id);
  }

  addLog(input: {
    controllerId: string;
    level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
    category: string;
    message: string;
    details?: Record<string, unknown>;
    correlationId?: string;
  }) {
    this.sqlite.prepare(`
      INSERT INTO automation_logs (
        id, controller_id, timestamp, level, category, message, details_json, correlation_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `automation-log-${randomUUID()}`,
      input.controllerId,
      new Date().toISOString(),
      input.level,
      input.category,
      input.message,
      input.details ? JSON.stringify(input.details) : null,
      input.correlationId ?? null,
    );
  }

  logs(controllerId: string, limit = 100) {
    return this.sqlite.prepare(`
      SELECT id, controller_id, timestamp, level, category, message, details_json, correlation_id
      FROM automation_logs
      WHERE controller_id = ?
      ORDER BY timestamp DESC, id DESC
      LIMIT ?
    `).all(controllerId, limit).map((row: any) => ({
      id: row.id,
      controllerId: row.controller_id,
      timestamp: row.timestamp,
      level: row.level,
      category: row.category,
      message: row.message,
      details: parseJsonObject(row.details_json),
      correlationId: row.correlation_id,
    }));
  }
}

