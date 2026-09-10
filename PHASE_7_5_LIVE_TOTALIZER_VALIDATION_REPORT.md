# DEITAX FMS.A — Phase 7.5 Live PTS-2 Totalizer Validation Report

Date: 2026-09-08  
Repository: `C:\DT-FMS2.1`  
Decision: **IMPLEMENTED — live read path verified; controller currently reports zero volume totals**

## 1. Scope and outcome

Phase 7.5 adds read-only live totalizer polling to the existing PTS-2 adapter. The implementation reads only actively mapped nozzle identities, uses the documented asynchronous jsonPTS sequence, normalizes each result into `TOTALIZER_READING_RECEIVED`, and sends it through the existing durable event inbox and Phase 7 meter evidence engine.

No pump control, authorization, start/stop, emergency stop, price push, controller configuration write, transaction rewrite, stock correction, tank mutation, shift mutation, POS mutation, or reconciliation auto-adjustment was added.

## 2. Protocol evidence

Artifacts inspected:

- `C:\Users\berna\Documents\jsonPTS protocol for PTS-2 controller.pdf`, revision 138, review date 5 May 2026.
- `C:\Users\berna\Documents\Pts2 middleware.postman_collection.json`.

The PDF defines:

- `PumpGetTotals` with `Pump` and `Nozzle` selectors.
- A confirmation response with the matching packet ID, request type, and `Message: "OK"`.
- Repeated `PumpGetStatus` requests until `PumpTotals` is returned.
- `PumpTotals.Data`: `Pump`, `Nozzle`, optional fuel-grade fields, cumulative `Volume`, cumulative `Amount`, `Transaction`, and `User`.
- Only one totals request may be pending for a pump; different pumps may be queried independently.

The Postman collection has middleware routes for pumps, fuel grades, fuel-grade prices, nozzles, pump controls, and transaction lookup/closure. It contains no totalizer route. Consequently, Phase 7.5 uses the documented controller `/jsonPTS` endpoint and does not call middleware control or price routes.

## 3. Files changed

Created:

- `tests/pts2-live-totalizer.validation.ts` — explicit read-only live validation harness; it opens the application database read-only and never prints credentials.

Modified:

- `src/automation/adapters/pts2-adapter.ts` — protocol-compliant totalizer scheduler, request correlation, normalization, deterministic identity, and lifecycle cleanup.
- `src/automation/adapters/adapter-manager.ts` — supplies only active mapped PTS-2 nozzle identities to the adapter.
- `src/automation/types/adapters.ts` — adds the narrow mapped-nozzle adapter contract.
- `tests/pts2-readonly-adapter.integration.test.ts` — protocol-shaped success, encryption, allowlist, same-pump serialization, mapping, and event tests.
- `PHASE_7_5_LIVE_TOTALIZER_VALIDATION_REPORT.md` — replaced the former missing-artifact NO-GO report with this completed validation report.

Generated build outputs under `build/` and `dist/` were refreshed by validation commands.

## 4. Database impact

No migration and no new table, column, foreign key, index, or unique constraint were required. Phase 7.5 reuses:

- `automation_event_inbox` for durable idempotent ingestion.
- `automation_meter_processing` for validation/processing state.
- `automation_meter_readings` for immutable evidence history.
- `automation_meter_current_state` for the current projection.
- `automation_device_mappings` as the authoritative controller/pump/nozzle boundary.
- `automation_logs` for cycle and failure observability.

The live protocol validator did not write to the production database. Once the rebuilt application is installed/restarted, the normal adapter manager will durably ingest live events through these existing tables.

## 5. Polling and concurrency model

