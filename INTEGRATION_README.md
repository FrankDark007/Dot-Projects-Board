# `dot` Mission Control Dashboard — Local Integration Contract & Reliability Guide

## 1. Purpose, Scope & Environment Boundary
This dashboard was built and updated in Google AI Studio with **zero access** to your Macs, local repositories, task sessions, MD workers, or private network. It does not claim to inspect live local machines from the cloud sandbox, and it requires **zero Gemini API calls** to render, evaluate, or refresh status.

**Current Status**: All fixture, transport/validator, and UI behavior tests pass (`14/14` suites, `54` assertions). **Real local Mission Control integration remains UNVERIFIED** until a local developer connects the adapter to your local supervisor endpoint and runs end-to-end acceptance checks.

---

## 2. Baseline Comparison & Rollback Instructions

### Baseline & Rollback Point
Before applying the visual redesign and the 7 source-level reliability fixes, the workspace baseline (corresponding to `400b1142a497c57b7763cb53d0efd6a085f26cb9`) was snapshotted in Git under the tag `baseline-rollback-point`.

To inspect the diff or roll back to the pre-update state at any time:
```bash
# View all changes since the baseline commit
git diff baseline-rollback-point

# Roll back the working tree to the baseline revision
git checkout baseline-rollback-point
```

---

## 3. Source-Level Reliability Fixes Implemented

1. **Real Advancing Clock in Live Mode (`src/App.tsx`, `src/utils/timeFormat.ts`, `src/engine/stateEvaluator.ts`)**
   - Live mode uses a real advancing wall clock (`Date.now()`, ticking every `1,000ms`) rather than a frozen fixture timestamp.
   - Demo mode defaults to the deterministic `REFERENCE_NOW_ISO` (`2026-10-14T17:15:00.000Z`) for reproducible fixture inspection, with a header toggle (**Advance Clock** / **Fixed Fixture Clock**) to test live heartbeat expiry (`>90s`) and stale-feed warnings (`>30s`) without waiting for a new snapshot.
   - Any missing, unparseable, or future timestamp (`>5s` clock skew) is flagged as `timestampInvalidOrFuture: true` (`Uncertain timestamp`) and is **never** treated as fresh liveness or progress.

2. **Strict Separation of Liveness, Meaningful Progress & Telemetry Coverage (`src/engine/stateEvaluator.ts`)**
   - **Heartbeats prove process liveness, not task progress.**
   - Every project evaluation exposes four distinct worker metrics:
     - `confirmedRunningCount`: Workers with `rawStatus === 'running'` and a valid fresh heartbeat (`<= 90s`), **including** workers whose task progress has stalled.
     - `confirmedProgressingCount`: Subset of confirmed-running workers that also emitted verified meaningful progress within `stalledProgressSeconds` (`<= 900s`).
     - `stalledRunningCount`: Subset of confirmed-running workers whose process is alive (`heartbeat <= 90s`) but whose task progress is stalled (`> 900s` or missing/future timestamp).
     - `unknownExecutionCount`: Workers with expired heartbeats (`stale_heartbeat`), invalid/future timestamps, `disconnected`, or `unknown` telemetry.
   - Missing telemetry coverage (`workerCoverageKnown: false` or zero worker records with unverified coverage) returns `null` (`Telemetry Unavailable`) instead of `0` and **never** falsely marks a project as `Blocked`.

3. **Runtime Snapshot Validation (`src/schema/validator.ts`)**
   - All incoming Live payloads pass through `validateRuntimeSnapshot(rawPayload, previousSnapshot)` before touching application state.
   - Rejects non-object roots, unsupported `schemaVersion`, invalid `observedAt` or `evaluationThresholds`, missing collection arrays, malformed records, duplicate primary IDs (`projectId`, `workerId`, `runId`, `decisionId`, `evidenceId`, `eventId`), broken cross-entity foreign references (`milestone.projectId`, `worker.projectId`, `worker.currentRunId`, `gate.evidenceIds`), negative token/cost figures, and out-of-order snapshots (`sequence < previous.sequence` or regressing `observedAt`).
   - When a live poll returns malformed or out-of-order data after a valid snapshot was already loaded, `LivePollCoordinator` preserves the last valid snapshot, increments `consecutiveFailures`, and transitions connection state to `stale_last_known_preserved` with a detailed `SNAPSHOT_VALIDATION_FAILED` diagnostic.

