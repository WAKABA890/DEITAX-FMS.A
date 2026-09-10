# DT-FMS Automated Station Edition

## Existing-system architecture report and implementation blueprint

**Status:** Architecture and planning only. No production behavior, schema, route, UI, or packaging code has been changed.

**Repository reviewed:** `C:\DT-FMS2.1`

**Review date:** 2026-08-30

---

## 1. Executive decision

The Automated Station Edition should be an extension of the current DT-FMS core, not a second copy of it. The current product, tank, pump, nozzle, user, permission, shift, sale, inventory, reconciliation, report, approval, and audit concepts remain authoritative. A new automation boundary should ingest vendor/device data, normalize it, store immutable source evidence, and invoke narrowly defined core application services.

The safest target shape is:

```text
Physical equipment
  -> Forecourt controller / ATG
    -> Vendor adapter
      -> Durable inbox + normalized event envelope
        -> Automation processors
          -> Core application services
            -> Existing and automation SQLite tables
              -> REST + live update transport
                -> Automated Station UI
```

The first release must be read/monitor/record/reconcile only. Pump authorization, start, stop, price push, and other commands stay disabled until the monitoring path is proven in production and a separate control-safety phase is approved.

---

## 2. What exists today

### 2.1 Runtime architecture

```text
Electron main process (electron/main.mjs)
  -> starts bundled/local Node server on loopback and waits for readiness
  -> opens BrowserWindow at http://127.0.0.1:<port>
  -> exposes only native Excel save through context-isolated preload

Express/Vite process (server.ts)
  -> initializes/migrates SQLite through src/server/db-middleware.ts
  -> serves /api/*
  -> serves Vite middleware in development or dist assets when packaged

React renderer (src/App.tsx)
  -> restores cookie session
  -> fetches most application data into top-level component state
  -> switches tabs through local activeTab state (no router)
  -> passes data and callbacks down to page components

SQLite + Drizzle
  -> physical database: data/fms.db in development
  -> packaged path supplied by Electron through FMS_DB_PATH
  -> WAL, foreign_keys=ON, synchronous=NORMAL, busy_timeout=5000
  -> schema declarations in src/database/schema.ts
  -> hand-authored bootstrap/migrations in src/database/seed.ts
  -> query objects in src/database/queries.ts
```

### 2.2 Frontend findings

- React 19 with TypeScript, Tailwind/Vite, and local component state.
- `src/App.tsx` is the composition root and data orchestrator. It loads 21 datasets in parallel and refreshes most of them after mutations.
- There is no React Router, Redux, Zustand, or application context/provider layer. Navigation is `activeTab` state and conditional rendering.
- `src/services/api.ts` is the single renderer API facade. It sends same-origin cookies and, for many reads, falls back to initial fixture data when requests fail. Automation screens must not use fixture fallback because stale simulated equipment data could be mistaken for live state.
- `src/hooks/usePermissions.ts`, `src/types.ts`, `src/App.tsx`, and `src/components/Sidebar.tsx` jointly control UI visibility/actions. This duplication should be consolidated incrementally, not rewritten during the first automation phase.
- The top-level refresh model is acceptable for existing low-frequency business data but unsuitable for pump/nozzle telemetry. Automation needs scoped query hooks plus Server-Sent Events (SSE) or WebSocket updates.

### 2.3 Backend findings

- `server.ts` is approximately 196 KB and owns routing, authentication, authorization helpers, normalization, business rules, in-memory mirrors, and HTTP hosting.
- Sessions are random server-side tokens stored in an in-memory `Map`, delivered through the `fms_session` cookie. Sessions disappear on server/application restart.
- All `/api` routes except status/bootstrap/login/logout and first-user creation require a valid active user session.
- Authorization is enforced per endpoint by `requirePermission`; Super Admin bypasses explicit grants. Some station-manager variance permissions are special-cased.
- Mutations commonly update SQLite and then in-memory arrays. Automation processors must not mutate those arrays directly. Shared core services must become the only write path for sales, stock, totalizers, and reconciliation inputs.
- There is no general background-job host, durable queue, event bus, controller connection manager, or real-time push channel today.
- The server listens only on `127.0.0.1`, which is correct for the desktop-local API. Connections from the server to LAN controllers are outbound and should remain in the server process or an isolated worker.

### 2.4 Database findings

The current schema contains 26 business/migration tables:

- Identity/security: `users`, `user_permissions`.
- Fuel master/equipment: `fuel_products`, `fuel_tanks`, `pumps`, `pump_nozzles`, `nozzle_reading_history`.
- Retail/stock: `shop_items`, `stock_adjustments`.
- Shifts: `shifts`, `shift_schedules`, `shift_plans`, `shift_assignments`, `reading_variances`.
- Sales/customer: `transactions`, `document_counters`, `customers`, `credit_notes`.
- Supply/finance: `suppliers`, `supplier_payments`, `fuel_deliveries`, `cash_flow_records`.
- Control/reporting: `reconciliations`, `approvals`, `manager_approvals`, `station_settings`, `audit_logs`.
- Migration state: `schema_migrations`.

The live database check returned `integrity_check=ok` and zero `foreign_key_check` violations. However, schema alignment is not exact:

1. `station_settings.cu_serial` exists in the live table but is absent from `src/database/schema.ts`.
2. Drizzle declares `pump_nozzles.physical_pump_id -> pumps.id`, but the live SQLite table does not have that physical FK because the column was added by `ALTER TABLE`.
3. Drizzle declares `transactions.nozzle_id -> pump_nozzles.id`, but that physical FK is absent in the live database for the same migration-history reason.
4. `transactions.pump_id` and several generic `related_*`/reference fields are text without enforced FKs.
5. Most existing FK declarations use SQLite's default restrictive deletion behavior; deletion policy is not explicitly documented in schema code.
6. Migration logic is embedded in `src/database/seed.ts` (001-021), not separate migration files. Any automation migration must follow one consistent mechanism and be tested against both empty and upgraded databases.