- Default totalizer interval: 15 seconds; configurable with `totalizerPollIntervalMs`, minimum 5 seconds.
- Default asynchronous completion timeout: 10 seconds; configurable with `totalizerResponseTimeoutMs`.
- Default status retry interval: 500 milliseconds; configurable with `totalizerStatusPollMs`.
- Overlapping totalizer cycles are suppressed.
- Mapped nozzles are grouped by pump.
- Nozzles on the same pump execute strictly in series.
- Distinct pumps execute concurrently with `Promise.allSettled`, so one failed pump does not suppress evidence from another.
- Every timer is cleared on disconnect, disable, shutdown, and restart.
- A pump-level timeout or protocol error is logged and does not stop the main application.

## 6. Identity, normalization, and durability

Each successful `PumpTotals` packet becomes a `TOTALIZER_READING_RECEIVED` event with:

- Controller ID, external pump ID, external nozzle ID, and device type.
- Cumulative volume normalized to litres with no more than three decimal places.
- Optional cumulative amount and controller transaction number retained as evidence.
- Initial `PumpGetTotals` confirmation packet ID and final `PumpTotals` packet ID.
- Controller unique identifier and configuration identifier captured at connection time.
- Receive timestamp used as occurrence time because `PumpTotals` does not carry its own timestamp.
- SHA-256 raw-payload integrity hash.
- Deterministic event ID derived from controller, pump, nozzle, volume, amount, and transaction number. Repeated delivery of the same controller state is therefore suppressed by the existing inbox uniqueness boundary, including after restart.

The Phase 7 engine continues to validate station/controller ownership, mapped pump/nozzle identity, active equipment, product authority, unit, numerical validity, timestamp bounds, sequence behavior, monotonicity, resets, gaps, and transaction correlation. It never changes stock or an operational meter entry.

## 7. Live read-only controller result

Controller: `controller-ac74bffa-0572-443a-8cc9-238ac9fbbac6` at the already configured PTS-2 endpoint.  
Mapped nozzles queried: 2.

Observed on 2026-09-08:

| Pump | Nozzle | Volume totalizer | Unit | Controller transaction | Result |
|---|---|---:|---|---:|---|
| 1 | 1.1 | 0 | L | 44702 | Valid `PumpTotals` packet |
| 2 | 2.1 | 0 | L | 53233 | Valid `PumpTotals` packet |

The adapter successfully authenticated, received request confirmations, correlated final response packet IDs, and parsed both mapped nozzles. The zero volume values are exactly what the PTS-2 returned. The application does not replace them with sale quantities or inferred values.

This proves the network and jsonPTS totalizer request path, but it also identifies a controller/pump-side issue: the connected setup is not presently returning non-zero cumulative volume. Likely operational checks are pump protocol totalizer support, pump communication configuration, decimal/scaling configuration, and whether the dispenser exposes electronic totals to PTS-2. That issue must be corrected at the controller/dispenser configuration layer before non-zero live evidence can appear.

## 8. Validation performed

| Validation | Result |
|---|---|
| TypeScript `tsc --noEmit` | PASS |
| PTS-2 read-only adapter tests | PASS — 2/2 |
| Phase 7 meter/totalizer integration | PASS — 1/1 |
| Phase 6 automated transaction regression | PASS — 1/1 |
| Fresh database migrations | PASS |
| Schema validation | PASS |
| Production frontend/server build | PASS |
| Desktop build pipeline (`db:validate` + build) | PASS |
| Server startup on isolated fresh DB | PASS; automation unavailable/disabled did not block startup |
| HTTP server response | PASS; protected endpoint correctly returned authentication-required response |
| Live read-only PTS-2 totalizer handshake | PASS — 2 mapped nozzles |

The production build retains the existing Vite warning that the main JavaScript chunk exceeds 500 kB. This is a non-blocking pre-existing optimization warning, not a Phase 7.5 failure.

## 9. Safety conclusion

The implementation remains observational and read-only. It cannot send fuel prices, authorize a pump, start or stop dispensing, close a controller transaction, change controller settings, adjust tank stock, alter shifts, post cash, or overwrite operational meter fields. Adapter failures remain isolated by the existing adapter manager, so the DEITAX FMS.A server can start and operate when the PTS-2 is unavailable.

No later automation phase was implemented.
