# DEITAX FMS.A - Full System Code Audit Report

**Audit date:** 17 September 2026  
**Repository:** C:\DT-FMS2.1  
**Final release status:** **PARTIAL GO for single-station production deployment**

## Executive Summary

The active code has a durable SQLite ledger, PTS-2 read-only polling, exact equipment mapping, atomic PTS-2 sale/receipt/stock posting, separate meter and stock models, immutable manual-dip evidence, and separate ATG evidence.

This audit corrected two verified defects:

1. Mapped PTS-2 tank/probe IDs above 20 were silently ignored. The arbitrary limit is removed and tested for IDs 21 and 200.
2. Tank and delivery read APIs allowed every authenticated user to see operational data. They now require VIEW_PUMPS on the server and are covered by an authentication integration test.

The app is now explicitly enforced as one physical station per SQLite database. Startup and schema validation reject a database with more than one station, and a database trigger rejects a second station insert. Multi-station deployment remains unsupported and requires a separate station-scoped architecture.

No live PTS-2 request was sent and no production data was modified or fabricated.

## System Architecture Map

| Layer | Active implementation |
|---|---|
| Renderer | React/Vite: src/main.tsx, src/App.tsx, src/components, src/features |
| API | Express server.ts and src/automation/api routers |
| Persistence | SQLite/Drizzle in src/database |
| PTS-2 | src/automation/adapters, events, transactions, meters |
| Tank stock | src/automation/tank-stock.ts and fuel_tanks |
| ATG | src/automation/atg and atg-router |
| Reconciliation/alerts | src/automation/reconciliation and alerts |
| Desktop | electron/main.mjs, preload.mjs, server-runner.mjs |
| Tests | tests and scripts |

## Database Audit

**PASS for the checked current database.**

- Isolated migration/schema validation passed against a fresh temporary database.
- The current data/fms.db was read only. integrity_check returned ok.
- Foreign-key violations: 0.
- Duplicate receipt numbers: 0.
- Duplicate PTS-2 stock controller/event entries: 0.
- Orphaned automation mappings: 0.
- The database contains one station and the single-station insertion guard is installed.
- SQLite has foreign keys, WAL, busy timeout, and normal synchronous mode enabled.
- The PTS-2 transaction engine updates sale, receipt, tank balance, ledger, and stock audit inside a SQLite transaction.

## PTS-2 Integration Audit

**PASS in simulated/read-only tests; live controller not tested.**

- The adapter sends JSON PTS envelopes and requests PumpGetLastSavedTotals by mapped pump/nozzle.
- A saved-total configuration error falls back to live totals/status polling; it does not change controller configuration.
- Same-pump totalizer requests are serialized; different pumps can run concurrently.
- Completed dispenses use durable inbox/processing identities.
- Credentials come from the encrypted vault and are not logged in reviewed paths.
- No controller write/control request was issued during this audit.

## Transaction Audit

**PASS in targeted integration tests.**

A completed PTS-2 dispense is validated against controller, pump, nozzle, product, and exact tank mapping. It becomes a completed sale and receipt, deducts transaction litres from the mapped tank, and writes auditable ledger evidence atomically. It rejects unresolved tank mappings with PTS2_TANK_MAPPING_REQUIRED and suppresses duplicate events.

## Receipt Audit

**PASS.**

PTS-2 completed dispensing creates a completed receipt without a payment-pending confirmation. The transaction integration test verifies idempotent sale, receipt, and tank deduction behavior.

## Meter/Totalizer Audit

**PASS in integration tests.**

- Accepted PTS-2 totalizers update the nozzle current meter only.
- Meter processing never updates stock, cash, transactions, or shifts.
- Lower meters remain reset/decrease anomalies; they are not transformed with Math.abs.
- Dashboard Current Nozzle Reading renders the actual latest PTS-2 totalizer; calculated movement is separate.
- Opening/current/closing shift meter behavior passed targeted tests.

## Shift Audit

**PASS in targeted tests.**

Clock-in requests fresh mapped PTS-2 readings and fails safely when they are missing. Closing evidence and signed discrepancies are retained. Before-shift/unattended sales remain valid sales and stock deductions but are not added again to meter movement.

## Tank/Stock Audit

**PASS in targeted tests.**

FMS stock follows:

Opening balance + deliveries - completed fuel sales + authorised adjustments = current FMS balance.