These are not reasons to rewrite existing tables immediately. They require a baseline manifest, explicit drift tests, and carefully staged table rebuilds only where enforcement is needed.

### 2.5 Electron/package findings

- `electron/main.mjs` chooses a port, locates the bundled server, sets environment paths, spawns the server, waits up to 30 seconds for readiness, then loads the renderer.
- The application is sandboxed and context-isolated. `electron/preload.mjs` exposes only `saveExcelFile`.
- The package includes `electron/**/*`, `dist/**/*`, `package.json`, the native `better-sqlite3` package, and the icon; `asarUnpack` includes `better-sqlite3`.
- `npm run desktop:build` validates the DB, runs Vite, and bundles `server.ts`; `desktop:dist` then creates NSIS output.
- Controller drivers that introduce native dependencies would increase packaging risk. Prefer pure Node TCP/HTTP/serial libraries where possible, and validate native modules explicitly if unavoidable.

---

## 3. Existing module inventory

| Module | Purpose | Main frontend | Main API routes | Primary tables | Permission(s) | Automation impact |
|---|---|---|---|---|---|---|
| Authentication | PIN login, session restore/logout, forced PIN change | `Login.tsx`, `Signup.tsx`, `App.tsx` | `/api/auth/*` | `users`, `user_permissions`, `audit_logs` | authenticated session; user-management grants | Preserve. Extend audit/security only. |
| Dashboard | Sales, staff, tank and operational summary | `Dashboard.tsx` | `/api/dashboard-summary`, `/api/status` | `transactions`, `shifts`, `fuel_tanks`, approvals | authenticated | Add automation widgets through a separate summary endpoint; do not overload initial bootstrap. |
| POS | Fuel/shop sale capture and receipt flow | `PointOfSale.tsx`, `ReceiptModal.tsx` | `GET/POST /api/sales` | `transactions`, products, nozzles, shop stock, shifts, customers, counters, readings | authenticated operational user | Modify behind a shared sale-posting service. Automated dispense must not fabricate payment. |
| Shifts | Plans, assignments, clock-in, reading snapshots | `ShiftManagement.tsx` | `/api/shifts*`, `/api/shift-plans*`, `/api/schedules*` | shift tables, users, readings, variances | view/create/edit/assign/remove/clock-in grants | Integrate automatic opening/closing evidence without removing manual fallback. |
| Pumps & Tanks | Product, tank, physical pump/nozzle setup; dips/deliveries | `PumpsAndTanks.tsx` | `/api/pumps*`, `/api/pump-units*`, `/api/tanks*`, `/api/products*`, `/api/deliveries*`, `/api/nozzle-readings` | fuel master/equipment, deliveries, readings | `VIEW_PUMPS`, `MANAGE_PUMPS`, `DELETE_PUMP`, `EDIT_PRICE`, `ADJUST_STOCK` | Preserve master data; add mapping links and automation badges. Mapping remains a separate screen/table. |
| Reconciliation | Current three-way shift variance ledger | `ReconciliationLedger.tsx` | `/api/reconciliations*`, `/api/reading-variances*` | reconciliations, shifts, transactions, readings, variances | view/manage ledger; variance grants | Preserve. New automated engine produces evidence/cases; posting remains controlled. |
| Cash Flow | Receipts/payments/account entries | `CashFlowLedger.tsx` | `/api/cash-flow*`, customer repayment | cash flow, transactions, deliveries, payments, users | view/manage cash flow | Consume links from automation reconciliation; no device writes. |
| Suppliers/OMCs | Supplier registry, balances, payouts | `SuppliersManagement.tsx` | `/api/suppliers*` | suppliers, supplier payments, deliveries, cash flow | supplier grants | Preserve. Delivery workflow later links detected delivery candidates. |
| Stock & Inventory Audit | Manual movements and movement history | `StockManagement.tsx` | `/api/stock/adjustments*` | stock adjustments, tanks, shop items, deliveries | `VIEW_STOCK`, `ADJUST_STOCK` | Keep posting authority. Automation creates proposed movements/evidence only. |
| Invoices/Receipts/Debt | Documents, credit customers, credit notes | `InvoicesAndReceipts.tsx` | `/api/sales`, `/api/customers*`, `/api/credit-notes*` | transactions, customers, credit notes, counters | invoice/customer/credit-note grants | Preserve. Automated transaction can link after payment/document workflow. |
| Shop Retail | Shop catalog and stock | `ShopInventory.tsx` | `/api/shop*` | shop items, adjustments | view and granular CRUD grants | Unchanged. |
| Approvals | Manager exception approvals | `ManagerApprovals.tsx` | `/api/approvals*` | approvals, manager approvals, audit | view/manage approvals | Reuse workflow where suitable; automation cases need typed history. |
| Station Settings | Invoice/payment/station identity settings | `StationSettings.tsx` | `/api/settings` | station settings | view/manage settings | Preserve. Edition/automation defaults may be separate settings records. |
| Users/Roles/Permissions | User lifecycle and per-user grants | `UserManagement.tsx` | `/api/users*`, `/api/users/:id/permissions` | users, user permissions, audit | view/create/manage/reset grants | Extend the permission catalog and UI. |
| Audit Trail | Paginated/filterable security/business log | `AuditTrail.tsx` | `/api/audit-logs` | audit logs | `VIEW_AUDIT_TRAIL` | Reuse for human/config actions. High-volume protocol telemetry belongs in separate logs. |
| Reports | Operational and financial reports/exports | `Reports.tsx` | data assembled from existing APIs | most business tables | `VIEW_REPORTS` | Add automation reports in later phases through purpose-built aggregate endpoints. |

