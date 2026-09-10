# DT-FMS 2.1 Automated Station Edition — Phase 3 report

Date: 2026-08-31  
Repository: `C:\DT-FMS2.1`

## Scope completed

Phase 3 implements read-only simulator discovery, review-first device mapping, mapping validation and lifecycle/history, server-side authorization, audit logging, and a database-backed physical pump/nozzle/product topology view.

No real controller polling or connection, pump/nozzle command, automated transaction, dispensing/totalizer/ATG processing, automated reconciliation, automation alert engine, inventory mutation, or Phase 4+ workflow was implemented.

## Files created

- `src/automation/discovery/simulator-discovery-provider.ts`
- `src/automation/mappings/mapping-service.ts`
- `src/automation/api/mapping-router.ts`
- `src/components/automation/DeviceMappings.tsx`
- `tests/device-mapping.integration.test.ts`
- `PHASE_3_DEVICE_DISCOVERY_MAPPING_REPORT.md`

## Files modified

- `package.json`
- `server.ts`
- `src/App.tsx`
- `src/types.ts`
- `src/hooks/usePermissions.ts`
- `src/components/Sidebar.tsx`
- `src/components/UserManagement.tsx`
- `src/services/automationApi.ts`
- `src/database/schema.ts`
- `src/database/seed.ts`
- `src/database/validateSchema.ts`
- `tests/automation-foundation.integration.test.ts`
- `data/fms.db` (migration 025 only; operational row counts preserved)
- generated `dist/*` production build artifacts

## Database and migration changes

Numbered migration: `025_device_discovery_and_mapping`.

The existing `automation_device_mappings` table is atomically rebuilt and retained as the sole mapping table. Existing Phase 1/2 mapping rows are copied without deletion; legacy `ACTIVE` becomes `MAPPED`. It now supports `PUMP`, `NOZZLE`, `TANK`, and `PRODUCT`; target FKs reference the existing authoritative `pumps`, `pump_nozzles`, `fuel_tanks`, and `fuel_products` tables. It also retains external name/address/metadata, creator, last-discovered time, and the `MAPPED`, `DISABLED`, `CONFLICT`, and `ORPHANED` lifecycle.

Two minimum supporting tables were added:

- `automation_discovered_devices`: persistent, controller-scoped discovery snapshots. A device disappearing from a later snapshot is marked not present; mappings are never deleted.
- `automation_mapping_history`: immutable before/after lifecycle history with actor and timestamp.

Important constraints/indexes:

- Unique external identity per controller/type/parent/external ID.
- Partial unique active targets for physical pumps, nozzles, tanks, and controller product mappings.
- FKs to controllers, users, existing equipment/products, mappings, and station settings use update cascade/delete restrict.
- Discovery identity, current-presence, mapping status/targets, and history lookup indexes.
- Schema validation checks all Phase 3 columns, FKs, indexes, unique indexes, integrity, and foreign keys.

Migration 025 was exercised on a fresh database and on existing/production-like copied DT-FMS databases through the Phase 1/2 regression suites. It is transactional, idempotently recorded in `schema_migrations`, and does not reset or reseed data.

## API endpoints

Mounted under `/api/automation/device-mappings`:

- `GET /` — list mappings
- `GET /discovered` — list discovered devices and derived mapping state
- `GET /equipment` — complete persistent physical topology
- `POST /discover/:controllerId` — run read-only in-process simulator discovery
- `POST /validate` — validate a proposed mapping without writing
- `POST /` — create a mapping
- `GET /:id` — get a mapping
- `PATCH /:id` — change a mapping
- `POST /:id/disable` — retain and disable a mapping
- `POST /:id/restore` — revalidate and restore a mapping
- `GET /:id/history` — view mapping history

There is deliberately no delete endpoint.

## Discovery and mapping architecture

`SimulatorDiscoveryProvider` implements a future-facing read-only discovery contract and returns static pumps, nozzles, tanks, and products. It performs no network, socket, serial, HTTP, hardware, sales, stock, totalizer, or command operation. Discovery only upserts the discovery snapshot; users explicitly create mappings.

