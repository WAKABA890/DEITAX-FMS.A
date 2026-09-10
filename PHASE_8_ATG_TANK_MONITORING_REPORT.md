# DT-FMS 2.1 Phase 8 — ATG & Tank Monitoring Report

## 1. Executive summary
Phase 8 is complete. DT-FMS now accepts vendor-neutral, normalized ATG observations through the existing durable automation pipeline, retains immutable evidence, exposes a read-only current projection/history, and displays all physical tanks. ATG data does not alter operational stock, deliveries, transactions, finance, meters, shifts, or reconciliation.

## 2. Scope
Implemented only tank-side ATG evidence, processing, validation, simulator scenarios, permission-protected read APIs, and a read-only monitoring UI. No Phase 9 work was implemented.

## 3. Architecture
Adapter → normalized envelope → durable `automation_event_inbox` → `AtgTankEngine` validation → atomic immutable reading/current projection/processing/audit update → permission-protected API → read-only React UI. ATG initialization is table-gated and controller failures remain isolated by the existing adapter manager.

## 4. ATG event contract
Supported normalized types: `ATG_TANK_READING`, `TANK_READING_RECEIVED`, `TANK_LEVEL_READING`, `TANK_VOLUME_READING`, `TANK_TEMPERATURE_READING`, and `TANK_WATER_LEVEL_READING`. Payloads may contain any combination of level (MM), volume (L), temperature (C), and water level (MM), plus station/product identity and an explicit sensor-reset flag. Missing values remain null and are never converted to zero.

## 5. Tank identity/mapping
Every accepted observation resolves an enabled controller and an active `TANK` device mapping to a real `fuel_tanks` record. Controller station, optional payload station, mapped tank, and configured product are validated before evidence is accepted.

## 6. Database design
Migration `033_atg_tank_evidence` adds exactly three tables: `automation_atg_readings`, `automation_atg_processing`, and `automation_atg_current_state`. It also adds lookup indexes for tank/controller time, anomaly, processing status, and freshness.

## 7. Historical evidence
`automation_atg_readings` is append-only application evidence with one row per controller/external-event identity. It retains source and receipt timestamps, hash, sequence, measurements, configured topology, prior reading link, processing result, and anomaly.

## 8. Current projection
`automation_atg_current_state` stores one current observation per physical tank. Partial updates use `COALESCE` so an omitted measurement does not erase a prior observed value. Duplicate and out-of-order readings remain in history but do not replace current state.

## 9. Validation rules
Validation covers event integrity, controller existence/enabled state, station scope, device type, tank mapping/existence/state, product consistency, finite/nonnegative physical values (temperature may be below zero), maximum three decimal places, exact units, sequence format, timestamps, and at least one measurement. Volume beyond configured tank capacity is retained as `VOLUME_OUT_OF_RANGE` evidence.

## 10. Freshness handling
The API derives `FRESH`, `STALE`, `OFFLINE`, or `UNKNOWN` from the last ATG receipt, controller status, and the existing station freshness setting. Freshness does not rewrite evidence.

## 11. Sequence handling
Missing, duplicate, out-of-order, and gap sequences are classified. Missing/gap observations are retained; duplicate/out-of-order observations are retained without moving the current projection backward.

## 12. Sensor/reset handling
Only an explicit `sensorReset: true` produces `SENSOR_RESET`. Ordinary reductions in level or volume are valid physical observations and are not classified as errors or resets.

## 13. Simulator implementation
The simulator is versioned `1.2.0-phase8` and emits ATG events through its normal `context.emit` path. It supports combined, level-only, volume-only, decrease, increase/delivery-observation, sequence-gap, and sensor-reset scenarios. It performs no hardware communication or inventory mutation.

## 14. UI implementation
The new “ATG & Tank Monitoring” tab shows every configured tank, mapping/controller state, freshness, observed level/volume/temperature/water level, sequence, and last timestamps. “ATG observed volume” and “DT-FMS recorded stock” are deliberately separate labeled fields. History and attention sections are read-only.

## 15. API endpoints
Added `GET /api/automation/atg/current`, `/attention`, `/history`, `/tanks/:id/history`, and `/controllers/:id`. History supports tank, product, controller, state, anomaly, date, and bounded-limit filters. There are no Phase 8 mutation endpoints.

## 16. Permissions
Added mandatory `VIEW_ATG_TANK_MONITORING`. Sidebar visibility, app tab access, and every ATG route use this permission; it is also available to the existing custom-role permission editor through the central permission catalogue.

## 17. Audit behavior
Accepted, anomalous, and rejected observations write structured automation log records linked to the durable inbox and controller. Permanent validation failures remain traceable with failure code/class/detail.

