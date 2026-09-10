# DT-FMS 2.1 — Phase 11 Offline & Recovery Hardening Report

## 1. Executive Summary
Phase 11 hardens local interruption, restart, replay, locking, connectivity, and shutdown behavior without converting DT-FMS into an offline-first or distributed system. Recovery restores processing state; it does not rewrite evidence or queue financial work offline.

## 2. Phase 10 Baseline
The Phase 6 transaction, Phase 7 meter, Phase 8 ATG, Phase 9 reconciliation, and Phase 10 alert/notification boundaries remain intact. Their tables, unique identities, evidence history, and APIs were reused.

## 3. Recovery Architecture
`RecoveryCoordinator` performs a bounded startup inspection before adapter event recovery. It classifies stale work, marks interrupted work explicitly, preserves permanent failures, records technical logs, and exposes a read-only health snapshot. Existing domain engines then replay eligible durable inbox evidence through their existing atomic/idempotent paths.

## 4. Connectivity State Model
The renderer displays `ONLINE`, `DEGRADED`, `OFFLINE`, or `RECOVERING`. `ONLINE` requires backend and database health. Unavailable controllers or pending/exhausted recovery work produce `DEGRADED`, not FMS `OFFLINE`. Failed heartbeat requests produce `OFFLINE`; restored contact refreshes authoritative application data.

## 5. Retry Policy
Startup event retry is bounded to three processing attempts. `RECEIVED` and transient `FAILED` evidence below the limit is eligible. Structural domain failures already classified `PERMANENT` remain non-retryable. Exhausted interrupted domain work becomes `FAILED/PERMANENT` with `RETRY_LIMIT`; there is no recursive or infinite retry. SQLite uses a 5-second busy timeout in the application, and transactions either commit or roll back.

## 6. Idempotency Guarantees
Controller/external-event uniqueness, one processing row per inbox item, atomic transaction posting, unique meter/ATG inbox identities, deterministic reconciliation scope keys, and station/deduplication alert identities remain authoritative. Restart, replay, delayed delivery, and concurrent duplicates reuse these constraints.

## 7. SQLite Recovery
Foreign keys remain enabled with WAL, `synchronous=NORMAL`, and `busy_timeout=5000`. Startup recovery uses an immediate transaction. A disposable two-connection lock test verifies a locked write fails without partial data, rollback removes the uncommitted record, and a later write succeeds.

## 8. Event Recovery
Stale `PROCESSING` inbox entries become explicit `FAILED` work. Eligible `RECEIVED/FAILED` events are replayed in received order with `EVENT_REPLAY` or `EVENT_RETRY` logs. Attempts at or above three remain identifiable and are not retried forever. Evidence is never deleted.

## 9. Phase 6 Transaction Recovery
Interrupted `VALIDATING`, `VALIDATED`, or `POSTING` rows are classified before inbox replay. Existing posting remains one SQLite transaction containing the business transaction, processing link, inbox completion, and log, preserving one external event to one business result.

## 10. Phase 7 Meter/Totalizer Recovery
Interrupted validation/projection work is recovered through the durable inbox and existing immutable reading identity. Duplicate, gap, out-of-order, decrease, and explicit reset handling remain unchanged; replay does not create a second reading or delta.

## 11. Phase 8 ATG Recovery
Interrupted validation/projection work follows the same bounded recovery path. Immutable readings and current projection remain transactional. Missing measurements remain `NULL`, ordinary decreases are not reclassified as resets, and recorded tank stock is not adjusted.

## 12. Phase 9 Reconciliation Recovery
`PENDING/RUNNING` runs are marked `FAILED` with explicit interruption detail. Existing deterministic retry, unique scope key, and transactional item persistence prevent duplicate runs or orphan lines. No variance correction is performed.

## 13. Phase 10 Alert/Notification Recovery
Alert persistence and in-app notification creation remain atomic. Acknowledgement, resolution, and dismissal are durable and survive restart. Pending delivery without confirmation becomes `FAILED`, never false `DELIVERED`. Email and SMS remain `NOT_CONFIGURED`.