PTS-2 sales deduct actual transaction litres, never totalizers, KES, or shift volumes. Ledger evidence stores before/after, source, reference, controller/event identity, transaction, actor, station/shift where available, and anomalies. RTT credit-note returns add stock to the mapped tank. Negative stock remains an anomaly.

## Manual Dip Audit

**PASS in targeted tests.**

Manual dips are immutable physical observations. They preserve tank, product, observed volume, expected balance, signed variance, time, actor, station, active shift, reason, and reference. Normal dips do not overwrite FMS stock. Admin/Super Admin initial-stock setup is the only dip mode that updates FMS balance. No calibration formula is invented.

## ATG Removal Audit

**PASS by code review and targeted tests.**

AtgTankEngine stores ATG readings/current state only. It does not update fuel_tanks.current_level_liters. The ATG API separately returns recordedStock (FMS balance) and observedVolume/level/temperature/water (sensor evidence).

## Product/Tank Mapping Audit

**PASS after correction.**

| Finding | Severity | Correction | Proof |
|---|---|---|---|
| Tank IDs above 20 ignored by AdapterManager | MEDIUM | Positive safe-integer validation now has no artificial upper cap | Adapter test passes for 1, 21, 200 |

Mapping validation requires exact controller/pump/nozzle/product/tank relationships and rejects ambiguity.

## Reconciliation Audit

**PASS in integration tests.**

Formula/tolerance/source-immutability, simultaneous-run convergence, interrupted-run recovery, and the API authorization/pagination suite passed. Reconciliation keeps cash, meter/dispenser, and tank/ATG variance distinct; ATG is evidence, not a stock overwrite.

## RBAC/Security Audit

**PASS for corrected checked paths; exhaustive route review remains incomplete.**

Global API authentication is enforced, then endpoint permissions are checked. Tank creation/deletion/dips, delivery logging, pumps, mappings, automation control, approvals, and audit logs use server-side checks.

| Finding | Severity | Correction | Proof |
|---|---|---|---|
| GET /api/tanks and GET /api/deliveries lacked authorization | HIGH | Both now require VIEW_PUMPS | Authentication test passes for 401 and 403 cases |

## Station Isolation Audit

**PASS for the approved single-station deployment scope.**

The current database contains exactly one station, station-1. The station_settings_singleton_insert trigger rejects another insert, startup rejects an existing database with more than one row, and validateDatabaseSchema verifies both conditions. This makes the existing first-station selectors deterministic for this deployment model.

Multi-station deployment is intentionally unsupported. It requires separate databases per station or a future migration that adds station keys across all core operational records.
## Frontend/API Contract Audit

**PASS for checked values.**

| UI value | Source of truth |
|---|---|
| Current Nozzle Reading | Accepted PTS-2 totalizer, projected to pump_nozzles.current_meter_reading |
| Opening/Closing Meter | Shift snapshots and immutable meter evidence |
| Shift Volume | Signed closing-minus-opening meter movement |
| Recorded Sales | Completed transaction records |
| FMS Tank Stock | fuel_tanks current balance plus tank ledger |
| Manual Dip | Immutable manual_tank_dips evidence |
| ATG volume | Automation ATG evidence only |

## Electron Audit

**PARTIAL PASS by static review.**

Electron starts one loopback server on an available port. Packaged mode supplies FMS_DB_PATH under Electron user data, separate from development data. The renderer has sandboxing, context isolation, disabled Node integration, and a narrow Excel-save IPC bridge. Packaged installer execution was not completed, so it is not passed.

## Offline/Recovery Audit

**PASS in integration tests.**

Tests cover bounded startup recovery, durable evidence, SQLite lock rollback, later successful writes, session preservation across backend restart, and fail-closed recovery API behavior. Durable inbox/processing identities suppress repeat events.

## Reporting Audit

**PARTIAL PASS by code review.**

Stock audit and ATG history use pagination and filters. PDF/Excel visual output and full report filtering are still unverified. The approved deployment is one station per database.

## Dead Code / Obsolete Code

Previously traced, unused duplicate components, obsolete adapter types, temporary test data, old reports, and generated artifacts were removed while retaining active source, migration, Electron, setup, and test files. No active ATG-to-stock mutation or old PTS-2 payment-pending posting path was found.

## Hard-Coded Limits

- Corrected: non-protocol PTS-2 tank ID cap of 20.
- Retained: pagination, input-precision, and request-time bounds.
- Enforced: one physical station per SQLite database; a second station is rejected.

## Errors Found