## 18. Station isolation
Station identity is derived server-side from DT-FMS configuration, not trusted from browser parameters. Controller-specific access verifies that the controller belongs to that station; ingestion rejects a conflicting payload station.

## 19. Migration details
Migration 033 is transactional and tracked in `schema_migrations`; it contains no deletes or core-table rewrites. It passed fresh database, current consistent database-backup, and older production-like copy upgrade tests. Re-running initialization is idempotent.

## 20. Files created
- `src/automation/atg/atg-tank-engine.ts`
- `src/automation/api/atg-router.ts`
- `src/components/automation/AtgTankMonitoring.tsx`
- `tests/atg-tank-monitoring.integration.test.ts`
- `tests/atg-concurrency.integration.test.ts`
- `tests/fixtures/phase8-concurrent-worker.ts`
- `PHASE_8_ATG_TANK_MONITORING_REPORT.md`

## 21. Files modified
- `src/database/seed.ts`
- `src/database/schema.ts`
- `src/database/validateSchema.ts`
- `src/automation/types/events.ts`
- `src/automation/adapters/adapter-manager.ts`
- `src/automation/adapters/simulator-adapter.ts`
- `src/services/automationApi.ts`
- `src/types.ts`
- `src/components/Sidebar.tsx`
- `src/App.tsx`
- `server.ts`
- `package.json`

## 22. Test results
Phase 8 integration tests passed combined and partial observations; null/missing semantics; normal level/volume decrease; temperature/water; capacity, product, unit, station, mapping, controller, timestamp, value, sequence, and reset handling; three-time duplicate replay; rollback/retry; integrity; and core non-mutation. The ATG simulator uses the same adapter/event pipeline covered by adapter regression and the Phase 8 adapter wiring.

## 23. Stress results
1,000 sequential ATG events were durably processed and counted exactly once. The database remained responsive and passed integrity/foreign-key checks afterward.

## 24. Restart/recovery results
A controlled database failure left the inbox retryable as `FAILED`; after removing the fault, replay completed the same durable event. Triple replay did not create duplicate evidence, and the shared durable recovery path remains covered by the foundation regression suite.

## 25. Concurrency results
Two independent Node processes delivered the same controller/event concurrently. Exactly one inbox/evidence identity survived and foreign-key checks remained clean.

## 26. Database integrity results
Fresh and copied databases returned `integrity_check=ok`, `foreign_key_check=0`, and schema validation passed. Constraints include unique inbox; unique controller/event on readings and processing; unique processing reading; primary key controller/external-tank plus unique physical tank on current state. Foreign keys connect evidence to inbox, controller, station, tank, product, and prior reading; processing to inbox/controller/reading; current state to controller/station/tank/product/current/prior reading.

## 27. Regression results
Passed: automation foundation, controller management, discovery/mapping, adapter framework, custom roles/shift history, live forecourt, customer/supplier identity, automated fuel transactions, and meter/totalizer suites. Existing data after consistent-copy migration remained users 7, permissions 52, tanks 3, pumps 3, nozzles 4, shifts 11, transactions 17, shop items 363, reconciliations 11.

## 28. Build results
`npm run lint`, `npm run db:validate`, `npm run desktop:build`, and `npm run desktop:dist` passed. Vite reported only its existing large-chunk advisory. Windows x64 NSIS installer produced: `release/DT-FMS2.0-Setup-1.0.1.exe`.

## 29. Packaged startup results
The packaged `release/win-unpacked/DT-FMS2.0.exe` launched with an isolated fresh profile using `--no-sandbox --disable-gpu`. Migration 033 and schema validation passed, automation initialized safely disabled, the internal server became ready, and the renderer reached ready-to-show. Test processes were stopped afterward.

## 30. Remaining issues
Low/pre-existing: Vite flags a large renderer chunk; Electron’s Node child logs the `fs.Stats` deprecation warning. The current DT-FMS database model remains a single configured station, so station scope is server-derived from that authoritative record. The first packaged launch without Chromium sandbox flags exited in this managed environment; the normal validation launch with standard CI-safe flags passed.

## 31. Explicit exclusions
No Phase 9 reconciliation, stock correction, inferred delivery creation, alerts, payment assignment, controller commands, polling, PTS2/vendor protocol, live hardware integration, pump control, automated reconciliation, or automated inventory mutation was implemented.

## 32. Phase 9 readiness assessment
Phase 8 acceptance gates passed: normalized ATG intake, mapping, immutable/current evidence, null handling, decrease semantics, anomalies, restart, concurrency, 1,000-event stress, permission/API/UI, migrations, integrity, prior regression, builds, packaging, startup, and core-data preservation.

**PHASE 9 READINESS: GO**

Implementation stops here. Phase 9 requires explicit user approval.
