# `dot` Mission Control Dashboard — Local Integration Contract & Reliability Guide

## 1. Purpose, Scope & Environment Boundary
This dashboard was built and updated in Google AI Studio with **zero access** to your Macs, local repositories, task sessions, MD workers, or private network.
- **No fabricated telemetry**: All data shown in **Demo Mode** is explicitly marked as `SYNTHETIC DEMO DATA — LOCAL MISSION CONTROL NOT CONNECTED`.
- **Strict Mode & Endpoint Isolation**: Switching to **Live Mode** starts in an explicit `NOT CONNECTED` state and never silently falls back to synthetic fixtures when a poll fails or times out. Switching endpoints (`A → B` or `A → B → A`) immediately clears endpoint-bound snapshots, permissions, connection health, and feedback banners while aborting and invalidating any in-flight reads or commands from the previous endpoint.
- **Reversible Operator Controls**: Priority updates, project archive/unarchive (with 1-click Undo), operator notes, reminders, and decision resolutions use a single idempotent command envelope (`POST /api/mission-control/v1/commands`).

---

## 2. Baseline & Rollback Instructions
- **Reviewed Baseline Commit**: `077498e72ee7626ecb380fc5f2a443dbeea03a1c` (parent `400b1142a497c57b7763cb53d0efd6a085f26cb9`).
- **Inspect or Revert Changes**:
  - Compare with baseline: `git diff 077498e72ee7626ecb380fc5f2a443dbeea03a1c`
  - Roll back if needed: `git checkout 077498e72ee7626ecb380fc5f2a443dbeea03a1c`

---

## 3. Summary of the 7 Defect Repairs

1. **Continuous Single-Flight Polling Loop (`src/App.tsx`, `src/adapters/dataAdapter.ts`)**
   - Replaced the one-shot `useEffect` timeout with a self-rescheduling, single-flight polling loop (`runPollCycle`) that schedules the next poll after every completion (`connected`, `stale`, `error`, `timeout`, or `invalid_payload`) using exponential backoff (`1.5^failures` up to `60s`) and background-tab throttling (`visibilityState === 'hidden'`).
   - Automatically stops and invalidates timers and in-flight requests on unmount, mode change, or endpoint change.
   - Verified on a mounted `App` instance with fake timers across 5 consecutive successful polls, 2 consecutive HTTP failures with backoff (`1500ms`, `2250ms`), recovery (`1000ms`), and unmount cleanup.

2. **Complete Endpoint Isolation Across `A → B` and `A → B → A` (`src/App.tsx`, `src/adapters/dataAdapter.ts`, `src/components/AdapterConfigModal.tsx`)**
   - Shared monotonic `connectionGenRef` token across both live snapshot reads and live command dispatches.
   - Switching endpoints or modes aborts all in-flight `AbortController` instances, resets `LivePollCoordinator`, clears `liveSnapshot`, `liveConnectionHealth`, `liveLastError`, `liveLastContactAt`, `liveDataFreshness`, `selectedProjectId`, and `feedbackBanner`, and starts polling with the new `LiveAdapterConfig` explicitly passed into `runPollCycle(nextConfig, nextGen)`.
   - Late read or command responses from `A` (#1) or `B` are ignored even when switching `A → B → A` while requests are still pending.

3. **Strict Evidence & Gate Requirements for `Verified Complete` (`src/engine/stateEvaluator.ts`)**
   - Every required milestone must define at least one required acceptance gate (`requiredGates.length > 0`). Required milestones with zero required gates are flagged in `requiredMilestonesMissingGates` and blocked from `Verified Complete`.
   - Every required acceptance gate must have `status === 'passed'`, a valid non-future `verifiedAt` timestamp, and a non-empty `evidenceId` that resolves to an existing `EvidenceLink` in `snapshot.evidence` with `verified === true` and a valid non-future `observedAt` timestamp.
   - Optional gate failures (`required: false`) remain non-blocking warnings (`acceptanceWarnings`) and do not block `Verified Complete`.

4. **Complete Runtime Validation (`src/schema/validator.ts`, `src/engine/stateEvaluator.ts`)**
   - Validates every field consumed by the UI and evaluator before state publication: nested strings, booleans (`evidence.verified` must be boolean, `milestone.required`, `gate.required`, `worker.coverageAvailable`, `project.archived`, `project.workerCoverageKnown`), enums, timestamps, numeric values, and non-empty `decision.owner` / `blocker.owner` / `project.owner`.
   - Enforces full relational integrity: `worker.currentRunId -> snapshot.runs` (with matching `workerId` and `projectId`), `run.workerId -> snapshot.workers`, `run.milestoneId -> project.milestones`, `gate.evidenceId -> snapshot.evidence`, `milestone.dependsOnMilestoneIds` (existence + self-dependency check), `project.currentMilestoneId`, `project.latestUsefulResult.evidenceId`, `task.assignedWorkerId`, and `decision.milestoneId`.
   - Enforces per-source sequence monotonicity across snapshots (`OUT_OF_ORDER_SNAPSHOT`) and deterministic per-source event sequence resolution (`deduplicateAndOrderEvents`).
   - Invalid snapshots are rejected before state publication while preserving the last valid snapshot with a clear warning banner.

5. **Live Command Response Validation & Dispatch Rechecks (`src/schema/validator.ts`, `src/adapters/dataAdapter.ts`, `src/App.tsx`)**
   - `executeLiveCommand` rechecks connection health (`connected` or `stale`), `capabilities.commandEndpointVerified`, and the specific per-command capability (`canArchive`, `canChangePriority`, `canAddNote`, `canSendReminder`, `canResolveDecision`) at dispatch time.
   - `validateCommandResponsePayload` verifies HTTP status (`httpOk` and `200..299` required when `ok: true` — an HTTP 500 with `{ ok: true }` is rejected as `VALIDATION_ERROR`), exact `idempotencyKey` match, optional `commandType`/`projectId` match, valid `newRevision`, and internally consistent `deliveryAck` (`delivered_acknowledged` requires `acknowledged: true` and `ackId`; `accepted_pending_delivery` / `failed_delivery` / `uncertain_timeout` require `acknowledged: false`).

6. **Separated Transport Contact Time vs Snapshot Data Freshness (`src/adapters/dataAdapter.ts`, `src/App.tsx`)**
   - `LivePollCoordinator` and `App` track `lastSuccessfulContactAt` (HTTP 200 transport contact) separately from `dataFreshness` (`evaluateSnapshotDataFreshness`, which measures the age of `snapshot.generatedAt` and the newest entity `source.observedAt` against the evaluation clock).
   - If a server repeatedly returns HTTP 200 with an old snapshot whose timestamps exceed the freshness threshold (`max(staleFeedWarningSeconds, 3 * pollInterval)`), connection health transitions to `stale` (`HTTP 200 OK · Snapshot Data Stale`) while still recording `lastSuccessfulContactAt`.

7. **Truthful Dynamic Verification Badges (`src/components/ContractAndTestsView.tsx`)**
   - Verification badges for `Fixture & Evaluator Suite`, `Transport, Validator & Live Command Suite`, and `UI & Mounted Component Suite` are derived dynamically from completed test results (`UNEXECUTED`, `PENDING / RUNNING...`, `FAILED`, or `VERIFIED`).
   - `Real Local Mission Control Integration` is explicitly labeled `UNVERIFIED IN CLOUD SANDBOX`.

---

## 4. Verification & Test Suite
Run the full automated verification suite (17 tests, 109 assertions across Fixture/Evaluator, Transport/Validator, and Mounted React 19 UI/DOM suites):
```bash
npm test
npm run lint
npm run build
```