Core modules that remain functionally unchanged in the first four phases: authentication, POS UI, shop, cash flow, customers, suppliers, invoices, existing reports, existing reconciliation UI, and manual pump/tank operations.

Modules requiring eventual integration: app/sidebar navigation, permissions, pump/tank setup, shifts, transaction posting service, reconciliation, audit, reports, database validation, Electron startup/shutdown, and packaging checks.

---

## 4. Target bounded architecture

```text
┌──────────────────────── Station LAN ────────────────────────┐
│ Pumps / nozzles / ATG -> controller(s)                      │
└───────────────────────────┬─────────────────────────────────┘
                            │ vendor protocol
┌──────────────────────── Desktop server process ─────────────┐
│ Adapter runtime                                             │
│  PTS2 | Wayne | Generic HTTP/TCP | Simulator                │
│       -> canonical envelope validator                       │
│       -> durable event inbox (unique source event key)      │
│       -> mapping resolver                                   │
│       -> ordered/idempotent processors                      │
│          ├─ status projection                               │
│          ├─ transaction staging                             │
│          ├─ totalizer history                               │
│          ├─ tank history/live projection                    │
│          ├─ alert rules                                     │
│          └─ reconciliation cases                            │
│       -> Core services (sales, stock, audit, approvals)      │
│       -> REST query API + SSE live stream                    │
└───────────────────────────┬─────────────────────────────────┘
                            │ same-origin localhost
┌──────────────────────── React renderer ─────────────────────┐
│ Automation Dashboard | Live Forecourt | Controllers         │
│ Transactions | Tanks | Reconciliation | Alerts | Logs       │
└─────────────────────────────────────────────────────────────┘
```

### Required backend modularization

Create backend modules under `src/automation/`:

- `types/`: canonical envelopes, normalized states, readings, transactions, error contracts.
- `adapters/`: vendor implementations and adapter registry; no core DB writes.
- `controllers/`: lifecycle supervision, connection retry, health and configuration resolution.
- `events/`: validation, durable inbox, deduplication, ordering, dispatch, dead-letter handling.
- `services/`: mappings, status projection, transaction staging, totalizers, tanks, delivery candidates.
- `monitoring/`: heartbeat, stale-data rules, metrics, structured protocol logs.
- `reconciliation/`: immutable inputs, calculation engine, variance/case workflow.
- `alerts/`: rule evaluation, deduplication, acknowledgement/resolution history.
- `commands/`: interfaces and persistence only at first; execution feature flag remains off.
- `api/`: Express routers/DTO mapping. This prevents further growth of `server.ts`.
- `simulator/`: deterministic fake controller scenarios and replay fixtures.

Frontend automation components should live under `src/components/automation/`, with scoped hooks under `src/hooks/automation/` and API methods under `src/services/automationApi.ts`.

### Core-service seam

Before automated sales post into `transactions`, extract existing sale and inventory mutations from `server.ts` into transactional services such as:

```ts
interface CoreTransactionService {
  stageAutomatedDispense(input: NormalizedFuelTransaction): Promise<StagedResult>;
  attachPayment(stagedId: string, payment: PaymentInput, actor: Actor): Promise<void>;
  postCompletedSale(stagedId: string, actor: Actor): Promise<Transaction>;
}
```

The adapter never calls `transactionQueries.create` or changes tank/nozzle values. It only emits normalized events.

---

## 5. Canonical adapter contract

```ts
type ControllerState = 'ONLINE' | 'OFFLINE' | 'CONNECTING' | 'ERROR' | 'DISABLED';
type EquipmentState =
  | 'ONLINE' | 'OFFLINE' | 'IDLE' | 'AUTHORIZED'
  | 'DISPENSING' | 'STOPPED' | 'ERROR' | 'UNKNOWN';

interface AutomationEventEnvelope<TPayload> {
  eventId: string;             // stable vendor ID, or deterministic adapter-generated key
  eventType: AutomationEventType;
  controllerId: string;
  sourceSequence?: string;
  sourceOccurredAt: string;
  receivedAt: string;
  schemaVersion: 1;
  payload: TPayload;
  rawPayloadHash: string;
  correlationId?: string;
}

interface ControllerAdapter {
  readonly type: string;
  validateConfig(config: AdapterConfig): Promise<ValidationResult>;
  connect(context: AdapterContext): Promise<void>;
  disconnect(reason: string): Promise<void>;
  getHealth(): AdapterHealth;
  synchronize(cursor?: SyncCursor): AsyncIterable<AutomationEventEnvelope<unknown>>;
  events(): AsyncIterable<AutomationEventEnvelope<unknown>>;
  capabilities(): ReadonlySet<AdapterCapability>;
}
```

Normalized event types for the first releases:

- `CONTROLLER_STATUS_CHANGED`
- `PUMP_STATUS_CHANGED`
- `NOZZLE_STATUS_CHANGED`
- `FUEL_TRANSACTION_STARTED`
- `FUEL_TRANSACTION_UPDATED`
- `FUEL_TRANSACTION_COMPLETED`
- `TOTALIZER_READING_RECEIVED`
- `TANK_READING_RECEIVED`
- `DELIVERY_CANDIDATE_DETECTED`
- `EQUIPMENT_ERROR_REPORTED`

Adapter requirements:

1. Translate vendor statuses at the boundary.
2. Preserve raw payload evidence and hash it, but redact credentials/secrets.
3. Produce deterministic IDs when the vendor has no event ID.
4. Advertise capabilities; never infer command support.
5. Be cancellable and tolerate disconnect/reconnect.
6. Never write business tables.

