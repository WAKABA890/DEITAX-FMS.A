# DEITAX FMS.A — Phase 8 Live PTS-2 ATG Validation Report

Date: 2026-09-08  
Repository: `C:\DT-FMS2.1`  
Status: **PARTIAL GO — live ATG, persistence, integrity and regressions pass; packaged startup remains pending**

## Executive summary

Live read-only PTS-2 tank monitoring is implemented through the existing adapter lifecycle and Phase 8 evidence processor. The real controller exposed two tank/probe pairs. DT-FMS has one authoritative tank mapping, so only probe/tank 1 was polled and persisted. Its real measurement was accepted, projected, and retained without changing stock or financial data. Tank/probe 2 remains discovered but unmapped and therefore produced no authoritative DT-FMS evidence.

No controller write, pump control, price control, tank configuration, calibration, stock correction, financial correction, or reconciliation correction was introduced.

## Existing architecture and implementation map

| File | Existing responsibility | Phase 8 live change |
|---|---|---|
| `src/automation/adapters/pts2-adapter.ts` | Authenticated read-only jsonPTS connection, sales and totalizers | Added probe discovery and bounded live `ProbeGetMeasurements` polling |
| `src/automation/adapters/adapter-manager.ts` | Runtime isolation and durable ingestion | Supplies only active mapped numeric tank/probe identities |
| `src/automation/types/adapters.ts` | Adapter contracts | Added narrow mapped-tank identity contract |
| `src/automation/atg/atg-tank-engine.ts` | Immutable validation, current projection, anomaly handling | Treats explicitly sequence-less protocols as valid; missing current fields remain NULL |
| `src/automation/api/atg-router.ts` | Station-scoped ATG current/history API | Exposes probe identity and last successful reading |
| `src/components/automation/AtgTankMonitoring.tsx` | Existing ATG monitoring UI | Adds live refresh, probe, connection, freshness and last-success information |
| `src/automation/reconciliation/reconciliation-engine.ts` | Phase 9 evidence-based reconciliation | Inspected; already consumes immutable ATG reading IDs and volumes |
| `src/automation/alerts/alert-engine.ts` | Phase 10 alerts | Inspected; already consumes stale, anomaly and controller-offline ATG conditions |

Validation assets created/modified:

- `tests/pts2-readonly-adapter.integration.test.ts`
- `tests/pts2-live-totalizer.validation.ts`
- `tests/pts2-live-atg-persistence.validation.ts`
- `tests/atg-tank-monitoring.integration.test.ts`
- `tests/automated-fuel-transaction.integration.test.ts` (type-only test correction)

## Protocol mechanism

Authoritative source: `jsonPTS protocol for PTS-2 controller.pdf`, revision 138.

- Configuration: `GetProbesConfiguration` → `ProbesConfiguration`; `GetTanksConfiguration` → `TanksConfiguration`.
- The specification states tank IDs correspond directly to probe IDs.
- Measurement: `ProbeGetMeasurements` with `Data.Probe` → synchronous `ProbeMeasurements` with matching packet ID.
- Protocol units: `ProductHeight` and `WaterHeight` in mm; `ProductVolumeFloat`/`ProductVolume` in litres; `Temperature` in degrees Celsius.
- `DateTime` is the probe measurement timestamp.
- Optional measurement fields may be absent. The adapter omits them and the current projection stores NULL; it never converts absence to zero or reuses an old value.
- The response has no source sequence. The event explicitly records that sequence is unavailable, rather than fabricating one or classifying every valid PTS-2 reading as a sequence failure.

The supplied middleware Postman collection contains no ATG endpoint. No middleware control or price route is used.

## Discovery and mapping

Controller: `controller-ac74bffa-0572-443a-8cc9-238ac9fbbac6`.

| Tank/probe | Probe port/address | Fuel grade | Height | DT-FMS status |
|---|---|---:|---:|---|
| 1 | DISP / 1 | 1 | 10000 mm | MAPPED; authoritative polling enabled |
| 2 | LOG / 2 | 2 | 10000 mm | DISCOVERED / UNMAPPED; not ingested |

The existing model represents the protocol-defined 1:1 tank/probe pair through a TANK mapping and preserves `probeId` in source payload/metadata. No fake probe or tank table was created.

## Polling, identity and recovery