| Severity | Location | Problem | Status |
|---|---|---|---|
| HIGH | Core schema and station selectors | Ambiguous multi-station use was possible | Corrected by enforcing one station per database |
| HIGH | server.ts tank/delivery reads | Operational data authorization bypass | Corrected |
| MEDIUM | adapter-manager.ts mapped tanks | Valid probe IDs above 20 ignored | Corrected |
| MEDIUM | Validation environment | Complete regression coverage and package validation remain outstanding | Outstanding |

## Corrections Made

1. Added mappedTanksFromMappings in src/automation/adapters/adapter-manager.ts with positive safe-integer validation and no upper cap.
2. Added mapped PTS-2 tank ID regression coverage to tests/adapter-framework.integration.test.ts.
3. Added VIEW_PUMPS server-side authorization to GET /api/tanks and GET /api/deliveries.
4. Extended authentication integration coverage for those two endpoints.
5. Added a startup database invariant and database trigger that reject a second station.
6. Added single-station integration coverage and updated affected reconciliation and alert fixtures to the approved deployment model.

## Tests Executed

| Check | Result |
|---|---|
| npm run lint | PASS |
| npm run db:validate | PASS |
| Single-station database invariant | PASS; duplicate station rejected and configured station preserved |
| Read-only current database integrity/foreign-key/duplicate checks | PASS |
| Adapter framework integration | PASS, 4 tests |
| Authentication integration | PASS |
| Alerts integration | PASS, lifecycle/API/concurrency/restart |
| Automated fuel transactions | PASS |
| PTS-2 read-only adapter | PASS, 4 tests |
| PTS-2 shift meters | PASS, 2 tests |
| Manual tank stock | PASS |
| Reconciliation | PASS, core/concurrency/restart/API |
| Offline recovery | PASS, core and API |
| Meter totalizers broad suite | PASS, anomalies/correlation/recovery/concurrency/stress/isolation |
| ATG monitoring suite | PASS, evidence and concurrency tests |
| Device mapping suite | PASS, discovery/mapping/validation/permissions/audit/restart |
| Production build | PASS; renderer chunk-size warning remains |
| Electron package/installer | Not tested |
| Live PTS-2 validation | Not tested |

## Test Failures

No executed test returned an assertion failure. Incomplete commands are not counted as passed.

## Live Validation

**NOT TESTED.** No configured PTS-2 controller was contacted.

## Remaining Risks

1. **MEDIUM:** multi-station deployment is unsupported; each physical station must use its own database.
2. **MEDIUM:** Electron package/installer validation, safe live PTS-2 read-only validation, and unexecuted non-core tests remain outstanding.
3. **INFORMATIONAL:** review SQLite synchronous=NORMAL against the deployed power-loss and backup policy.

## Final Acceptance Matrix

| Area | Audit | Issues | Corrected | Tests | Status |
|---|---|---|---|---|---|
| PTS-2 | Pass | Tank ID cap | Yes | Adapter/read-only/shift | PASS, live pending |
| Transactions | Pass | None found | N/A | Transaction suite | PASS |
| Receipts | Pass | None found | N/A | Transaction suite | PASS |
| Meters | Pass | None found | N/A | Meter and shift suites | PASS |
| Shifts | Pass | None found | N/A | Shift suite | PASS |
| Tanks | Pass | Tank ID cap | Yes | Manual stock suite | PASS |
| Manual Dips | Pass | None found | N/A | Manual stock suite | PASS |
| ATG | Pass | None found | N/A | Evidence and concurrency tests | PASS |
| Reconciliation | Pass | None found | N/A | Core/concurrency/restart/API | PASS |
| RBAC | Pass | Two unguarded reads | Yes | Authentication test | PASS |
| Station Isolation | Pass | Single-station invariant | Yes | Schema and integration test | PASS |
| Database | Pass | None found | N/A | Schema/integrity | PASS |
| Frontend/API | Pass | None found in checked fields | N/A | Source trace | PASS |
| Electron | Partial | Package execution pending | N/A | Static review | PARTIAL |
| Recovery | Pass | None found | N/A | Core and API recovery | PASS |
| Reports | Partial | Station/visual validation pending | No | Source trace | PARTIAL |

## Final Release Status

**PARTIAL GO**

This build is cleared for the explicitly single-station production scope. One physical station must use one SQLite database. Before packaging and release distribution, execute Electron installer validation and safe PTS-2 read-only live validation. Multi-station deployment is not approved.
