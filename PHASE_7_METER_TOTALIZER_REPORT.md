# DT-FMS 2.1 — Phase 7 Meter & Totalizer Report

Date: 2026-09-02  
Workspace: `C:\DT-FMS2.1`  
Scope: Phase 7 meter and totalizer evidence processing only

## 1. Executive summary

Phase 7 adds a vendor-neutral, durable, read-only cumulative meter evidence layer through the established controller → adapter → normalized event → durable inbox → domain processor → database → UI architecture. It preserves the strict distinction between meter evidence, automated fuel transactions, inventory, and reconciliation.

The implementation passed fresh/existing/production-copy migrations, 1,000-event stress, true two-process duplicate processing, rollback/retry/restart, correlation, full Phase 1–6.5 regression, TypeScript, desktop/NSIS build, and packaged startup.

## 2. Architecture

`Simulator/Controller → ControllerAdapter → AutomationEventEnvelope → automation_event_inbox → MeterTotalizerEngine → immutable history/current projection → read-only API/UI`

The simulator cannot write meter tables. React cannot submit or edit meter evidence. Automation failures remain isolated from core DT-FMS startup and operations.

## 3. Event contract

The existing `TOTALIZER_READING_RECEIVED` event type is used with `TotalizerReadingPayload`:

- controller and external event identity from the envelope;
- device type `NOZZLE` and external nozzle identity;
- external pump identity;
- optional station and product identity;
- cumulative `totalizerValue`;
- unit `L`;
- optional explicit `resetIndicator`;
- source sequence, source timestamp, received timestamp, payload hash, and correlation ID from the envelope.

The value is cumulative. It never substitutes for dispensing quantity, and dispensing quantity never substitutes for the totalizer.

## 4. Database design

Migration `032_meter_totalizer_evidence` adds:

- `automation_meter_readings`: immutable accepted/anomalous reading history;
- `automation_meter_processing`: durable processing outcome/retry state;
- `automation_meter_current_state`: read-optimized last accepted state.

History stores controller/station/topology identity, cumulative value, previous evidence, calculated delta, timestamps, sequence, anomaly, transaction correlation, and inbox reference. Current state stores latest/previous values, delta, sequence, freshness inputs, last anomaly, and correlation.

Foreign keys protect inbox, controller, station, pump, nozzle, product, previous reading, and transaction relationships. Unique controller/event and inbox identities protect concurrent idempotency. Device/time, topology, anomaly, correlation, processing-status, and freshness indexes support reads.

## 5. Processing lifecycle

Inbox lifecycle remains `RECEIVED → PROCESSING → PROCESSED/FAILED`.

Meter-specific detail is `RECEIVED → VALIDATING → METER_PROCESSING → PROCESSED`, with permanent invalid data `REJECTED` and retryable runtime/database failures `FAILED`.

Evidence/current/log/inbox completion is committed transactionally. A temporary insertion failure rolls back evidence and current state, marks the inbox retryable, and succeeds safely after retry.

## 6. Validation rules

The processor validates:

- controller existence, station, enabled state;
- nozzle device type;
- active pump/nozzle mappings and relationship;
- active physical equipment;
- optional product match against the authoritative nozzle product;
- finite, non-negative cumulative values with at most three decimal places;
- litres only;
- valid source/received timestamps, future tolerance, and historical reasonableness;
- inbox identity and payload hash integrity.

Invalid events remain traceable in the inbox, meter processing row, and automation log without crashing Node/Electron.

## 7. Duplicate/idempotency strategy

`automation_event_inbox(controller_id, external_event_id)`, meter processing identity, and immutable history identity all enforce uniqueness in SQLite. Duplicate, triple duplicate, restart duplicate, and simultaneous two-process duplicate tests produce one logical reading, one processing result, and one current-state update.

## 8. Sequence handling

The processor classifies `MISSING_SEQUENCE`, `INVALID_SEQUENCE`, `DUPLICATE_SEQUENCE`, `SEQUENCE_GAP`, and `OUT_OF_ORDER`. A gap remains retained evidence and may advance current state because incomplete sequence evidence does not itself invalidate the cumulative reading. Duplicate/out-of-order readings never overwrite a newer accepted current value.