- Default interval: 15 seconds, configurable as `atgPollIntervalMs`, minimum 5 seconds.
- A cycle never overlaps itself.
- Only enabled, actively mapped tanks are polled.
- Individual mapped probes use independent read-only requests and `Promise.allSettled`; one failure cannot suppress another or stop the app.
- Disconnect, disable, restart and shutdown clear the scheduler.
- Controller errors/offline status produce safe logs; last evidence is preserved and stock is never zeroed.
- Event identity is SHA-256 over controller, probe, controller timestamp and complete response data.
- Repeated poll, reconnect, application restart and repeated response converge on one inbox/evidence identity.

## Evidence, projection, stale, alerts and reconciliation

The implementation reuses `automation_event_inbox`, `automation_atg_processing`, `automation_atg_readings`, `automation_atg_current_state`, device mappings and logs. No migration was required.
Historical rows remain immutable. Current values come only from the newest accepted observation, including NULL for newly missing fields. ATG never updates `fuel_tanks.current_level_liters`.

The ATG API uses the existing station freshness setting (`live_forecourt_freshness_seconds`, default 30 seconds). With a default 15-second polling interval this is a two-cycle stale threshold. An unchanged but freshly received measurement remains fresh. The existing Phase 10 alert engine consumes ATG stale/anomaly/controller-offline conditions. Phase 9 consumes opening/closing ATG volumes and evidence IDs without altering either source or automatically correcting variance.

## Live measurement and durable validation

Live controller observation:

| Field | Actual PTS-2 value |
|---|---:|
| Probe/tank | 1 |
| Probe status | OK |
| Product level | 1010 mm |
| Product volume | 1.12 L |
| Temperature | 20 °C |
| Water height | 20 mm |
| Alarms | none |

On a transactionally created production-like database copy, two consecutive adapter connections produced:

- Durable ATG readings added: 1.
- Duplicate inbox identities for the response: 1.
- Processing status: ACCEPTED.
- Anomaly: none.
- Stock mutation: none.
- Financial mutation: none.
- SQLite integrity: ok.
- Foreign-key check: ok.

The reported `1.12 L` volume is preserved exactly as controller evidence. Its relationship to the configured 10000 mm tank height appears operationally unusual, but DT-FMS does not estimate, replace, clamp, or correct it.

## Test and regression results

| Check | Result |
|---|---|
| TypeScript compilation | PASS |
| PTS-2 read-only protocol tests | PASS, 2/2 |
| Phase 8 ATG integration/concurrency | PASS, 2/2 |
| Phase 6 automated transactions | PASS |
| Phase 7 meter/totalizers | PASS |
| Phase 9 reconciliation suite | PASS, 4/4 |
| Phase 10 alert suite | PASS, 3/3 |
| Phase 11 recovery suite | PASS, 3/3 |
| Fresh migrations/schema validation | PASS |
| Live discovery and measurement | PASS |
| Durable persistence/reconnect duplicate suppression | PASS |
| Frontend/server production build | PASS |
| Electron/NSIS packaging | PENDING at report time |
| Packaged application startup | NOT YET VERIFIED |

## Final acceptance summary

PHASE 8 STATUS: PARTIAL GO  
LIVE PTS-2 ATG: YES  
TANKS DISCOVERED: 2  
PROBES DISCOVERED: 2  
TANKS MAPPED: 1  
PROBES MAPPED: 1 (protocol-defined same ID as mapped tank)  
ATG READINGS RECEIVED: 1 live identity  
VALID ATG READINGS: 1  
DUPLICATES SUPPRESSED: 1 reconnect delivery  
INVALID READINGS: 0  
SEQUENCE GAPS: 0 (protocol supplies no sequence)  
STALE CONDITIONS: 0 during validation  
ANOMALIES: 0 software classifications; unusually low controller volume noted  
RECONCILIATION INTEGRATION: PASS  
ALERT INTEGRATION: PASS  
STOCK MUTATION: NONE  
FINANCIAL MUTATION: NONE  
CONTROLLER WRITE OPERATIONS: NONE  
REGRESSION: PASS  
DATABASE: PASS  
BUILD: PASS  
PACKAGED APPLICATION: PENDING  
LIVE HARDWARE: PASS  
NEXT BLOCKER: Complete NSIS packaging and verify the unpacked/packaged application startup; separately verify why the physical controller reports only 1.12 L at 1010 mm.

No Phase 13, pump-control, price-control, or other later phase was implemented.