---

## 6. Controller and credential model

`automation_controllers` stores non-secret configuration: station scope, display name, adapter type, host, port, transport, enabled state, desired configuration, status, last communication, firmware, reconnect policy, and timestamps.

Credentials must not be stored as plaintext JSON. Store only `credential_ref` in SQLite. For the desktop edition, resolve that reference through Electron `safeStorage` or Windows Credential Manager via a narrow IPC/service boundary. If OS-protected storage is unavailable, controller activation must fail closed rather than falling back to plaintext. API responses must never return secret values; they may return `credentialsConfigured: true`.

Connection lifecycle:

```text
DISABLED -> CONNECTING -> ONLINE
                    \-> ERROR -> exponential backoff + jitter -> CONNECTING
ONLINE -- heartbeat stale/disconnect --> OFFLINE -> backoff -> CONNECTING
```

Persist state transitions and update a current-state projection. Rate-limit repetitive logs and alerts.

---

## 7. Device mapping architecture

External identifiers are scoped to a controller and equipment type; they never replace DT-FMS IDs.

```text
(controller_id, external_pump_id)   -> pumps.id
(controller_id, external_pump_id,
 external_nozzle_id)                -> pump_nozzles.id
(controller_id, external_tank_id)   -> fuel_tanks.id
```

Mappings have `ACTIVE`, `DISABLED`, or `CONFLICT` status, effective timestamps, validation state, and audit metadata. Unique constraints prevent one external address mapping twice and, by default, prevent one internal device from being actively mapped twice to the same controller. Mapping changes are configuration actions and do not rewrite historical automation events.

Activation validation must confirm:

- referenced controller and internal equipment exist and are enabled;
- nozzle belongs to the selected physical pump;
- nozzle product/tank assignments are present;
- discovered vendor product identity is compatible, if supplied;
- no active conflicting mapping exists.

Unmapped events remain safely stored with `UNMAPPED` processing status and generate a deduplicated warning; they do not create transactions or inventory movements.

---

## 8. Database change proposal

### 8.1 Baseline first

Before table 1 is added:

1. Generate a checked-in schema manifest from a fresh DB and an upgraded fixture.
2. Reconcile `cu_serial` between physical DDL and Drizzle.
3. Document the two missing physical FKs and decide whether to rebuild those existing tables in a dedicated, reversible migration—not in the first automation migration.
4. Expand `validateSchema.ts` to validate every automation table, index, unique key, FK, and migration version.
5. Back up the database before migrations and record migration results in startup logs.

### 8.2 Proposed new tables

| Table | Role and essential constraints |
|---|---|
| `automation_controllers` | Controller config/status. Unique `(station_id, name)` and optional unique network identity. `station_id` should reference an introduced station entity only if multi-station is truly implemented; for the current single-station product, reference `station_settings.id`. Restrict deletion when dependent history exists; prefer disable. |
| `automation_controller_logs` | Structured, redacted connection/protocol logs with controller/time/level indexes and retention policy. |
| `automation_pump_mappings` | FK controller -> controllers, pump -> pumps; unique `(controller_id, external_pump_id)`. |
| `automation_nozzle_mappings` | FK controller/pump mapping/nozzle; unique external nozzle address; preserve mapping version/history. |
| `automation_tank_mappings` | FK controller -> controllers, tank -> fuel_tanks; unique `(controller_id, external_tank_id)`. |
| `automation_event_inbox` | Durable raw/normalized envelope. Unique `(controller_id, event_id)`; alternate unique `(controller_id, source_sequence, event_type)` when applicable. Status, attempts, error, received/processed timestamps, raw hash. |
| `automation_transactions` | Staged device transaction. Unique `(controller_id, external_transaction_id)`. FKs to mapped pump/nozzle/product/tank and optional core `transactions.id`; status machine separates `RECEIVED`, `VALIDATED`, `STAGED`, `POSTED`, `REJECTED`, `DUPLICATE`, `REVIEW_REQUIRED`. |
| `automation_transaction_events` | Immutable lifecycle events for each automated transaction. Unique source event FK to inbox. |
| `nozzle_totalizer_readings` | Immutable volume/money totalizers; FK nozzle/controller/event/transaction; unique source event or deterministic reading key; indexes `(nozzle_id, reading_at DESC)` and `(controller_id, reading_at)`. This complements rather than replaces `nozzle_reading_history`. |
| `tank_reading_history` | Immutable ATG readings: volume, ullage, water, temperature, height, capacity, quality/status, source time. Unique source event/read key; index `(tank_id, reading_at DESC)`. |
| `tank_live_readings` | One projection row per tank (`tank_id` PK/FK) pointing to latest history row; updated transactionally. It is a cache, never evidence. |
| `automation_equipment_status` | Current projection per controller/equipment key with normalized state, fault, last communication, source event. Unique equipment identity. Status history can be reconstructed from inbox initially; add a separate history table only if retention/query needs justify it. |
| `automation_delivery_candidates` | Detected before/after readings, measured delta, confidence, validation/approval/posting states; optional FK to `fuel_deliveries` only after approval. |
| `automation_reconciliation_runs` | Scope, period, immutable calculation version, expected/actual totals, status, initiator/timestamps. |
| `automation_reconciliation_lines` | Per source/dimension expected, actual, variance, tolerance, outcome and evidence references. |
| `automation_alerts` | Current alert/case record; severity `INFO/WARNING/CRITICAL`, dedupe key, source, status, acknowledgement/resolution actors/times. Unique active dedupe key via partial unique index. |
| `automation_alert_history` | Immutable alert transitions and notes. |
| `automation_sync_cursors` | Last confirmed vendor cursor/sequence per controller/stream and gap state. |
| `automation_commands` | Future command request/status record. Create only when command design is approved; no execution in initial release. |
| `automation_command_logs` | Immutable future attempts/responses/timeouts, redacted. |

