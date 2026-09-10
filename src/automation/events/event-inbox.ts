import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AutomationEventEnvelope, AutomationEventReceipt } from '../types/events.js';
import type { AutomationEventProcessingStatus } from '../types/states.js';

type InboxStatusRow = { id: string; processing_status: AutomationEventProcessingStatus };

/**
 * Durably records an event before future processors perform side effects.
 * The controller/external-event unique key makes controller replay idempotent.
 */
export function receiveAutomationEvent(
  sqlite: Database.Database,
  event: AutomationEventEnvelope,
): AutomationEventReceipt {
  const inboxId = `automation-event-${randomUUID()}`;
  const columns=new Set((sqlite.prepare(`PRAGMA table_info(automation_event_inbox)`).all() as Array<{name:string}>).map(row=>row.name));
  const hasPhase6Identity=columns.has('external_device_id')&&columns.has('device_type');
  const insert = sqlite.prepare(hasPhase6Identity?`
    INSERT INTO automation_event_inbox (id,controller_id,external_event_id,event_type,external_device_id,device_type,source_sequence,source_occurred_at,received_at,schema_version,payload_json,raw_payload_hash,correlation_id,processing_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED') ON CONFLICT(controller_id, external_event_id) DO NOTHING
  `:`
    INSERT INTO automation_event_inbox (id,controller_id,external_event_id,event_type,source_sequence,source_occurred_at,received_at,schema_version,payload_json,raw_payload_hash,correlation_id,processing_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED') ON CONFLICT(controller_id, external_event_id) DO NOTHING
  `);
  const find = sqlite.prepare(`
    SELECT id, processing_status
    FROM automation_event_inbox
    WHERE controller_id = ? AND external_event_id = ?
  `);

  return sqlite.transaction(() => {
    const values=hasPhase6Identity?[
      inboxId,
      event.controllerId,
      event.eventId,
      event.eventType,
      event.externalDeviceId ?? null,
      event.deviceType ?? null,
      event.sourceSequence ?? null,
      event.sourceOccurredAt,
      event.receivedAt,
      event.schemaVersion,
      JSON.stringify(event.payload),
      event.rawPayloadHash,
      event.correlationId ?? null,
    ]:[inboxId,event.controllerId,event.eventId,event.eventType,event.sourceSequence??null,event.sourceOccurredAt,event.receivedAt,event.schemaVersion,JSON.stringify(event.payload),event.rawPayloadHash,event.correlationId??null];
    const result = insert.run(...values);
    const row = find.get(event.controllerId, event.eventId) as InboxStatusRow;
    return {
      inboxId: row.id,
      duplicate: result.changes === 0,
      processingStatus: row.processing_status,
    };
  })();
}

/** Claims a received/failed event for a future processor. */
export function markAutomationEventProcessing(sqlite: Database.Database, inboxId: string): boolean {
  const result = sqlite.prepare(`
    UPDATE automation_event_inbox
    SET processing_status = 'PROCESSING',
        processing_attempts = processing_attempts + 1,
        processing_started_at = CURRENT_TIMESTAMP,
        processed_at = NULL,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND processing_status IN ('RECEIVED', 'FAILED')
  `).run(inboxId);
  return result.changes === 1;
}

export function markAutomationEventProcessed(sqlite: Database.Database, inboxId: string): boolean {
  const result = sqlite.prepare(`
    UPDATE automation_event_inbox
    SET processing_status = 'PROCESSED',
        processed_at = CURRENT_TIMESTAMP,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND processing_status = 'PROCESSING'
  `).run(inboxId);
  return result.changes === 1;
}

export function markAutomationEventFailed(
  sqlite: Database.Database,
  inboxId: string,
  errorMessage: string,
): boolean {
  const result = sqlite.prepare(`
    UPDATE automation_event_inbox
    SET processing_status = 'FAILED',
        processed_at = CURRENT_TIMESTAMP,
        last_error = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND processing_status = 'PROCESSING'
  `).run(errorMessage.slice(0, 4000), inboxId);
  return result.changes === 1;
}
