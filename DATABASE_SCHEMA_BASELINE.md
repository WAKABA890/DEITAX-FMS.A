# DT-FMS database baseline — Phase 1

Baseline captured from `C:\DT-FMS2.1\data\fms.db` before Phase 1 automation migration.

## Runtime and migration architecture

- Engine: SQLite through `better-sqlite3`, with Drizzle declarations.
- Runtime path: `FMS_DB_PATH` when supplied; otherwise `data/fms.db`.
- Pragmas: `foreign_keys=ON`, WAL journal, `synchronous=NORMAL`, 5000 ms busy timeout.
- Bootstrap DDL and numbered migrations: `src/database/seed.ts`.
- Drizzle declarations: `src/database/schema.ts`.
- Validation: `src/database/validateSchema.ts` and `scripts/db-validate.ts`.
- Pre-Phase-1 migrations: 001 through 021 plus the legacy pump hierarchy data migration.

## Existing tables before Phase 1

`users`, `user_permissions`, `fuel_products`, `fuel_tanks`, `pumps`, `pump_nozzles`,
`nozzle_reading_history`, `shop_items`, `shifts`, `shift_schedules`, `shift_plans`,
`shift_assignments`, `reading_variances`, `transactions`, `document_counters`,
`customers`, `credit_notes`, `suppliers`, `supplier_payments`, `fuel_deliveries`,
`stock_adjustments`, `cash_flow_records`, `reconciliations`, `approvals`,
`manager_approvals`, `station_settings`, `audit_logs`, and `schema_migrations`.

The baseline database passed `PRAGMA integrity_check` and `PRAGMA foreign_key_check`.

## Drift found and disposition

1. `station_settings.cu_serial` existed in bootstrap/live SQLite but not in the Drizzle declaration. Phase 1 adds it to Drizzle and migration 022 ensures it exists in every upgrade path.
2. `pump_nozzles.physical_pump_id` was added historically without a physical SQLite FK, although Drizzle declared one. Phase 1 aligns Drizzle with physical reality and validates that every populated value resolves to `pumps.id`. Rebuilding this operational table solely to add the legacy FK is intentionally deferred because it would increase upgrade risk.
3. `transactions.nozzle_id` was added historically without a physical SQLite FK, although Drizzle declared one. The inspected database contains seven historical identifiers that no longer resolve to current nozzle rows. Phase 1 preserves this operational evidence, aligns Drizzle with physical reality, and reports the count during validation rather than deleting or rewriting transactions.
4. New Phase 1 automation tables use physical foreign keys, explicit `ON UPDATE CASCADE`, `ON DELETE RESTRICT`, named indexes, unique idempotency keys, and checks.

## Phase 1 migrations

- `022_reconcile_station_settings_schema`
- `023_add_automation_foundation`

Both run inside the existing per-migration SQLite transaction and are recorded once in `schema_migrations`.

