# `dot` Mission Control Dashboard — Local Integration Contract & README

## 1. Purpose & Environment Boundary
This dashboard was built in Google AI Studio with **zero access** to your Macs, local repositories, task sessions, MD workers, or private network. It does not claim to inspect live local machines from the cloud sandbox, and it requires **zero Gemini API calls** to render, evaluate, or refresh status.

It is structured as a clean, drop-in React + TypeScript module with separated schemas, deterministic state evaluators, synthetic fixtures, and an authenticated adapter ready for your local developer to wire into your existing **Mission Control** application.

---

## 2. Module Layout (Separated for Easy Integration)

- `src/schema/contract.ts` — Versioned TypeScript contract (`dot.mission-control.v1`) with stable IDs for `projects`, `tasks`, `workers`, `runs`, `decisions`, `evidence`, `events`, `notes`, and `reminders`.
- `src/schema/jsonSchemas.ts` — Formal JSON Schema (Draft 2020-12) definitions and example payloads/errors for Snapshot, SSE Event Stream, and Operator Commands.
- `src/engine/stateEvaluator.ts` — Pure, deterministic evaluation and deduplication functions (`deduplicateSnapshot`, `evaluateWorker`, `evaluateProject`, `evaluateAllProjects`).
- `src/adapters/dataAdapter.ts` — Adapter layer separating **Demo Mode** (synthetic fixtures with a persistent `DEMO DATA` banner) and **Live Mode** (`fetchLiveSnapshot` with bounded polling, exponential backoff, background-tab throttling, `NOT CONNECTED` default, and `STALE` last-known snapshot preservation).
- `src/fixtures/syntheticFixtures.ts` — Deterministic synthetic fixtures exercising all 11 required operational and failure states.
- `src/tests/contractAndState.test.ts` & `src/tests/runTests.ts` — Automated test suite (11 test cases, 34 assertions) runnable via CLI (`npx tsx src/tests/runTests.ts`) or live inside the **Contract & Tests** tab.

---

## 3. Four-Dimensional Truthful State Rules

`src/engine/stateEvaluator.ts` enforces strict separation between four independent axes:

1. **Project Completion & Verification (`acceptanceStatus` + Milestone Gates)**
   - A finished agent turn (`status: 'succeeded_turn'`), git commit, or closed session **never** marks a project complete.
   - A project only enters `recently_verified_complete` when `remainingMilestoneCount === 0`, `failedGateCount === 0`, and `acceptanceStatus === 'verified_passed'`.
   - If a worker finishes its coding turn (`succeeded_turn`) and a required acceptance gate fails, the evaluator explicitly flags `Turn Finished · Acceptance Failed`.

2. **Worker Execution Liveness vs. Meaningful Progress (`EvaluatedWorkerState`)**
   - **Heartbeats prove process liveness, not task progress.**
   - `active_running`: Requires `rawStatus === 'running'` AND a fresh heartbeat (`<= heartbeatExpirySeconds`, default 90s) AND fresh meaningful progress (`<= stalledProgressSeconds`, default 900s / 15m).
   - `stalled_progress`: Heartbeat is fresh (process is alive), but no meaningful progress has occurred within `stalledProgressSeconds`.
   - `stale_heartbeat`: Worker reported `'running'`, but its heartbeat expired (`> heartbeatExpirySeconds`). Not counted as active.
   - `crashed` / `failed` / `idle` / `queued` / `disconnected` / `unknown`: Explicitly distinguished. When `workerCoverageKnown === false`, active worker count is `null` (`Unknown`), never a fabricated `0`.

3. **Approval & Decision State (`ApprovalState`)**
   - Open `DecisionRequest` records with `owner: 'you'` place the project into the `waiting_for_me` overview bucket and surface the exact question or failure, age, owner, and recommended next step in the prominent **Attention Queue**.

4. **Connection Health (`ConnectionHealthState`)**
   - `demo_synthetic`: Explicit Demo Mode with persistent `DEMO DATA — SYNTHETIC FIXTURES` banner.
   - `not_connected`: Default Live Mode state until a valid `dot.mission-control.v1` snapshot is received. **Never silently substitutes demo data for a failed live feed.**
   - `degraded_stale`: When a previously connected live feed drops, the UI preserves the last-known snapshot and displays a prominent `STALE DATA — LIVE FEED DISCONNECTED` warning banner with the timestamp of the last verified sync.