Avoid a separate `automation_products`, `automation_pumps`, `automation_nozzles`, `automation_tanks`, `automation_users`, `automation_sales`, or `automation_inventory` table. Existing core tables remain authoritative.

### 8.3 Deletion and retention policy

- Controllers and mappings: disable/retire; restrict hard delete once evidence exists.
- Inbox/raw logs: configurable retention, with event envelope and hash retained longer than bulky raw payload if required.
- Transactions, totalizers, tank readings, alert history, reconciliation evidence: immutable; corrections are appended records.
- Core master records referenced by history: restrict deletion. Existing cleanup helpers must be reviewed before adding automation FKs.
- Every migration explicitly names indexes and FKs and includes an upgrade rollback/recovery procedure (SQLite migrations themselves remain forward-only in production).

---

## 9. Live Forecourt design

### Query model

`GET /api/automation/forecourt` returns every configured core pump, left-joined to mappings and current equipment state. Offline, disabled, unmapped, and never-seen pumps remain present.

`GET /api/automation/stream` provides authenticated SSE events for status/transaction/alert projection changes. SSE is preferred initially because the UI only needs server-to-client updates; commands are out of scope. Include heartbeat, event IDs, reconnect support, and permission checks.

### UI hierarchy

- Summary bar: controller online/offline, pumps by state, active dispensing, critical alerts, stale-data indicator.
- Pump grid: all physical pumps sorted by pump number.
- Pump card: internal name/number, mapped controller address, normalized state, last communication, fault.
- Nozzle rows: every configured nozzle, product/tank, state, active volume/amount where supplied.
- Staleness is explicit (`Live`, `Stale`, `Never seen`); the UI never labels cached data as live.
- Details drawer: recent normalized events, mapping identity, totalizer, and related alert—no raw secret-bearing protocol dumps.

Permissions: `VIEW_LIVE_FORECOURT` for the page/stream. Mapping or controller actions are not embedded in the live card for ordinary viewers.

---

## 10. Automated transaction flow

```text
Adapter receives completion
 -> validate envelope/schema/ranges
 -> INSERT event inbox (unique source key)
    -> duplicate: return prior outcome, no side effects
 -> resolve pump/nozzle mapping
    -> unmapped/conflict: REVIEW_REQUIRED + alert
 -> upsert staged automation transaction under DB transaction
 -> verify sequence/timestamps/totalizer monotonicity/product/price
 -> link transaction lifecycle evidence
 -> wait for business completion policy
    -> payment/attendant/customer may arrive from POS/controller integration
 -> invoke core posting service exactly once
 -> set core_transaction_id and POSTED in same DB transaction
 -> update projections and emit UI notification after commit
```

Rules:

- Primary idempotency: unique `(controller_id, external_transaction_id)`.
- Event idempotency: unique `(controller_id, event_id)`.
- A posted automation record has at most one core transaction, enforced by unique `core_transaction_id`.
- Volume, price, total, opening/closing totalizers, and event times are validated; discrepancies create review cases, not silent corrections.
- A completed dispense is not automatically a paid sale. Preserve a staged/unpaid state until the configured business workflow supplies payment/document information.
- Inventory movement occurs only through the same atomic core posting service as manual sales.

---

## 11. Totalizer design

Store every accepted reading as an immutable record with reading kind (`VOLUME`, `MONEY`), source (`PERIODIC`, `TRANSACTION_OPEN`, `TRANSACTION_CLOSE`, `SHIFT_OPEN`, `SHIFT_CLOSE`, `SYNC`), vendor precision/unit, source time, receive time, and evidence event.

Checks include monotonicity, rollover/reset detection, implausible jump, time regression, and transaction delta comparison. A reset never overwrites history; it starts a reviewed totalizer segment. The existing `pump_nozzles.current_meter_reading` may remain a core operational projection, while `nozzle_totalizer_readings` becomes authoritative evidence for automation.

---

## 12. Tank/ATG and delivery flow

```text
ATG reading -> inbox -> mapping -> immutable tank_reading_history
 -> update tank_live_readings projection
 -> thresholds/rate-of-change rules
 -> live monitoring + alerts + reconciliation input

Sustained positive stock movement
 -> delivery candidate with before/after evidence
 -> operator validates supplier/product/tank/time window
 -> manager approves measured vs declared variance
 -> existing delivery/posting service creates fuel_deliveries + stock movement
 -> candidate links posted delivery and audit record
```

Detection must account for concurrent dispensing, sensor noise, thermal effects, and controller gaps. Use configurable thresholds and a stabilization window. Never update `fuel_tanks.current_level_liters` or post inventory solely because one reading increased.

---

## 13. Automated reconciliation architecture

The engine consumes immutable evidence for a defined station/controller/shift/time range:

```text
Expected dispense = closing volume totalizer - opening volume totalizer
Actual automated dispense = sum(valid completed automation transactions)
POS posted sales = sum(linked core fuel transactions)
Payments = sum(payment/accounting evidence)
Tank movement = opening stock + approved deliveries - closing stock
```

Each result line stores `expected`, `actual`, signed `variance`, tolerance, unit, calculation version, and evidence IDs. Do not mutate the line when investigated; append decisions/history. Outcomes are `MATCHED`, `WARNING`, `INVESTIGATION_REQUIRED`, `APPROVED_VARIANCE`, or `RESOLVED`.

The existing three-way ledger remains available. The automated engine initially runs alongside it and may later supply trusted inputs through an explicit adapter, after parity tests demonstrate that manual results are unchanged.

---

## 14. Alert architecture

Alert rules consume normalized events/projections, not vendor codes. Initial rules:

