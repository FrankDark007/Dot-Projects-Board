# `dot` Mission Control Dashboard — Local Integration Contract & Reliability Guide

## 1. Purpose, Scope & Environment Boundary
This dashboard was built and verified in an isolated sandbox with **zero access** to your Macs, local repositories, task sessions, MD workers, or private network.
- **No Real Integration or Deployment Claimed**: Real local Mission Control integration is **unverified** in this environment (`UNVERIFIED IN CLOUD SANDBOX`) and no deployment has been performed.
- **No Fabricated Telemetry**: All data shown in **Demo Mode** uses deterministic synthetic fixtures and is explicitly marked as `SYNTHETIC DEMO DATA — LOCAL MISSION CONTROL NOT CONNECTED`.
- **Strict Mode & Endpoint Isolation**: Switching to **Live Mode** starts in an explicit `NOT CONNECTED` state and never silently falls back to synthetic fixtures when a poll fails, times out, or returns invalid data. Switching endpoints (`A → B` or `A → B → A`) or modes immediately increments the monotonic connection generation token, aborts in-flight reads and commands, and clears endpoint-bound snapshots, capabilities, reachability flags (`liveInitialDataRejected`), historical contact timestamps (`liveLastContactAt`), selection state, and feedback banners.
- **Reversible Operator Controls**: Priority updates, project archive/unarchive (with 1-click Undo), operator notes, reminders, and decision resolutions use a single idempotent command envelope (`POST /api/mission-control/v1/commands`). Uncertain write timeouts (`UNCERTAIN_WRITE_TIMEOUT`) are never retried automatically.

---

## 2. Baseline & Rollback Instructions
- **Reviewed Baseline Commit**: `f8f0dd07bce41de4004b9b0e5429c1a0ec58eade`
- **Inspect or Roll Back by Reviewed Git Commit** (use local Git commit hashes directly; no remote tag is claimed):
  - Compare working tree or HEAD against baseline:
    ```bash
    git diff f8f0dd07bce41de4004b9b0e5429c1a0ec58eade
    ```
  - Roll back to the reviewed baseline commit if needed:
    ```bash
    git checkout f8f0dd07bce41de4004b9b0e5429c1a0ec58eade
    ```

---

## 3. Summary of Architecture & Reliability Safeguards

1. **Separated Transport Contact, Snapshot Envelope Age, Worker Source Age & Terminal-Worker Rules (`src/adapters/dataAdapter.ts`, `src/engine/stateEvaluator.ts`, `src/App.tsx`)**
   - **HTTP Transport Contact (`lastSuccessfulContactAt` & `liveInitialDataRejected`)**: Recorded immediately upon receiving an HTTP 200 response from the endpoint, before JSON parsing and schema validation.
     - If an HTTP 200 response contains malformed JSON, fails schema validation, or regresses per-source sequence ordering (`OUT_OF_ORDER_SNAPSHOT`), transport contact still advances while the invalid payload is rejected (`rejected_validation_preserved_last`) and the last valid snapshot is preserved (`connectionHealth: 'stale'`).
     - If no valid snapshot has ever been received (`snapshot === null`), `liveInitialDataRejected` is derived strictly from the **latest non-ignored poll outcome** (`outcome.status === 'rejected_validation_preserved_last' && outcome.snapshot === null`). An initial HTTP 200 invalid JSON response reports `LIVE MODE — ENDPOINT REACHABLE · INVALID INITIAL DATA REJECTED`, whereas if a subsequent poll times out or fails at the network layer, current status transitions to `LIVE MODE — NOT CONNECTED` (`Live: Never connected`) while retaining the historical `Last HTTP contact` timestamp as diagnostic evidence.
   - **Snapshot Envelope Age (`snapshot.generatedAt`)**: Evaluated independently from HTTP contact time so a server repeatedly serving an old cached snapshot over HTTP 200 transitions to `stale`.
   - **Worker Source Observation Age (`worker.source.observedAt`)**: Evaluated per worker (`isSourceObservationFresh`). A fresh snapshot envelope and fresh `lastHeartbeatAt` with a stale `worker.source.observedAt` (`> heartbeatExpirySeconds`) cannot confirm a running worker alive (`telemetryStatus: 'stale_observation'`) and never masks a stale running sibling worker.
   - **Proven Stopped / Terminal Worker Rule (`isProvenStoppedOrTerminalWorker`)**: Workers in a proven stopped or terminal state (`status` in `stopped | crashed | failed` or `authoritativeStopProof` present) retain their historical `sourceObservationAgeSeconds` and `oldestWorkerSourceAgeSeconds` diagnostics (`historical (terminal)` in the UI), but do not count toward `staleSourceObservationCount`, do not trigger adapter stale-source warnings, and do not exclude a project with another fresh confirmed-running worker from `working_now`.
   - **Static Project Metadata Isolation**: Old static `project.source.observedAt` metadata alone never marks the live transport connection stale or disconnected.