---

## 4. Proposed Backend Endpoints (To Implement in Local Mission Control)

These are **proposed contracts** for your local developer to mount in your Mission Control server (default base URL: `http://127.0.0.1:43110/api/mission-control/v1`).

### A. `GET /api/mission-control/v1/snapshot`
Returns a JSON payload matching `MissionControlSnapshot` (`schemaVersion: "dot.mission-control.v1"`).
- **Headers**: `Accept: application/json`, `X-Mission-Control-Schema: dot.mission-control.v1`
- **Polling Strategy**: Bounded polling (default 10s) with exponential backoff on network/5xx errors (capped at 60s) and automatic background-tab throttling (`4x` slower when `document.visibilityState === 'hidden'`).

### B. `GET /api/mission-control/v1/events?sinceEventId=<id>` (Optional SSE Stream)
Single Server-Sent Events stream emitting deduplicated `ActivityEvent` and `WorkerRecord` updates.
- Every record is deduplicated on the client by both its primary ID (`eventId`, `workerId`, etc.) and `source.sourceId`.

### C. `POST /api/mission-control/v1/commands`
Executes operator controls with **idempotency** and **optimistic concurrency (`expectedRevision`)**:
- Supported command types:
  - `archive_project` (`archive: boolean` — supports Undo; **must not delete files or cancel running jobs**)
  - `set_priority` (`priority: 'critical' | 'high' | 'normal' | 'low'`)
  - `add_note` (`body: string`, `author: string`)
  - `send_reminder` (`targetOwner: string`, `message: string`)
  - `resolve_decision` (`decisionId: string`, `selectedOption?: string`, `resolutionNote: string`)

#### Example Command Request
```json
{
  "schemaVersion": "dot.mission-control.v1",
  "idempotencyKey": "ui-rem-prj-context-compactor-r12-1760462100",
  "expectedRevision": 12,
  "issuedAt": "2026-10-14T17:15:00.000Z",
  "command": {
    "type": "send_reminder",
    "projectId": "prj-context-compactor",
    "targetOwner": "dot",
    "message": "Verify RSS peak after shard 4 completes."
  }
}
```

#### Example Command Responses
- **200 OK (Verified Delivery Acknowledgment)**:
```json
{
  "ok": true,
  "idempotencyKey": "ui-rem-prj-context-compactor-r12-1760462100",
  "newRevision": 13,
  "acknowledgedAt": "2026-10-14T17:15:00.120Z",
  "deliveryAck": {
    "acknowledged": true,
    "ackId": "ack-ipc-99201",
    "channel": "dot-supervisor-ipc",
    "recipient": "dot"
  }
}
```
- **502 Bad Gateway (`DELIVERY_FAILED` — Never claim "dot notified" without ack)**:
```json
{
  "ok": false,
  "idempotencyKey": "ui-rem-prj-safari-dom-bridge-r4-1760462105",
  "newRevision": 5,
  "deliveryAck": {
    "acknowledged": false,
    "ackId": null,
    "channel": "macos-automation-bridge",
    "recipient": "dot/macos-automation",
    "error": "Bridge daemon queue full (EAGAIN); delivery not acknowledged."
  },
  "errorCode": "DELIVERY_FAILED",
  "errorMessage": "Reminder was NOT acknowledged by dot/macos-automation. Do not assume owner was notified."
}
```
- **409 Conflict (`REVISION_CONFLICT`)**:
```json
{
  "ok": false,
  "idempotencyKey": "cmd-stale-rev-test",
  "errorCode": "REVISION_CONFLICT",
  "errorMessage": "Conflict on Context Window Compactor: expected revision 12, but current revision is 13."
}
```

---

## 5. Running the Automated Tests

Run the CLI verification suite:
```bash
npx tsx src/tests/runTests.ts
```
Or open the **Contract & Tests** tab in the dashboard header to inspect and re-run all 11 scenarios interactively.