- controller offline/stale;
- pump/nozzle offline or error;
- unmapped device event;
- duplicate storm or sequence gap;
- low stock/high water/invalid ATG reading;
- transaction/totalizer/reconciliation discrepancy;
- unexpected dispense outside an authorized business context.

State machine:

```text
OPEN -> ACKNOWLEDGED -> RESOLVED
  \-> SUPPRESSED (time-bounded rule, privileged and audited)
RESOLVED -> OPEN when condition recurs (new occurrence/history)
```

Use a rule-defined dedupe key so repeated heartbeats do not create alert floods. Every transition includes actor/source, timestamp, notes, prior/new status, and audit correlation.

---

## 15. Security and permission model

Add these catalog permissions:

- `VIEW_AUTOMATION`
- `VIEW_LIVE_FORECOURT`
- `VIEW_AUTOMATED_TRANSACTIONS`
- `VIEW_TANK_MONITORING`
- `VIEW_AUTOMATED_RECONCILIATION`
- `VIEW_AUTOMATION_ALERTS`
- `ACKNOWLEDGE_AUTOMATION_ALERTS`
- `RESOLVE_AUTOMATION_ALERTS`
- `VIEW_AUTOMATION_LOGS`
- `MANAGE_CONTROLLERS`
- `MANAGE_DEVICE_MAPPINGS`
- `MANAGE_AUTOMATION_SETTINGS`
- `RUN_AUTOMATED_RECONCILIATION`
- `APPROVE_AUTOMATION_POSTING`
- `EXECUTE_AUTOMATION_COMMANDS` (defined only when commands are implemented)

Super Admin retains the existing bypass. No other role gets automation grants merely from its role name; seed recommended grants explicitly and let administrators assign them. Every automation endpoint checks its action permission server-side, and the SSE stream revalidates authentication/permission on connection.

Audit human/configuration actions in `audit_logs`: controller create/update/enable/disable, credential replacement (never the secret), mapping changes, alert actions, transaction intervention, reconciliation decision, delivery approval/posting, settings changes, and future commands. Protocol chatter and automatic health transitions go to structured automation logs/history with correlation IDs.

Additional controls:

- Validate hosts/ports and block dangerous unexpected destinations; controller connectivity is station-admin configuration.
- Redact auth headers, tokens, PINs, and controller credentials at ingestion and logging boundaries.
- Apply request/body limits and Zod validation to all new routes/events.
- Add rate limits/lockout policy to authentication before any remote-access deployment; current loopback-only design reduces but does not eliminate local risk.
- Use CSRF protection or strict same-origin checks on state-changing routes because authentication is cookie based.

---

## 16. Offline, restart, and recovery strategy

1. **Write before process:** persist an inbox event before applying side effects.
2. **Atomic processing:** mark event processed and commit derived records/core link in one SQLite transaction where possible.
3. **Leases, not memory flags:** recover `RECEIVED`/expired `PROCESSING` rows at startup.
4. **Cursor per stream:** store last confirmed sequence/cursor and requested replay range.
5. **Gap detection:** quarantine out-of-order items until a bounded wait/replay; never invent missing transactions.
6. **Idempotent replay:** duplicates resolve to the recorded prior result.
7. **Backoff:** exponential reconnect with jitter and a cap; manual disable cancels reconnect.
8. **Stale projections:** keep last known state but label it stale/offline.
9. **Startup order:** migrate/validate DB -> recover inbox -> start supervisors -> declare automation ready -> serve UI health.
10. **Shutdown order:** stop accepting events -> disconnect adapters -> finish/return leased jobs -> checkpoint durable state -> close server/database.

SQLite remains viable for a single-station desktop event rate if transactions are short, WAL is retained, payload sizes are bounded, and retention is managed. Multi-station central aggregation should be a later service architecture, not forced into this desktop database.

---

## 17. Exact automated-edition navigation

Add a collapsible `AUTOMATION` group without removing existing tabs.

| Tab | Purpose/UI | APIs | Permissions | Tables |
|---|---|---|---|---|
| Automation Dashboard | Controller health, active dispense, stale equipment, alerts, reconciliation summary | `GET /api/automation/summary`, SSE stream | `VIEW_AUTOMATION` | controllers, status, transactions, alerts, reconciliation aggregates |
| Live Forecourt | All pump cards/nozzles/current activity | `GET /api/automation/forecourt`, SSE | `VIEW_LIVE_FORECOURT` | pumps/nozzles/products/tanks + mappings/status/transactions |
| Controllers & Integrations | CRUD/enable/test connection, capabilities, credential replacement | `/api/automation/controllers*` | `MANAGE_CONTROLLERS` (view may use `VIEW_AUTOMATION`) | controllers, controller logs, audit |
| Device Mappings | discovered external devices mapped to DT-FMS pump/nozzle/tank | `/api/automation/mappings*`, discovery endpoint | `MANAGE_DEVICE_MAPPINGS` | mapping tables and core equipment |
| Automated Transactions | staged/posted/review transactions and evidence | `/api/automation/transactions*` | view; approval permission for intervention | automation transactions/events, core transactions |
| Tank Monitoring | latest reading, quality, trends, water/temp/ullage, delivery candidates | `/api/automation/tanks*`, `/delivery-candidates*` | `VIEW_TANK_MONITORING`, approval for posting | tank history/live, mappings, candidates, deliveries |
| Automated Reconciliation | run list/detail, evidence and variance workflow | `/api/automation/reconciliations*` | view/run/approve grants | reconciliation runs/lines, source evidence |
| Equipment Alerts | filter, acknowledge, resolve, history | `/api/automation/alerts*` | view/acknowledge/resolve grants | alerts/history/status |
| Automation Logs | redacted controller/event processing logs | `/api/automation/logs*` | `VIEW_AUTOMATION_LOGS` | controller logs, inbox metadata |
| Automation Settings | tolerances, retention, stale thresholds, feature flags | `/api/automation/settings*` | `MANAGE_AUTOMATION_SETTINGS` | preferably typed automation settings table |

