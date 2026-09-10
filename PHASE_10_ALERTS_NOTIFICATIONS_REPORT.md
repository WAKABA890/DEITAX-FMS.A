# DT-FMS 2.1 Phase 10 — Alerts & Notifications Report

## 1. Objective
Phase 10 adds a vendor-neutral, station-scoped alert and notification engine over authoritative Phase 1–9 evidence. It is observation and communication only.

## 2. Architecture
`AlertEngine` centrally evaluates existing reconciliation, totalizer, ATG, controller, telemetry-freshness, and durable-inbox evidence. Express routes enforce authentication/RBAC and station scope. React renders the alert center; notification channels are isolated behind an interface.

## 3. Alert model
`automation_alerts` stores durable condition identity, severity, lifecycle, source reference, sanitized details, timestamps, acknowledgement/resolution evidence, occurrence count, and deterministic deduplication key.

## 4. Notification model
`automation_notifications` records a delivery attempt separately from its alert. It has alert/station FKs, channel and status checks, delivery/failure fields, retry count, and a unique alert/channel/recipient identity.

## 5. Alert lifecycle
`OPEN -> ACKNOWLEDGED -> RESOLVED`, with `DISMISSED` available to authorized resolvers. Acknowledgement does not resolve the condition. Cleared transient conditions resolve automatically with a system note.

## 6. Severity model
Supported severities are `INFO`, `LOW`, `MEDIUM`, `HIGH`, and `CRITICAL`, enforced by database checks and API validation.

## 7. Rule engine
Rules are station-scoped, enable/disable capable, and hold severity, threshold, duration, cooldown, and repeat-interval configuration. Evaluation and persistence occur outside the UI in transaction-safe engine code.

## 8. Default rules
Ten defaults are installed idempotently: reconciliation variance, reconciliation data quality, totalizer reset, totalizer sequence gap, totalizer stale, ATG stale, ATG sequence gap, ATG reset, controller offline, and automation-processing failure.

## 9. Thresholds
Reconciliation thresholds remain authoritative Phase 9 tolerances. Staleness defaults to the existing live-forecourt freshness setting (30 seconds if absent). Processing-failure threshold is one. No stock-loss or financial threshold was invented.

## 10. Deduplication
The unique `(station_id, deduplication_key)` constraint and deterministic condition keys preserve one logical alert. Re-observation updates `last_detected_at` and `occurrence_count`.

## 11. Cooldown
Continuous observations do not create new alert rows or unlimited notification rows. One in-app delivery is retained for the logical alert; optional repeat delivery remains configurable but is not enabled.

## 12. Automatic resolution
Reconciliation variance/data-quality, controller-offline, stale telemetry, and processing-failure alerts resolve when a later scan proves their condition cleared. Resolution is technically logged.

## 13. Acknowledgement
Authorized acknowledgement records user and timestamp while retaining the underlying condition. Manual resolve/dismiss requires a note and creates an audit entry.

## 14. Permissions
Added `VIEW_ALERTS`, `ACKNOWLEDGE_ALERTS`, `RESOLVE_ALERTS`, `MANAGE_ALERT_RULES`, and `MANAGE_NOTIFICATION_SETTINGS`. API enforcement returns 401 for unauthenticated and 403 for unauthorized requests.

## 15. Station isolation
Creation, list/detail, acknowledgement, resolution, rule management, and notification lookup derive the current station server-side; client-provided station IDs are ignored.

## 16. Audit logging
Rule modifications, acknowledgement, manual resolution, and dismissal are written to the existing audit log with actor identity.

## 17. Technical logging
Creation, repeat observation, and automatic resolution write sanitized entries to `automation_logs`; PIN/password/token/secret/credential-like detail keys are removed.

## 18. Simulator scenarios
Tests exercise reconciliation variance, controller disconnect/reconnect, repeat observations, recovery, and notification outcomes without real hardware or equipment control.

## 19. Concurrency
Alert writes use an immediate SQLite transaction. A two-process test simultaneously observes the same condition and confirms one alert and one notification.

## 20. Restart recovery
A durable alert is closed and reopened through a new database connection; identity, lifecycle data, and occurrence count survive without duplication.

## 21. Migration results
Migration `035_alerts_notifications_engine` passed on a fresh database, the existing `data/fms.db`, and `build/phase10-production-copy.db`. The copied pre-automation database upgraded through migrations 021–035. Both final databases report `integrity_check=ok` and zero FK violations.

## 22. Regression results
Phase 1 foundation, Phase 2 controller management, Phase 3 mapping, Phase 4 adapter framework, Phase 5 live forecourt, Phase 6 transactions, Phase 7 meters, Phase 8 ATG, and Phase 9 reconciliation suites passed. Authentication, critical user flows, custom roles/shift history, identity uniqueness, shift roster, and audit regressions passed. Existing counts remained: 7 users, 52 permissions, 3 tanks, 3 pumps, 4 nozzles, 11 shifts, 17 transactions, and 11 legacy reconciliations.

## 23. Build results
TypeScript, fresh validation, Vite frontend, bundled server, desktop build, Windows x64 NSIS installer, packaged startup, and `/api/status` HTTP 200 passed. Installer: `release/DT-FMS2.0-Setup-1.0.1.exe`.

## 24. Notification limitations
In-app delivery is implemented. Email and SMS are honest `NOT_CONFIGURED` adapters; no provider, credentials, or fake delivery is present. Repeat external notifications are not active.

## 25. Known issues
The production build retains the pre-existing Vite large-chunk advisory and electron-builder package metadata/duplicate-dependency advisories. A headless test launch needs `--disable-gpu` on this host; with it, the packaged application and API start successfully. Legacy transaction nozzle references continue to be preserved by existing validation policy.

## 26. Explicit Phase 11 boundary
No Phase 11 offline-first/synchronization work, physical hardware communication, automated correction, payment creation, inventory/financial mutation, pump/nozzle control, or deployment workflow was implemented.

## Files created
- `src/automation/alerts/alert-types.ts`
- `src/automation/alerts/alert-rules.ts`
- `src/automation/alerts/alert-engine.ts`
- `src/automation/alerts/notification-channels.ts`
- `src/automation/api/alert-router.ts`
- `src/components/automation/Alerts.tsx`
- `tests/alerts.integration.test.ts`
- `tests/alerts-api.integration.test.ts`
- `tests/alert-concurrency.integration.test.ts`
- `tests/fixtures/phase10-alert-worker.ts`
- `PHASE_10_ALERTS_NOTIFICATIONS_REPORT.md`

## Files modified
- `src/database/seed.ts`
- `src/database/schema.ts`
- `src/database/validateSchema.ts`
- `src/types.ts`
- `src/App.tsx`
- `src/components/Sidebar.tsx`
- `src/services/automationApi.ts`
- `server.ts`
- `package.json`

## Phase 10 decision
**GO** — Phase 10 acceptance checks pass. Stop before Phase 11.