2. **Isolated Async Verification Runner & Live Polling Timer Protection (`src/tests/runTests.ts`, `src/components/ContractAndTestsView.tsx`, `src/tests/recordedVerificationReport.json`)**
   - The operational `Contract & Tests` view never executes the fake-timer/mock-DOM async suite inside the live browser page and never replaces `globalThis.setTimeout`, `clearTimeout`, `Date.now`, or `fetch`.
   - `npx tsx src/tests/runTests.ts` executes both synchronous and fake-timer async suites in Node (`happy-dom`), restores the real clock inside `finally`, and records the real execution timestamp (`new RealDate().toISOString()`), runner command (`npx tsx src/tests/runTests.ts`), and isolation mode (`dev_test_runner_recorded`) into `src/tests/recordedVerificationReport.json`.
   - `ContractAndTestsView` displays `recordedAt`, `runnerCommand`, and `executionIsolation`, and provides two distinct controls: **Re-Run Sync Checks (11)** (re-evaluates pure synchronous checks in-memory) and **Reload Recorded Async Results (7)** (reloads the recorded async report without touching live polling timers).

3. **Command Recipient Binding & Contradiction Guards (`src/schema/validator.ts`, `src/adapters/dataAdapter.ts`, `src/App.tsx`)**
   - `validateCommandResponsePayload` enforces HTTP status (`httpOk` and `200..299` required when `ok: true`), exact `idempotencyKey` match, optional `commandType`/`projectId` match, and rejects contradictory responses where `ok: true` is paired with `commandAccepted: false` or a non-empty `errorCode` (such as `DELIVERY_FAILED`).
   - For `send_reminder`, `deliveryAck` is mandatory when `ok: true`, must be internally consistent (`delivered_acknowledged` requires `acknowledged: true` and `ackId`; pending/failed/timeout states require `acknowledged: false`), and `deliveryAck.recipient` must strictly match the dispatched `payload.recipient` (e.g., dispatching to `Alice` and receiving an ack for `Bob` is rejected as `VALIDATION_ERROR`).

4. **Continuous Single-Flight Polling Loop & Complete Endpoint Isolation (`src/App.tsx`, `src/adapters/dataAdapter.ts`)**
   - Self-rescheduling single-flight polling loop (`runLivePollCycle`) with exponential backoff (`1.5^failures` up to `maxBackoffMs`) and background-tab throttling (`visibilityState === 'hidden'`).
   - Full generation isolation across `A → B` and `A → B → A` transitions while snapshot reads and command writes are in flight.

5. **Strict Evidence & Gate Requirements for `Verified Complete` & Hostile-Input Runtime Validation (`src/engine/stateEvaluator.ts`, `src/schema/validator.ts`)**
   - Every required milestone must define `>= 1` required gate, and every required gate must pass with a valid non-future `verifiedAt` and an existing `verified: true` `EvidenceLink` with a valid non-future `observedAt`.
   - Complete runtime validation checks all required fields, types, references, and per-source sequence monotonicity before state publication.

---

## 4. Verification, Lint, Build & Browser Layout Suites

### Automated Regression, Lint & Build Commands
Run the complete verification suite (**18/18 tests, 154 assertions**: 11 synchronous tests / 68 assertions + 7 recorded async tests / 86 assertions):
```bash
npx tsx src/tests/runTests.ts
npm run lint
npm run build
```

### Headless Chromium Browser Layout & Geometry Suite (`37/37` States)
- **Prerequisites**:
  1. Start the application server on port `3000` (e.g., `npm run dev`) or set `VERIFY_APP_URL` to the running URL (defaults to `http://127.0.0.1:3000`).
  2. Ensure `playwright` and a Chromium binary are available (`CHROMIUM_BIN` env var or standard system paths `/usr/bin/chromium`, `/usr/bin/chromium-browser`, `/usr/bin/google-chrome`, or macOS `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`).
- **Command**:
  ```bash
  npx tsx src/tests/verifyLayoutBrowser.ts
  ```
  Verifies all **37/37** responsive viewport (`320px` to `1920px`), sidebar (`expanded`/`collapsed`), content (`demo`/`stress`), and `200%` zoom states with zero horizontal overflow, zero clipping, and zero sibling overlap.