## 14. Electron/Renderer Recovery
One managed five-second heartbeat uses a three-second abort deadline, prevents overlapping requests, removes its interval on unmount, retains the in-memory user during outages, shows honest offline state, and refreshes authoritative data after reconnection. Mutating core API calls report `Action unavailable while offline.` rather than using a local write queue.

## 15. Authentication/Session Recovery
Sessions remain in `auth_sessions`; backend restart tests reuse the original cookie and restore `/api/auth/me`. Roles, permissions, custom roles, `mustChangePassword`, login, and logout behavior were not weakened.

## 16. RBAC/Security
Recovery status is read-only, authenticated by the existing global API middleware, station-local, and exposes no token, password, secret, credential, or controller configuration. No replay mutation API was needed or added, avoiding a new privilege surface.

## 17. Station Isolation
Recovery operates only on rows already tied by existing controller/station and domain foreign keys. Existing Phase 6–10 isolation and API suites passed; no cross-station selector or client-supplied recovery station was introduced.

## 18. Tests
Added `offline-recovery.integration.test.ts` and `recovery-api.integration.test.ts`. Coverage includes stale states, retry exhaustion, idempotent repeated recovery, notification uncertainty, alert acknowledgement preservation, source-data preservation, technical logs, database locking/rollback, unauthenticated denial, SIGTERM/SIGINT, backend restart, session persistence, health response redaction, integrity, and foreign keys.

## 19. Stress Test
The existing simulator adapter burst test processed at least 1,000 normalized events within its bounded completion criterion. Phase 7 independently processed 1,000 meter readings. Duplicate/concurrency suites for transactions, meters, ATG, reconciliation, and alerts passed with no duplicate authoritative result or corrupted projection.

## 20. Migration Validation
Phase 11 required no new table or column: existing durable status, attempt, failure, log, notification, and session structures were sufficient. Fresh, existing `data/fms.db`, and `build/phase11-production-copy.db` validation passed. Pre-existing workspace migrations 036–038 were preserved and were not created or edited by Phase 11.

## 21. Database Integrity Validation
Fresh, existing, production-copy, test, and packaged databases returned `PRAGMA integrity_check = ok` and zero `foreign_key_check` violations. Operational counts remained 7 users, 52 permissions, 3 tanks, 3 pumps, 4 nozzles, 11 shifts, 17 transactions, and 11 legacy reconciliations.

## 22. Build Validation
TypeScript, Vite frontend, bundled server, Electron desktop build, and Windows x64 NSIS installer passed.

## 23. Packaged Application Validation
The unpacked packaged application started twice using the accepted host-specific `--disable-gpu` condition. Both runs started the backend and renderer path and returned HTTP 200 from `/api/status`. Startup recovery completed on each run. The packaged database remained valid. Server-level SIGTERM and SIGINT tests verified bounded adapter shutdown, HTTP close, global SQLite close, and clean restart.

## 24. Known Advisories
Existing Vite large-chunk, electron-builder metadata/duplicate-dependency, Electron `fs.Stats` deprecation, and host-specific headless GPU advisories remain. Headless Electron exits after renderer GPU termination on this host, but startup logs show the child FMS server is stopped and the second packaged launch succeeds. A direct Node type-stripping invocation of `shift-summary.test.ts` cannot resolve an extensionless internal import; the same test bundled using the repository convention passes.

## 25. Phase 12 Readiness
The durable local processing boundaries are now safer for future hardware work, but no hardware driver, PTS2/Wayne/serial integration, commissioning, cloud synchronization, payment automation, pump/nozzle control, or physical ATG communication was added.

## 26. Final GO/NO-GO
**GO.** Phase 11 acceptance evidence is green. Phase 12 is not started.

## Files Created
- `src/automation/recovery/recovery-coordinator.ts`
- `src/automation/api/recovery-router.ts`
- `src/components/ConnectivityIndicator.tsx`
- `tests/offline-recovery.integration.test.ts`
- `tests/recovery-api.integration.test.ts`
- `PHASE_11_OFFLINE_RECOVERY_REPORT.md`

## Files Modified
- `src/automation/events/event-ingestor.ts`
- `src/database/db.ts`
- `src/services/api.ts`
- `src/App.tsx`
- `server.ts`
- `package.json`