4. **Strict `Recently Verified Complete` Rules (`src/engine/stateEvaluator.ts`)**
   - A finished coding turn (`status: 'succeeded_turn'`), git commit, or clean worker exit **never** marks a project complete.
   - `recently_verified_complete` requires **all** of the following:
     1. At least 1 milestone exists, and every milestone has `status === 'completed'` and `remainingSteps.length === 0`.
     2. Every milestone has at least 1 `required: true` acceptance gate.
     3. Every required acceptance gate has `status === 'passed'` (never `pending`, `running`, `failed`, or `skipped`).
     4. Every required acceptance gate references at least 1 valid, existing `EvidenceLink` in `snapshot.evidence` with `verified: true` and a valid timestamp.
     5. `project.acceptanceStatus === 'verified_passed'`, with zero open decisions and zero crashed/failed/stalled workers.
   - Failed optional gates (`required: false`, `status: 'failed'`) are allowed on completed projects only when accompanied by a visible warning (`optionalFailedGateCount > 0` — e.g. `"Complete with 1 failed optional gate"`).

5. **Hardened Live Polling, Abort Timeouts & Request Overlap Guards (`src/adapters/dataAdapter.ts`)**
   - `LivePollCoordinator` enforces `AbortController` request timeouts (`requestTimeoutMs`, default `8,000ms`), single-flight poll guards (`skipped_in_flight` prevents overlapping requests), and monotonic generation tokens (`ignored_stale_generation` discards late responses after mode switches, endpoint edits, or manual resets).
   - Explicitly distinguishes four connection states:
     - `demo_fixture` — Synthetic fixtures with persistent `DEMO DATA` indicator.
     - `never_connected` — Live mode before any valid snapshot has been received (`NOT CONNECTED`).
     - `connected_fresh` — Valid live snapshot received within `staleFeedWarningSeconds`.
     - `stale_last_known_preserved` — Previously connected live feed whose latest poll failed, timed out, or exceeded `staleFeedWarningSeconds`.

6. **Safe Live vs. Demo Command Isolation (`src/adapters/dataAdapter.ts`, `src/App.tsx`)**
   - Live mode never mutates demo state or falls back to demo command handlers.
   - Live mode defaults to **Read-Only** (`allowLiveWrites: false`), explicitly disabling operator command buttons in the UI until write endpoints are enabled in Adapter Settings.
   - Write commands (`POST /api/mission-control/v1/commands`) use a single bounded timeout and **never auto-retry** on timeout (`UNCERTAIN_WRITE_TIMEOUT`) to prevent duplicate side effects.
   - Reminder commands clearly distinguish three outcomes in UI banners and audit history:
     - `accepted_pending_delivery` — Queued by local daemon (`ackId`), awaiting next worker turn poll (never claims `"dot notified"` as an accomplished fact).
     - `failed_delivery` — Delivery rejected (`502 DELIVERY_FAILED`); surfaces error without claiming notification succeeded.
     - `uncertain_timeout` — Command POST timed out; outcome is explicitly marked uncertain.

7. **Three-Tier Verification Suite (`src/tests/contractAndState.test.ts`, `src/tests/runTests.ts`)**
   - **Suite 1 (`fixture_evaluator`)**: Tests normal execution, worker crash (`SIGSEGV`), advancing clock heartbeat expiry & future timestamp rejection, liveness vs. progress vs. missing coverage separation, strict verified completion with optional gate warnings, deduplication, and turn completion with failed acceptance.
   - **Suite 2 (`transport_validator`)**: Tests `validateRuntimeSnapshot` (malformed records, duplicate IDs, broken references, negative costs, out-of-order sequences), `LivePollCoordinator` preservation of last valid snapshot on malformed/out-of-order payloads, `AbortController` timeouts, overlap prevention, late-response cancellation, and live write isolation.
   - **Suite 3 (`ui_behavior`)**: Server-side renders `ProjectRow`, `ProjectCard`, `AttentionPanel`, and `TodayView` via `renderToStaticMarkup` to verify truthful badges, read-only disabled controls, and confirmed failure vs. missing telemetry distinction.

---

## 4. Running Verification & Build Checks

```bash
# Run all 14 synchronous + async verification tests (54 assertions)
npm test

# Type-check the codebase
npm run lint

# Build production bundle
npm run build
```