Do not show command buttons in these tabs during monitoring releases.

---

## 18. Phased implementation roadmap

### Phase 1 — Architecture and database foundation

- **Modify:** `src/database/schema.ts`, `src/database/seed.ts`, `src/database/validateSchema.ts`, `scripts/db-validate.ts`, `server.ts`, `src/types.ts`.
- **Create:** `src/automation/types/*`, `src/automation/api/router.ts`, schema manifests/upgrade fixtures, migration tests.
- **DB:** reconcile baseline drift; add controllers, mappings, inbox, logs, settings foundation in small numbered migrations.
- **API/UI:** health/capability endpoint only; no operational UI.
- **Tests:** fresh/upgrade/corrupt/rollback-copy migrations, physical FK/index assertions, startup failure behavior.
- **Acceptance:** existing tests/build pass; fresh and copied production DB migrate; zero FK violations; no existing module behavior changes.

### Phase 2 — Controller management

- **Modify:** server router mount, permission catalog/UI, Electron credential bridge/lifecycle as required.
- **Create:** controller repository/service/router, credential vault abstraction, Controllers UI/API client.
- **DB:** controllers and controller logs.
- **Tests:** CRUD validation, redaction, permission denial, enable/disable, restart persistence, credential-store failure.
- **Acceptance:** admins can configure/test/disable a simulator controller; secrets never appear in DB/API/logs.

### Phase 3 — Device mapping

- **Create:** mapping tables/repositories/validator/routes and Device Mappings UI.
- **DB:** pump/nozzle/tank mapping tables with unique keys/FKs.
- **Tests:** conflicting IDs, wrong pump/nozzle hierarchy, deletion restrictions, unmapped event behavior.
- **Acceptance:** explicit validated mappings survive restart; duplicate/conflicting activation is impossible.

### Phase 4 — Adapter framework and simulator

- **Create:** adapter contract/registry, supervisor, inbox processor, deterministic simulator, replay fixtures.
- **DB:** event inbox and sync cursors finalized.
- **API:** simulator controls only in development/test mode.
- **Tests:** contract suite every adapter must pass; malformed, duplicate, out-of-order, reconnect and cancellation scenarios.
- **Acceptance:** simulator streams normalized events, all persisted before processing, with zero duplicate side effects.

### Phase 5 — Live Forecourt

- **Modify:** `App.tsx` and `Sidebar.tsx` minimally; mount automation routes.
- **Create:** status projection, forecourt query, authenticated SSE, scoped hooks/components.
- **DB:** equipment current status projection.
- **Tests:** all pumps shown, offline/stale/never-seen, SSE reconnect/auth, UI permission/accessibility.
- **Acceptance:** every configured core pump remains visible and updates within the target latency without global refresh.

### Phase 6 — Automated transactions

- **Modify:** extract shared sale/inventory transaction service from `server.ts`; do not change POS behavior.
- **Create:** automation transaction processor/repository/review UI.
- **DB:** automation transactions/events and unique idempotency keys.
- **Tests:** duplicates, crashes at each commit boundary, price/volume mismatch, unpaid staging, one core post only.
- **Acceptance:** replaying a full controller batch produces exactly one staged/posted record per external transaction and no duplicate stock/sale movement.

### Phase 7 — Totalizers

- **Create:** totalizer processor/history queries/UI detail.
- **DB:** nozzle totalizer readings/indexes.
- **Tests:** monotonic readings, rollover/reset, decimal precision, duplicate periodic samples, transaction delta.
- **Acceptance:** history is immutable and discrepancies create review/alerts without rewriting readings.

### Phase 8 — Tank/ATG integration

- **Create:** tank processor, live projection, trend API/UI, delivery detector/candidate workflow.
- **DB:** tank history/live and delivery candidates.
- **Tests:** noisy sensor, concurrent dispense, delivery stabilization, water/temp alerts, posting approval.
- **Acceptance:** readings are queryable/live; detected delivery never changes inventory before approval.

### Phase 9 — Automated reconciliation

- **Create:** versioned calculation engine, run/line repositories, evidence UI and approval workflow.
- **DB:** reconciliation runs/lines/history as needed.
- **Tests:** golden calculations, missing source, tolerances, partial intervals, parity with manual datasets.
- **Acceptance:** expected/actual/variance and evidence are explicit; no discrepancy is silently corrected.

### Phase 10 — Alerts and monitoring

- **Create:** rule registry, dedupe/escalation, alert UI/history, operational metrics.
- **DB:** alerts and alert history; controller log retention jobs.
- **Tests:** alert storms, acknowledge/resolve/reopen, role checks, stale controller timing.
- **Acceptance:** one actionable alert per active condition, complete immutable transition history.

### Phase 11 — Offline recovery

- **Modify:** server startup/shutdown and Electron readiness details.
- **Create:** recovery coordinator, gap/replay workflow, dead-letter review tooling.
- **DB:** leases/attempt metadata and cursor/gap records.
- **Tests:** kill process during each pipeline step, network partitions, power-loss simulation, reconnect replay, long offline backlog.
- **Acceptance:** restart/replay loses no accepted event and creates no duplicate business effect.

### Phase 12 — Production hardening