## 9. Meter decrease/reset handling

A decrease without explicit reset evidence is `METER_DECREASE`, retained in history, and cannot overwrite current valid state or produce negative volume. A decrease with adapter-supplied `resetIndicator: true` is `METER_RESET`; it is explicit evidence and may establish the new current baseline with no invented negative delta.

## 10. Rollover handling

No meter maximum exists in the current vendor-neutral configuration, so rollover is not guessed. A decrease is treated as `METER_DECREASE` unless explicit reset evidence exists. No vendor-specific rollover behavior was implemented.

## 11. Transaction correlation

When meter and Phase 6 dispensing events share a correlation ID, meter delta is compared with the immutable transaction quantity using a 0.001 L tolerance:

- equal: `MATCHED`;
- unequal: `MISMATCH` plus `METER_TRANSACTION_MISMATCH` evidence;
- unavailable identifiers/transaction: `NOT_AVAILABLE`.

Both meter delta and transaction volume are retained. Neither is rewritten and no reconciliation/variance/inventory action is created.

## 12. UI implementation

The new **Meters & Totalizers** automation tab shows every configured physical pump and nozzle, including unmapped/no-data equipment. It displays current totalizer, previous totalizer, meter delta, distinct dispensing-volume reference, timestamps, sequence, freshness, evidence state, anomaly, and transaction correlation.

A read-only attention area shows unknown/stale/offline, unmapped devices, sequence anomalies, decreases/resets, and mismatches. Immutable history is filterable by evidence/anomaly; APIs additionally support pump, nozzle, product, controller, state, anomaly, and ISO date filters. There are no edit/delete controls.

## 13. Simulator changes

The simulator version is now `1.1.0-phase7`, with deterministic cumulative state per external nozzle and scenarios for baseline/progression, sequence gap, decrease, explicit reset, and transaction correlation/mismatch inputs. Events still pass through the adapter callback and durable production inbox.

No network or hardware connector was added.

## 14. API endpoints

- `GET /api/automation/meters/current`
- `GET /api/automation/meters/history`

Both are authenticated, server-authorized, station-scoped from server records, parameterized, read-only, and return controlled errors without SQLite details.

## 15. Permissions

Viewing meters uses the existing `VIEW_AUTOMATION` permission consistently in Sidebar, React route gating, and server middleware. Super Admin remains role-derived. Other roles require an explicit grant/custom-role inheritance. No meter edit permission exists because evidence is immutable.

## 16. Audit behavior

Machine-generated readings use `automation_logs` categories such as `METER_READING_ACCEPTED`, `METER_READING_ANOMALY`, and `METER_READING_REJECTED`. No fake human audit event is created. Payload logs contain diagnostic identifiers/outcomes, not credentials or secrets.

## 17. Migration details

The actual next migration after Phase 6/6.5 was confirmed as 032. Migration 032:

- is additive and transactionally applied;
- creates no production meter seed rows;
- deletes no operational data;
- passes fresh database validation;
- passes existing/repeated validation;
- passes against an SQLite backup of the operational development database.

Copied database row counts before/after remained users 7, permissions 52, tanks 3, pumps 3, nozzles 4, shifts 11, transactions 17, shop items 363, and reconciliations 11.

## 18. Files created

- `src/automation/meters/meter-totalizer-engine.ts`
- `src/automation/api/meter-router.ts`
- `src/components/automation/MetersAndTotalizers.tsx`
- `tests/meter-totalizer.integration.test.ts`
- `tests/fixtures/phase7-concurrent-worker.ts`
- `PHASE_7_METER_TOTALIZER_REPORT.md`

## 19. Files modified

- `package.json`
- `server.ts`
- `src/App.tsx`
- `src/types.ts`
- `src/components/Sidebar.tsx`
- `src/services/automationApi.ts`
- `src/database/schema.ts`
- `src/database/seed.ts`
- `src/database/validateSchema.ts`
- `src/automation/types/events.ts`
- `src/automation/adapters/adapter-manager.ts`
- `src/automation/adapters/simulator-adapter.ts`