`MappingService` validates controller/station existence, discovery identity, equipment type/target existence, disabled pump/nozzle state, duplicate external identity, duplicate active target, external-nozzle parent mapping, physical-nozzle parent membership, and nozzle/tank product compatibility where an external product mapping exists. Validation failures are explicit and never silently resolved.

The authoritative relationship remains:

`station_settings → pumps → pump_nozzles → fuel_products`, with each nozzle also retaining its existing tank relationship. Automation records only reference these IDs. No duplicate station-equipment or product-assignment model was introduced.

Mapping and connection state remain separate. The UI shows `MAPPED`/`UNMAPPED` independently from connection `UNKNOWN`.

## UI

The permission-gated Automation → Device Mappings view provides:

- controller selection and simulator discovery;
- all/unmapped/mapped/conflict/disabled/orphaned filters;
- explicit map/change/disable/restore actions;
- immutable mapping history;
- complete physical-pump topology, including every pump even when unmapped;
- every configured nozzle and its existing database product assignment;
- explicit mapping state and independent `UNKNOWN` connection state.

All persistence and mutation use server APIs; the frontend never modifies SQLite directly.

## Permissions and audit

Added permissions:

- `VIEW_DEVICE_MAPPINGS`
- `MANAGE_DEVICE_MAPPINGS`

Super Admin retains the established bypass. Admin and all other roles require explicit grants. Every endpoint enforces authorization server-side.

Audit records cover mapping creation/change, per-equipment mapping change, disable, and restore. Mapping history separately records `CREATED`, `UPDATED`, `DISABLED`, `RESTORED`, and the reserved conflict-resolution lifecycle action. Audit descriptions contain identifiers/state only and no credentials or secrets.

## Validation and results

- Fresh database/migration/schema validation: passed.
- Existing and production-like copied database migration: passed via Phase 1/2 regression suites.
- Phase 3 mapping integration: 1/1 passed.
- Phase 1 automation foundation regression: 5/5 passed.
- Phase 2 controller management regression: 2/2 passed.
- Authentication integration: passed.
- Audit integration: passed.
- Shift-roster integration: passed.
- TypeScript (`tsc --noEmit`): passed with no Phase 3 errors.
- Frontend/server/desktop production build: passed; Vite emitted only its existing large-chunk warning.
- Production server startup using `data/fms.db`: passed.
- `/api/status`: HTTP 200; application root: HTTP 200; unauthenticated mapping API: HTTP 401.
- Actual database `integrity_check`: `ok`; `foreign_key_check`: zero violations.

Actual operational counts before and after migration 025 were unchanged: users 5, user permissions 52, products 3, tanks 3, physical pumps 3, nozzles 4, shifts 11, transactions 17, shop items 363, reconciliations 10, controllers 0, mappings 0. The new discovery/history tables start empty.

## Pre-existing issues observed

- Schema validation continues to preserve and report 7 historical transaction nozzle identifiers that predate physical nozzle FK enforcement; Phase 3 did not change them.
- The existing production bundle has a Vite large-chunk warning.
- Two legacy database-cleanup tests fail because their isolated fixture omits the pre-existing `reading_variances` table.
- Two raw Node test invocations fail to resolve an existing TSX/extensionless TypeScript import unless run through the intended TSX-aware harness.
- `critical-user-flows.integration.test.ts` has an existing unrelated assertion failure: “Edit User role changes must call the user-management API callback.”
- On this Windows host, some `tsx` subprocesses can hit `os.userInfo` ENOMEM; authentication, audit, and shift-roster checks passed with the same temporary preload workaround previously used in Phase 2. The workaround file was removed afterward.

None of these baseline issues originates in a Phase 3 file or behavior.

## Scope confirmation

Phase 3 stops at discovery, identification, mapping, validation, history, permissions/audit, and display. No Phase 4 or later automation functionality was implemented.