- **Modify:** build scripts, validation, packaging config, diagnostics and support export.
- **Create:** soak/load/security/installer tests and deployment runbook.
- **Tests/gates:** DB/migrations/schema, lint, unit/integration/UI, server startup, automation initialization degraded mode, Vite, bundled server, Electron packaged install/upgrade/uninstall.
- **Acceptance:** 72-hour simulator soak; bounded DB growth; clean and upgrade installs; controllers unavailable at startup do not crash DT-FMS; recovery and backup restore drill passes.

### Future separately approved phase — equipment commands

Only after production monitoring maturity: command persistence, confirmation, dual authorization where appropriate, capability checks, timeout/uncertain outcome, fail-safe behavior, immutable attempt logs, feature flags, and vendor-specific safety review. `EXECUTE_AUTOMATION_COMMANDS` alone is not sufficient safety control.

---

## 19. Testing strategy

### Test pyramid

- **Pure unit:** normalization, status translation, IDs/hashes, validation, reconciliation math, alert rules.
- **Adapter contract:** common suite against simulator and each vendor adapter.
- **Database integration:** real SQLite temp DB, migration fixtures, transactions, constraints, idempotency, crash recovery.
- **API security:** authentication, every permission, redaction, validation, CSRF/origin behavior, SSE authorization.
- **UI component/e2e:** all pumps, live updates, stale labels, review/approval workflows, reconnect.
- **System:** Electron starts server, controller absent/degraded, DB locked/corrupt, packaged path/credential vault, clean shutdown.
- **Soak/fault:** high-frequency status, transaction bursts, duplicate storms, network loss, reorder, process kill, power-loss approximation, DB growth/retention.

### Simulator scenarios

- normal idle -> authorized -> dispensing -> complete;
- simultaneous pumps and multi-nozzle pumps;
- duplicate every event and duplicate transaction completion;
- disconnect mid-dispense and replay on reconnect;
- missing sequence then late arrival;
- controller timestamp skew;
- totalizer reset/rollover and implausible jump;
- tank noise, high water, low stock, delivery with concurrent sales;
- unmapped/mis-mapped equipment and vendor error codes;
- malformed/oversized payload and invalid numeric values.

### Required CI/release command order

```text
database fixture migrations
 -> schema/constraint validation
 -> TypeScript check
 -> unit + integration tests
 -> Vite + server bundle
 -> server startup smoke test
 -> automation degraded/online smoke tests
 -> Electron package
 -> installed application smoke/upgrade test
```

---

## 20. Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Monolithic `server.ts` causes accidental regressions | High | Add mounted automation routers and extract only required core write seams with regression tests. |
| Schema source/physical DB drift | High | Baseline manifest, fresh+upgrade fixtures, physical constraint validation before automation migrations. |
| Duplicate/replayed device data creates duplicate sales | Critical | Durable inbox, two-layer unique keys, atomic post/link, replay tests. |
| Completed dispense confused with paid sale | Critical | Staging state and explicit payment/posting workflow. |
| Vendor protocol uncertainty | High | Capability discovery, adapter contract, raw evidence, simulator, vendor certification fixtures. |
| Credentials leaked into SQLite/logs | Critical | OS-protected vault, reference only, centralized redaction, secret scanning tests. |
| Cached status presented as live | High | source/receive timestamps and explicit stale/never-seen state. |
| Automation silently modifies inventory | Critical | candidate/review/approval/posting state machine and shared core service. |
| SQLite contention/database growth | Medium/High | short transactions, WAL, indexes, retention/archival, soak benchmarks. |
| Controller outage blocks desktop startup | High | degraded automation state; core app starts while supervisors reconnect. |
| In-memory session loss on restart | Medium | acceptable for current local security, but document/reassess before remote/multi-client access. |
| High-rate telemetry overwhelms React global refresh | High | scoped endpoints, projections, SSE and local automation hooks. |
| Native controller libraries break packaging | High | prefer pure JS; package/install smoke tests for every supported Windows target. |
| Unsafe future remote control | Critical | separate phase, disabled by default, explicit capabilities/permissions/confirmation/audit/timeouts/fail-safe review. |

---

## 21. Recommended implementation order and approval gates

The exact order is:

1. Approve this architecture.
2. Phase 1A: capture schema baseline and fix validation/drift definitions.
3. Phase 1B: add only automation foundation migrations/types/router skeleton.
4. Phase 2: controller management with secure credential storage.
5. Phase 3: device mappings.
6. Phase 4: adapter framework plus simulator and durable inbox.
7. Phase 5: live read-only forecourt.
8. Phase 6: staged automated transactions through a tested core-service seam.
9. Phase 7: totalizers.
10. Phase 8: ATG/tanks and controlled delivery candidates.
11. Phase 10 monitoring primitives as needed, then full alert UI.
12. Phase 9 reconciliation once all evidence sources are stable.
13. Phase 11 recovery hardening.
14. Phase 12 packaging/production certification.
15. Consider commands only under a new architecture and safety approval.

Each phase requires a separate approval before implementation. A phase is not accepted on frontend build success alone; its database, server, permissions, failure modes, tests, and packaged runtime gates must pass.

---

## 22. Definition of “preserved core”

During the automation program, the following invariants are mandatory:

- Existing users can authenticate and retain their explicit grants.
- Manual POS and manual pump/tank operations continue to work when automation is disabled or offline.
- Existing product, physical pump, nozzle, tank, supplier, customer, shift, transaction, inventory, document, report, reconciliation, approval, and audit records remain readable.
- No adapter writes a core business table directly.
- No external ID is treated as an internal DT-FMS ID.
- No duplicate event can create a duplicate sale, inventory movement, totalizer reading, or delivery posting.
- No discrepancy is silently “fixed.”
- No historical device evidence is overwritten.
- No controller outage prevents the core application from starting.
- No command capability is enabled in the monitoring releases.

This is the architectural acceptance baseline for the DT-FMS Automated Station Edition.