## 20. Test results

Dedicated Phase 7 integration suite: PASS.

Covered valid/sequential readings, delta, duplicate/triple/restart/concurrent duplicate, gaps, duplicate/out-of-order/missing sequences, decrease, explicit reset, invalid number/precision/unit/timestamp/controller station/device/topology/equipment/product, optional product, retryable DB failure, rollback, restart replay, correlation match/mismatch, simulator production path, and non-mutation.

## 21. Stress-test results

1,000 isolated meter events plus duplicate/anomaly/concurrency scenarios completed in approximately 12–17 seconds depending on the run. Evidence count was exact, state remained valid, SQLite integrity passed, and no permanent business data was created. The earlier Phase 4 100/500/1,000 event simulator burst also remained green.

## 22. Database integrity

- Fresh DB: schema PASS, integrity PASS, FK 0
- Copied existing DB through migration 032: integrity `ok`, FK 0
- Phase 7 stress DB: integrity `ok`, FK 0
- Packaged fresh DB: schema validation PASS
- Meter seed rows on production-like migration: 0
- Orphaned/duplicate meter identities: 0

## 23. Regression results

PASS:

- Phase 1 foundation 5/5
- Phase 2 controllers 2/2
- Phase 3 discovery/mapping 1/1
- Phase 4 adapter 3/3
- Phase 5 Live Forecourt 1/1
- Phase 6 automated transaction suite 1/1
- Phase 6.5 authentication, critical user flow, audit, roles/history, and shift roster
- account identity, database cleanup, nozzle/shift, pagination, printing, POS sales summary, shift summary, and tax engine
- TypeScript and schema validation

## 24. Build results

- TypeScript: PASS, zero diagnostics
- Vite frontend production build: PASS
- esbuild production server: PASS
- desktop build: PASS
- Windows x64 NSIS installer: PASS
- installer: `release/DT-FMS2.0-Setup-1.0.1.exe`

The existing Vite chunk advisory and electron-builder metadata/dependency advisories remain non-fatal.

## 25. Production startup results

The final packaged `release/win-unpacked/DT-FMS2.0.exe` was launched with a fresh isolated profile. Migration 032 and schema validation succeeded, automation initialized safely disabled, the internal server became ready, the renderer reached ready-to-show, and `/api/status` returned HTTP 200 with `status: online`.

An authenticated Super Admin session successfully loaded `/api/automation/meters/current`. All packaged test processes were removed afterward.

## 26. Remaining issues

- **LOW — DESIGN:** correlation is evaluated when meter evidence arrives. A transaction arriving later remains `NOT_AVAILABLE`; retrospective correlation can be considered in a future reconciliation-oriented phase without changing stored evidence.
- **LOW — DESIGN:** rollover remains unsupported until a trusted per-device maximum/configuration exists.
- **LOW — PRE-EXISTING:** the main frontend bundle triggers Vite's chunk-size advisory.
- **LOW — PRE-EXISTING:** packaged Node output includes the toolchain `fs.Stats` deprecation warning.
- **LOW — ENVIRONMENTAL:** installer compression/signing is slow on this Windows host but completed repeatably.

No CRITICAL, HIGH, or MEDIUM Phase 7 issue remains.

## 27. Explicit scope exclusions

Phase 7 did **not** implement ATG, tank automation, stock/tank adjustment, automated reconciliation, financial variance, payment/cash automation, alerts, equipment commands, pump/valve control, emergency shutdown, PTS2/vendor protocol, real network/hardware communication, or any Phase 8+ functionality.

## 28. Phase 8 readiness assessment

**PHASE 8 READINESS: GO**

Meter processing, durable history/current state, concurrent idempotency, anomalies, explicit reset behavior, transaction correlation/mismatch retention, non-mutation guarantees, database integrity, migrations, prior regression, TypeScript, Windows build/package, authentication/permissions, server-derived station scope, and packaged startup all pass.

Stop condition honored: implementation ends at Phase 7.
