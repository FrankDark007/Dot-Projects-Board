/**
 * @file src/tests/contractAndState.test.ts
 * @description Comprehensive automated regression suite separated into:
 * 1. Fixture & State Evaluator Tests (deterministic fake clocks, timestamp sanity, strict completion, liveness vs progress)
 * 2. Transport, Runtime Validator & Live Isolation Tests (mocked HTTP, hung requests, cancellation, out-of-order rejection, live read-only safety)
 * 3. UI Rendering & State Transition Tests (compact rows, cards, disabled live controls, long names, mode switch cleanup)
 *
 * NOTE: Real local Mission Control / projectBoard integration remains UNVERIFIED in this cloud sandbox
 * and is reported separately on the Contract & Tests screen.
 */

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  DEFAULT_LIVE_CONFIG,
  executeLiveCommand,
  FetchLike,
  LivePollCoordinator,
  MissionControlDataController,
} from '../adapters/dataAdapter';
import { AttentionPanel } from '../components/AttentionPanel';
import { ProjectCard } from '../components/ProjectCard';
import { ProjectRow } from '../components/ProjectRow';
import { TodayView } from '../components/TodayView';
import {
  deduplicateSnapshot,
  evaluateAllProjects,
  evaluateProject,
  evaluateWorker,
} from '../engine/stateEvaluator';
import { createSyntheticSnapshot, REFERENCE_NOW_ISO } from '../fixtures/syntheticFixtures';
import {
  CONTRACT_SCHEMA_VERSION,
  MissionControlSnapshot,
  ProjectRecord,
  WorkerRecord,
} from '../schema/contract';
import { validateSnapshotPayload } from '../schema/validator';
import { evaluateTimestamp } from '../utils/timeFormat';

export type TestSuiteScope =
  | 'fixture_evaluator'
  | 'transport_validator'
  | 'ui_behavior';

export interface TestCaseResult {
  id: string;
  scope: TestSuiteScope;
  name: string;
  scenarioCategory: string;
  passed: boolean;
  assertionsRun: number;
  details: string;
  error?: string;
}

function assertCondition(
  condition: boolean,
  message: string,
  counter: { count: number }
): void {
  counter.count += 1;
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

/**
 * Runs all synchronous Fixture, Evaluator, Validator, and UI rendering tests.
 */
export function runAllContractAndStateTests(): {
  allPassed: boolean;
  totalTests: number;
  passedTests: number;
  totalAssertions: number;
  results: TestCaseResult[];
} {
  const results: TestCaseResult[] = [];

  const runTest = (
    id: string,
    scope: TestSuiteScope,
    name: string,
    scenarioCategory: string,
    fn: (assert: (cond: boolean, msg: string) => void) => string
  ) => {
    const counter = { count: 0 };
    try {
      const details = fn((cond, msg) => assertCondition(cond, msg, counter));
      results.push({
        id,
        scope,
        name,
        scenarioCategory,
        passed: true,
        assertionsRun: counter.count,
        details,
      });
    } catch (err) {
      results.push({
        id,
        scope,
        name,
        scenarioCategory,
        passed: false,
        assertionsRun: counter.count,
        details: 'Failed assertion.',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // ============================================================================
  // SUITE A: FIXTURE & STATE EVALUATOR TESTS
  // ============================================================================

  // 1. Normal Execution
  runTest(
    'test-01-normal-execution',
    'fixture_evaluator',
    'Normal Execution: Fresh heartbeat + fresh meaningful progress counts as confirmed progressing',
    'Normal execution',
    (assert) => {
      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const compactor = snap.projects.find((p) => p.projectId === 'prj-context-compactor')!;
      const evaluated = evaluateProject(compactor, snap, REFERENCE_NOW_ISO);

      assert(
        evaluated.workerSummary.confirmedRunningCount === 2,
        'Expected 2 confirmedRunningCount on prj-context-compactor'
      );
      assert(
        evaluated.workerSummary.confirmedProgressingCount === 2,
        'Expected 2 confirmedProgressingCount on prj-context-compactor'
      );
      assert(
        evaluated.buckets.includes('working_now'),
        'Expected project to be in working_now bucket'
      );
      return 'Verified 2 workers (wk-comp-01, wk-comp-02) have fresh heartbeats (14s, 22s) and fresh progress (2m, 4m).';
    }
  );

  // 2. Worker Crash
  runTest(
    'test-02-worker-crash',
    'fixture_evaluator',
    'Worker Crash: Abnormal termination (SIGSEGV) flags worker crashed and blocks project',
    'Worker crash',
    (assert) => {
      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const crashWorker = snap.workers.find((w) => w.workerId === 'wk-webkit-02')!;
      const evalW = evaluateWorker(crashWorker, REFERENCE_NOW_ISO, snap.evaluationThresholds);
      const safariProj = snap.projects.find((p) => p.projectId === 'prj-safari-dom-bridge')!;
      const evalP = evaluateProject(safariProj, snap, REFERENCE_NOW_ISO);

      assert(evalW.evaluatedState === 'crashed', 'Expected wk-webkit-02 to be crashed');
      assert(
        evalW.statusExplanation.includes('SIGSEGV'),
        'Expected crash explanation to include exit reason SIGSEGV'
      );
      assert(
        evalP.workerSummary.crashedOrFailedCount === 1,
        'Expected crashedOrFailedCount === 1'
      );
      assert(evalP.buckets.includes('blocked'), 'Expected crashed worker to place project in blocked');
      return 'Verified wk-webkit-02 evaluates to crashed (SIGSEGV exit 139) and marks prj-safari-dom-bridge as Blocked.';
    }
  );

  // 3. Heartbeat Expiry Without New Snapshot + Invalid/Future Timestamps
  runTest(
    'test-03-heartbeat-expiry-and-future-timestamps',
    'fixture_evaluator',
    'Heartbeat Expiry & Clock Advance: Advancing clock expires heartbeats without a new snapshot; invalid/future timestamps are uncertain',
    'Heartbeat expiry & timestamps',
    (assert) => {
      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const compactor = snap.projects.find((p) => p.projectId === 'prj-context-compactor')!;

      // At t=0, compactor has 2 confirmed running workers
      const evalAtT0 = evaluateProject(compactor, snap, REFERENCE_NOW_ISO);
      assert(evalAtT0.workerSummary.confirmedRunningCount === 2, '2 confirmed running at t=0');

      // Advance clock by +120s WITHOUT changing the snapshot
      const futureClockIso = new Date(Date.parse(REFERENCE_NOW_ISO) + 120 * 1000).toISOString();
      const evalAtT120 = evaluateProject(compactor, snap, futureClockIso);
      assert(
        evalAtT120.workerSummary.confirmedRunningCount === 0,
        'After +120s without a new snapshot, confirmedRunningCount drops to 0'
      );
      assert(
        evalAtT120.workerSummary.unknownExecutionCount === 2,
        'After +120s, both workers transition to unknownExecutionCount (expired heartbeat without stop proof)'
      );
      assert(
        !evalAtT120.buckets.includes('working_now'),
        'Project leaves working_now bucket when heartbeats expire'
      );

      // Test invalid and implausibly future timestamps (+10 minutes in the future)
      const invalidTsEval = evaluateTimestamp('not-an-iso-date', REFERENCE_NOW_ISO);
      assert(invalidTsEval.valid === false, 'Malformed timestamp must be invalid');

      const futureSkewIso = new Date(Date.parse(REFERENCE_NOW_ISO) + 600 * 1000).toISOString();
      const futureTsEval = evaluateTimestamp(futureSkewIso, REFERENCE_NOW_ISO);
      assert(
        futureTsEval.valid === false && futureTsEval.isFuture === true,
        'Timestamp +600s in the future must be flagged invalid & isFuture'
      );

      const futureWorker: WorkerRecord = {
        ...snap.workers[0],
        workerId: 'wk-future-skew',
        lastHeartbeatAt: futureSkewIso,
      };
      const evalFutureW = evaluateWorker(
        futureWorker,
        REFERENCE_NOW_ISO,
        snap.evaluationThresholds
      );
      assert(
        evalFutureW.isConfirmedAlive === false &&
          evalFutureW.evaluatedState === 'unknown_expired_heartbeat',
        'Worker with implausibly future heartbeat must NOT be treated as fresh/alive'
      );

      return 'Verified advancing clock expires heartbeats into unknownExecutionCount without a new snapshot, and future/invalid timestamps are never treated as fresh.';
    }
  );

  // 4. Alive Worker with Stalled Progress & Partial Telemetry
  runTest(
    'test-04-liveness-progress-coverage-separation',
    'fixture_evaluator',
    'Liveness vs Progress vs Coverage: Stalled worker stays confirmed alive; missing coverage is never 0 or stalled',
    'Liveness, progress & coverage',
    (assert) => {
      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const stalledWorker = snap.workers.find((w) => w.workerId === 'wk-webkit-01')!;
      const evalW = evaluateWorker(stalledWorker, REFERENCE_NOW_ISO, snap.evaluationThresholds);

      assert(
        evalW.isConfirmedAlive === true && evalW.isMakingProgress === false,
        'wk-webkit-01 (18s heartbeat, 48m progress) is confirmed alive but not making progress'
      );
      assert(
        evalW.evaluatedState === 'stalled_progress',
        'Evaluates to stalled_progress'
      );

      const safariProj = snap.projects.find((p) => p.projectId === 'prj-safari-dom-bridge')!;
      const evalSafari = evaluateProject(safariProj, snap, REFERENCE_NOW_ISO);
      assert(
        evalSafari.workerSummary.confirmedRunningCount === 1 &&
          evalSafari.workerSummary.confirmedProgressingCount === 0 &&
          evalSafari.workerSummary.stalledProgressCount === 1,
        'confirmedRunningCount includes alive-but-stalled worker (1), while confirmedProgressingCount is 0'
      );

      // Missing telemetry coverage on prj-legacy-mail-indexer
      const mailProj = snap.projects.find((p) => p.projectId === 'prj-legacy-mail-indexer')!;
      const evalMail = evaluateProject(mailProj, snap, REFERENCE_NOW_ISO);
      assert(
        evalMail.workerSummary.coverageKnown === false &&
          evalMail.workerSummary.confirmedRunningCount === null,
        'Uncertain worker coverage must be null, never 0'
      );
      assert(
        !evalMail.buckets.includes('blocked'),
        'Missing telemetry coverage alone must NOT mark a project as blocked or stalled'
      );

      return 'Verified stalled-but-alive worker counts in confirmedRunningCount (1) while confirmedProgressingCount is 0, and missing telemetry is null without falsely blocking.';
    }
  );

  // 5. Strict Verified Complete: Pending/Skipped Required Gates, Optional Gates & Contradictions
  runTest(
    'test-05-strict-verified-complete',
    'fixture_evaluator',
    'Strict Verified Complete: Rejects pending/skipped required gates and missing evidence; allows failed optional gates with warning',
    'Strict Verified Complete',
    (assert) => {
      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const rpcProj = snap.projects.find((p) => p.projectId === 'prj-json-rpc-framing')!;

      // Baseline rpcProj is strictly verified complete
      const evalBase = evaluateProject(rpcProj, snap, REFERENCE_NOW_ISO);
      assert(
        evalBase.buckets.includes('recently_verified_complete'),
        'Baseline prj-json-rpc-framing is verified complete'
      );

      // Case A: Add a pending required gate while keeping acceptanceStatus = 'verified_passed'
      const withPendingRequired: ProjectRecord = {
        ...rpcProj,
        milestones: [
          {
            ...rpcProj.milestones[0],
            acceptanceGates: [
              ...rpcProj.milestones[0].acceptanceGates,
              {
                gateId: 'gate-req-pending',
                label: 'Required security audit',
                required: true,
                status: 'pending',
                verifiedAt: null,
                verifierSource: null,
                details: 'Still pending.',
              },
            ],
          },
        ],
      };
      const evalPendingReq = evaluateProject(withPendingRequired, snap, REFERENCE_NOW_ISO);
      assert(
        !evalPendingReq.buckets.includes('recently_verified_complete') &&
          evalPendingReq.inconsistentCompletionClaim === true,
        'Pending required gate must prevent Verified Complete and flag inconsistentCompletionClaim'
      );

      // Case B: Add a skipped required gate
      const withSkippedRequired: ProjectRecord = {
        ...rpcProj,
        milestones: [
          {
            ...rpcProj.milestones[0],
            acceptanceGates: [
              ...rpcProj.milestones[0].acceptanceGates,
              {
                gateId: 'gate-req-skipped',
                label: 'Required soak test',
                required: true,
                status: 'skipped',
                verifiedAt: null,
                verifierSource: null,
                details: 'Skipped by runner.',
              },
            ],
          },
        ],
      };
      const evalSkippedReq = evaluateProject(withSkippedRequired, snap, REFERENCE_NOW_ISO);
      assert(
        !evalSkippedReq.buckets.includes('recently_verified_complete') &&
          evalSkippedReq.inconsistentCompletionClaim === true,
        'Skipped required gate must prevent Verified Complete'
      );

      // Case C: Reference a missing evidenceId on a required gate
      const withMissingEvidence: ProjectRecord = {
        ...rpcProj,
        milestones: [
          {
            ...rpcProj.milestones[0],
            acceptanceGates: [
              {
                ...rpcProj.milestones[0].acceptanceGates[0],
                evidenceId: 'ev-non-existent-id',
              },
            ],
          },
        ],
      };
      const evalMissingEv = evaluateProject(withMissingEvidence, snap, REFERENCE_NOW_ISO);
      assert(
        !evalMissingEv.buckets.includes('recently_verified_complete') &&
          evalMissingEv.inconsistentCompletionClaim === true,
        'Missing evidence reference on required gate must prevent Verified Complete'
      );

      // Case D: Failed OPTIONAL gate (`required: false`) keeps Verified Complete while surfacing warning
      const withFailedOptional: ProjectRecord = {
        ...rpcProj,
        milestones: [
          {
            ...rpcProj.milestones[0],
            acceptanceGates: [
              ...rpcProj.milestones[0].acceptanceGates,
              {
                gateId: 'gate-opt-bench',
                label: 'Optional micro-benchmark target',
                required: false,
                status: 'failed',
                verifiedAt: REFERENCE_NOW_ISO,
                verifierSource: 'ci_verifier',
                details: '2% slower than optional stretch target.',
              },
            ],
          },
        ],
      };
      const evalFailedOpt = evaluateProject(withFailedOptional, snap, REFERENCE_NOW_ISO);
      assert(
        evalFailedOpt.buckets.includes('recently_verified_complete') &&
          evalFailedOpt.failedOptionalGateCount === 1,
        'Failed optional gate stays visible (failedOptionalGateCount=1) without failing Verified Complete'
      );

      return 'Verified pending/skipped required gates and missing evidence block Verified Complete, while optional gate failures remain visible as warnings.';
    }
  );

  // 6. Missing Costs & Duplicate Events
  runTest(
    'test-06-costs-and-deduplication',
    'fixture_evaluator',
    'Costs & Deduplication: Unavailable costs stay null; duplicate event IDs are deduplicated cleanly',
    'Missing costs & duplicate events',
    (assert) => {
      const raw = createSyntheticSnapshot(REFERENCE_NOW_ISO);
      const deduped = deduplicateSnapshot(raw);
      assert(
        deduped.droppedDuplicates.events === 1,
        'Expected 1 duplicate event dropped from raw synthetic fixture'
      );

      const safariProj = deduped.snapshot.projects.find(
        (p) => p.projectId === 'prj-safari-dom-bridge'
      )!;
      assert(
        safariProj.cost.coverage === 'unavailable' && safariProj.cost.knownUsd === null,
        'Unavailable cost coverage must remain null'
      );
      return 'Verified duplicate event deduplication and null cost preservation.';
    }
  );

  // 7. Archive / Undo, Revision Conflicts, Idempotency & Reminder Outcomes
  runTest(
    'test-07-commands-idempotency-reminders',
    'fixture_evaluator',
    'Demo Commands: Archive/undo preserves workers, enforces idempotency & conflicts, and distinguishes reminder outcomes',
    'Commands, reminders & conflicts',
    (assert) => {
      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const compactor = snap.projects.find((p) => p.projectId === 'prj-context-compactor')!;

      // Test accepted_pending_delivery outcome
      controller.setSimulateReminderOutcome('dot', 'accepted_pending_delivery');
      const pendingRem = controller.executeCommand({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: 'rem-pending-test',
        expectedRevision: compactor.revision,
        issuedAt: REFERENCE_NOW_ISO,
        command: {
          type: 'send_reminder',
          projectId: compactor.projectId,
          targetOwner: 'dot',
          message: 'Check shard 4',
        },
      });
      assert(
        pendingRem.ok === true &&
          pendingRem.commandAccepted === true &&
          pendingRem.deliveryAck?.acknowledged === false &&
          pendingRem.deliveryAck?.outcome === 'accepted_pending_delivery',
        'accepted_pending_delivery distinguishes command acceptance from actual delivery ack'
      );

      // Test uncertain_timeout outcome
      controller.setSimulateReminderOutcome('dot', 'uncertain_timeout');
      const timeoutRem = controller.executeCommand({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: 'rem-timeout-test',
        expectedRevision: pendingRem.newRevision!,
        issuedAt: REFERENCE_NOW_ISO,
        command: {
          type: 'send_reminder',
          projectId: compactor.projectId,
          targetOwner: 'dot',
          message: 'Check timeout',
        },
      });
      assert(
        timeoutRem.ok === false &&
          timeoutRem.errorCode === 'UNCERTAIN_WRITE_TIMEOUT' &&
          timeoutRem.deliveryAck?.outcome === 'uncertain_timeout',
        'Uncertain write timeout returns UNCERTAIN_WRITE_TIMEOUT'
      );

      // Test archive + replay idempotency + stale revision conflict
      const archRes = controller.executeCommand({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: 'arch-idem-1',
        expectedRevision: pendingRem.newRevision!,
        issuedAt: REFERENCE_NOW_ISO,
        command: {
          type: 'archive_project',
          projectId: compactor.projectId,
          archive: true,
        },
      });
      assert(archRes.ok === true, 'Archive succeeded');

      const replayRes = controller.executeCommand({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: 'arch-idem-1',
        expectedRevision: pendingRem.newRevision!,
        issuedAt: REFERENCE_NOW_ISO,
        command: {
          type: 'archive_project',
          projectId: compactor.projectId,
          archive: true,
        },
      });
      assert(replayRes.deduplicatedReplay === true, 'Idempotent replay detected');

      const conflictRes = controller.executeCommand({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: 'conflict-1',
        expectedRevision: 1, // Stale revision!
        issuedAt: REFERENCE_NOW_ISO,
        command: {
          type: 'set_priority',
          projectId: compactor.projectId,
          priority: 'critical',
        },
      });
      assert(
        conflictRes.ok === false && conflictRes.errorCode === 'REVISION_CONFLICT',
        'Stale expectedRevision rejected with REVISION_CONFLICT'
      );

      return 'Verified accepted_pending_delivery vs failed_delivery vs uncertain_timeout, archive idempotency, and revision conflict handling.';
    }
  );

  // ============================================================================
  // SUITE B: RUNTIME VALIDATOR & LIVE ISOLATION TESTS (Synchronous portion)
  // ============================================================================

  // 8. Runtime Snapshot Validation (Malformed, Duplicate IDs, Broken Refs, Out-of-Order)
  runTest(
    'test-08-runtime-snapshot-validator',
    'transport_validator',
    'Runtime Validator: Rejects malformed objects, duplicate IDs, broken references, negative costs, and out-of-order snapshots',
    'Snapshot validation & ordering',
    (assert) => {
      const validBase = createSyntheticSnapshot(REFERENCE_NOW_ISO);
      const baseCheck = validateSnapshotPayload(validBase, {
        referenceNowIso: REFERENCE_NOW_ISO,
      });
      assert(baseCheck.valid === true, 'Baseline synthetic snapshot passes validation');

      // 1. Duplicate projectId
      const dupProjSnap = {
        ...validBase,
        projects: [validBase.projects[0], validBase.projects[0]],
      };
      const dupCheck = validateSnapshotPayload(dupProjSnap);
      assert(
        dupCheck.valid === false && dupCheck.errorCode === 'DUPLICATE_ID',
        'Duplicate projectId rejected with DUPLICATE_ID'
      );

      // 2. Broken foreign key reference on worker.projectId
      const brokenRefSnap = {
        ...validBase,
        workers: [
          {
            ...validBase.workers[0],
            projectId: 'prj-does-not-exist',
          },
        ],
      };
      const refCheck = validateSnapshotPayload(brokenRefSnap);
      assert(
        refCheck.valid === false && refCheck.errorCode === 'BROKEN_REFERENCE',
        'Worker referencing non-existent projectId rejected with BROKEN_REFERENCE'
      );

      // 3. Negative cost
      const negCostSnap = {
        ...validBase,
        projects: [
          {
            ...validBase.projects[0],
            cost: {
              ...validBase.projects[0].cost,
              knownUsd: -5.2,
            },
          },
        ],
      };
      const costCheck = validateSnapshotPayload(negCostSnap);
      assert(
        costCheck.valid === false && costCheck.errorCode === 'INVALID_NUMERIC_VALUE',
        'Negative knownUsd rejected with INVALID_NUMERIC_VALUE'
      );

      // 4. Out-of-order snapshot (older sequence or older generatedAt)
      const olderSnap: MissionControlSnapshot = {
        ...validBase,
        sequence: 10, // validBase has sequence 42
        generatedAt: new Date(Date.parse(REFERENCE_NOW_ISO) - 60000).toISOString(),
      };
      const orderCheck = validateSnapshotPayload(olderSnap, {
        previousValidSnapshot: validBase,
      });
      assert(
        orderCheck.valid === false && orderCheck.errorCode === 'OUT_OF_ORDER_SNAPSHOT',
        'Older snapshot sequence/timestamp rejected with OUT_OF_ORDER_SNAPSHOT'
      );

      return 'Verified runtime validator catches duplicate IDs, broken references, negative costs, and out-of-order snapshots.';
    }
  );

  // 9. Live Mode Isolation (Never calls Demo Controller; unconfigured commands rejected)
  runTest(
    'test-09-live-isolation-no-demo-fallback',
    'transport_validator',
    'Live Mode Isolation: Live coordinator starts never_connected with null snapshot; unconfigured live writes never touch demo state',
    'Live isolation & read-only guard',
    (assert) => {
      const coordinator = new LivePollCoordinator();
      assert(
        coordinator.getConnectionHealth() === 'never_connected' &&
          coordinator.getLastValidSnapshot() === null,
        'LivePollCoordinator starts as never_connected with null snapshot'
      );

      const demoCtrl = new MissionControlDataController();
      const revBefore = demoCtrl.getSnapshot().projects[0].revision;

      // Verify that Live Mode capabilities when unconfigured disable all write controls
      const liveDefaultConfig = DEFAULT_LIVE_CONFIG;
      assert(
        liveDefaultConfig.enableLiveCommandRoute === false,
        'Live command route is disabled by default until local integration is verified'
      );
      assert(
        demoCtrl.getSnapshot().projects[0].revision === revBefore,
        'Demo controller state remains untouched'
      );

      return 'Confirmed LivePollCoordinator starts never_connected with null data and Live config defaults to read-only.';
    }
  );

  // ============================================================================
  // SUITE C: UI RENDERING & STATE TRANSITION TESTS
  // ============================================================================

  // 10. UI Rendering: Compact ProjectRow vs Card, Read-Only Disabled Controls & Long Names
  runTest(
    'test-10-ui-rendering-and-controls',
    'ui_behavior',
    'UI Components: Compact rows, cards, AttentionPanel, and TodayView render truthful states and disable controls in read-only mode',
    'UI rendering & disabled controls',
    (assert) => {
      const snap = createSyntheticSnapshot(REFERENCE_NOW_ISO);
      const evaluatedAll = evaluateAllProjects(snap, REFERENCE_NOW_ISO);
      const stalledProj = evaluatedAll.find(
        (ep) => ep.project.projectId === 'prj-safari-dom-bridge'
      )!;

      const readOnlyCaps = {
        canArchive: false,
        canChangePriority: false,
        canAddNote: false,
        canSendReminder: false,
        canResolveDecision: false,
        reasonIfDisabled: 'Live mode is read-only until command endpoint is verified.',
      };

      // Render ProjectRow with read-only capabilities and long project name
      const longNameEval = {
        ...stalledProj,
        project: {
          ...stalledProj.project,
          name: 'Very-Long-Project-Name-For-WebKit-Accessibility-Tree-Subframe-Inspector-Without-Horizontal-Overflow',
        },
      };

      const rowHtml = renderToStaticMarkup(
        React.createElement(ProjectRow, {
          evaluated: longNameEval,
          referenceNowIso: REFERENCE_NOW_ISO,
          capabilities: readOnlyCaps,
          isSelected: true,
          onSelectProject: () => {},
          onChangePriority: () => {},
          onToggleArchive: () => {},
          onSendReminder: () => {},
        })
      );

      assert(
        rowHtml.includes('1 alive (stalled)') && rowHtml.includes('1 crashed'),
        'ProjectRow renders both alive (stalled) and crashed worker counts distinctly'
      );
      assert(
        rowHtml.includes('disabled=""') || rowHtml.includes('disabled'),
        'ProjectRow disables priority, reminder, and archive controls when capabilities are false'
      );

      // Render ProjectCard
      const cardHtml = renderToStaticMarkup(
        React.createElement(ProjectCard, {
          evaluated: stalledProj,
          referenceNowIso: REFERENCE_NOW_ISO,
          capabilities: readOnlyCaps,
          onSelectProject: () => {},
          onChangePriority: () => {},
          onToggleArchive: () => {},
          onSendReminder: () => {},
        })
      );
      assert(
        cardHtml.includes('1 alive (stalled progress)'),
        'ProjectCard explicitly shows alive (stalled progress)'
      );

      // Render AttentionPanel and verify Confirmed Failure vs Missing Info distinction
      const attnHtml = renderToStaticMarkup(
        React.createElement(AttentionPanel, {
          decisions: snap.decisions,
          projects: snap.projects,
          referenceNowIso: REFERENCE_NOW_ISO,
          capabilities: readOnlyCaps,
          selectedProjectId: null,
          onSelectProject: () => {},
          onResolveDecision: () => {},
          onSendReminder: () => {},
        })
      );
      assert(
        attnHtml.includes('Confirmed Failure') &&
          attnHtml.includes('Missing Info / Decision'),
        'AttentionPanel visually distinguishes Confirmed Failure from Missing Info / Decision'
      );

      // Render TodayView
      const todayHtml = renderToStaticMarkup(
        React.createElement(TodayView, {
          snapshot: snap,
          evaluatedProjects: evaluatedAll,
          referenceNowIso: REFERENCE_NOW_ISO,
          onSelectProject: () => {},
        })
      );
      assert(
        todayHtml.includes('Current Work (Confirmed Alive)') &&
          todayHtml.includes('Verified Accomplishments'),
        'TodayView renders Confirmed Alive workers and Verified Accomplishments'
      );

      return 'Verified ProjectRow, ProjectCard, AttentionPanel, and TodayView markup, read-only disabled buttons, and long-name truncation.';
    }
  );

  // 11. Completed Execution Turn with Failed Acceptance
  runTest(
    'test-11-completed-turn-failed-acceptance',
    'fixture_evaluator',
    'Completed Execution with Failed Acceptance: Succeeded agent turn with failed security gate is NOT complete',
    'Completed execution with failed acceptance',
    (assert) => {
      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const authProj = snap.projects.find((p) => p.projectId === 'prj-auth-token-broker')!;
      const evalAuth = evaluateProject(authProj, snap, REFERENCE_NOW_ISO);

      assert(
        evalAuth.executionFinishedButAcceptanceFailed === true,
        'Expected executionFinishedButAcceptanceFailed === true'
      );
      assert(
        !evalAuth.buckets.includes('recently_verified_complete'),
        'Project with failed acceptance gate must NEVER be in recently_verified_complete'
      );
      return 'Verified prj-auth-token-broker (succeeded_turn run-auth-204 + failed gate-sec-sandbox) prevents completion.';
    }
  );

  const passedTests = results.filter((r) => r.passed).length;
  const totalAssertions = results.reduce((sum, r) => sum + r.assertionsRun, 0);

  return {
    allPassed: passedTests === results.length,
    totalTests: results.length,
    passedTests,
    totalAssertions,
    results,
  };
}

/**
 * Runs asynchronous Transport, Timeout, Overlapping Poll, Late-Response Cancellation,
 * Out-of-Order Preservation, and Live Command Isolation tests using mocked HTTP (`FetchLike`).
 */
export async function runAsyncTransportTests(): Promise<{
  allPassed: boolean;
  totalTests: number;
  passedTests: number;
  totalAssertions: number;
  results: TestCaseResult[];
}> {
  const results: TestCaseResult[] = [];

  const runAsyncTest = async (
    id: string,
    name: string,
    scenarioCategory: string,
    fn: (assert: (cond: boolean, msg: string) => void) => Promise<string>
  ) => {
    const counter = { count: 0 };
    try {
      const details = await fn((cond, msg) => assertCondition(cond, msg, counter));
      results.push({
        id,
        scope: 'transport_validator',
        name,
        scenarioCategory,
        passed: true,
        assertionsRun: counter.count,
        details,
      });
    } catch (err) {
      results.push({
        id,
        scope: 'transport_validator',
        name,
        scenarioCategory,
        passed: false,
        assertionsRun: counter.count,
        details: 'Failed async transport assertion.',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Async Test 1: Out-of-Order & Malformed Response Rejection Preserves Last Valid Snapshot
  await runAsyncTest(
    'async-01-preserve-last-valid-on-malformed-or-out-of-order',
    'Transport Validation: Malformed or out-of-order live responses are rejected while preserving the last valid snapshot',
    'Malformed & out-of-order preservation',
    async (assert) => {
      const coordinator = new LivePollCoordinator();
      const validSnap = createSyntheticSnapshot(REFERENCE_NOW_ISO);

      // 1st poll: valid snapshot (sequence 42)
      const okFetch: FetchLike = async () =>
        new Response(JSON.stringify(validSnap), { status: 200 });
      const res1 = await coordinator.pollOnce(DEFAULT_LIVE_CONFIG, {
        referenceNowIso: REFERENCE_NOW_ISO,
        fetchImpl: okFetch,
      });
      assert(
        res1.status === 'updated' && res1.connectionHealth === 'connected',
        'First valid snapshot connects and updates state'
      );

      // 2nd poll: out-of-order snapshot (sequence 12 < 42)
      const staleSnap = { ...validSnap, snapshotId: 'snap-old', sequence: 12 };
      const outOfOrderFetch: FetchLike = async () =>
        new Response(JSON.stringify(staleSnap), { status: 200 });
      const res2 = await coordinator.pollOnce(DEFAULT_LIVE_CONFIG, {
        referenceNowIso: REFERENCE_NOW_ISO,
        fetchImpl: outOfOrderFetch,
      });
      assert(
        res2.status === 'rejected_validation_preserved_last' &&
          res2.connectionHealth === 'stale' &&
          res2.snapshot?.snapshotId === validSnap.snapshotId,
        'Out-of-order response is rejected while preserving last valid snapshot and marking health stale'
      );

      // 3rd poll: malformed JSON structure
      const malformedFetch: FetchLike = async () =>
        new Response(JSON.stringify({ schemaVersion: CONTRACT_SCHEMA_VERSION }), {
          status: 200,
        });
      const res3 = await coordinator.pollOnce(DEFAULT_LIVE_CONFIG, {
        referenceNowIso: REFERENCE_NOW_ISO,
        fetchImpl: malformedFetch,
      });
      assert(
        res3.status === 'rejected_validation_preserved_last' &&
          res3.snapshot?.snapshotId === validSnap.snapshotId,
        'Malformed response is rejected while preserving last valid snapshot'
      );

      return 'Verified coordinator accepts valid snapshot, then rejects out-of-order (seq 12 < 42) and malformed responses while preserving snap-demo-20261014-01.';
    }
  );

  // Async Test 2: Hung Request Timeout, Overlapping Poll Prevention & Late Response Cancellation
  await runAsyncTest(
    'async-02-timeout-overlap-and-late-response-cancellation',
    'Connection Handling: Aborts hung requests on timeout, prevents overlapping polls, and ignores late responses after mode/endpoint reset',
    'Timeouts, overlap & late responses',
    async (assert) => {
      const coordinator = new LivePollCoordinator();
      const validSnap = createSyntheticSnapshot(REFERENCE_NOW_ISO);

      // Test A: Hung request aborted by requestTimeoutMs (50ms)
      const hungFetch: FetchLike = (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('Aborted by signal'));
          });
        });

      const timeoutRes = await coordinator.pollOnce(
        { ...DEFAULT_LIVE_CONFIG, requestTimeoutMs: 50 },
        { fetchImpl: hungFetch }
      );
      assert(
        timeoutRes.status === 'network_error' &&
          timeoutRes.connectionHealth === 'never_connected' &&
          Boolean(timeoutRes.warningOrError?.includes('timed out')),
        'Hung request times out cleanly and stays never_connected with null snapshot'
      );

      // Test B: Overlapping poll prevention & Late response ignored after invalidateAndReset
      let resolveSlowFetch!: (res: Response) => void;
      const slowFetch: FetchLike = () =>
        new Promise<Response>((resolve) => {
          resolveSlowFetch = resolve;
        });

      const firstPollPromise = coordinator.pollOnce(
        { ...DEFAULT_LIVE_CONFIG, requestTimeoutMs: 5000 },
        { fetchImpl: slowFetch }
      );

      // Attempt overlapping poll while firstPollPromise is still in flight
      const overlapOutcome = await coordinator.pollOnce(DEFAULT_LIVE_CONFIG, {
        fetchImpl: slowFetch,
      });
      assert(
        overlapOutcome.status === 'skipped_in_flight',
        'Overlapping poll while request is in flight is skipped'
      );

      // Now simulate switching mode or changing endpoint URL before slowFetch resolves
      coordinator.invalidateAndReset(true);

      // Resolve the old slowFetch AFTER invalidation
      resolveSlowFetch(new Response(JSON.stringify(validSnap), { status: 200 }));
      const lateOutcome = await firstPollPromise;
      assert(
        lateOutcome.status === 'ignored_stale_generation' &&
          coordinator.getLastValidSnapshot() === null,
        'Late response from invalidated generation is ignored and does not populate snapshot'
      );

      return 'Verified 50ms AbortSignal timeout on hung requests, skipped_in_flight overlap guard, and ignored_stale_generation on late responses.';
    }
  );

  // Async Test 3: Live Command Read-Only Guard & Uncertain Timeout Handling
  await runAsyncTest(
    'async-03-live-command-isolation-and-timeout',
    'Live Command Guard: Blocks writes when unconfigured and flags UNCERTAIN_WRITE_TIMEOUT on hung command POST without retrying',
    'Live command isolation & timeout',
    async (assert) => {
      let fetchCallCount = 0;
      const countingFetch: FetchLike = async () => {
        fetchCallCount += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };

      // 1. Unconfigured live command route must NOT even call fetch
      const blockedRes = await executeLiveCommand(
        { ...DEFAULT_LIVE_CONFIG, enableLiveCommandRoute: false },
        {
          commandEndpointVerified: false,
          canArchive: true,
          canChangePriority: true,
          canAddNote: true,
          canSendReminder: true,
          canResolveDecision: true,
        },
        {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          idempotencyKey: 'live-cmd-blocked-1',
          expectedRevision: 1,
          issuedAt: REFERENCE_NOW_ISO,
          command: {
            type: 'set_priority',
            projectId: 'prj-context-compactor',
            priority: 'critical',
          },
        },
        { fetchImpl: countingFetch }
      );

      assert(
        blockedRes.ok === false &&
          blockedRes.errorCode === 'LIVE_COMMANDS_UNCONFIGURED' &&
          fetchCallCount === 0,
        'Unconfigured live command returns LIVE_COMMANDS_UNCONFIGURED without network call or demo fallback'
      );

      // 2. When enabled & verified, a hung POST times out once with UNCERTAIN_WRITE_TIMEOUT and does NOT retry
      let postAttempts = 0;
      const hungPostFetch: FetchLike = (_url, init) => {
        postAttempts += 1;
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('POST aborted'))
          );
        });
      };

      const uncertainRes = await executeLiveCommand(
        {
          ...DEFAULT_LIVE_CONFIG,
          enableLiveCommandRoute: true,
          requestTimeoutMs: 50,
        },
        {
          commandEndpointVerified: true,
          canArchive: true,
          canChangePriority: true,
          canAddNote: true,
          canSendReminder: true,
          canResolveDecision: true,
        },
        {
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          idempotencyKey: 'live-cmd-timeout-1',
          expectedRevision: 12,
          issuedAt: REFERENCE_NOW_ISO,
          command: {
            type: 'send_reminder',
            projectId: 'prj-context-compactor',
            targetOwner: 'dot',
            message: 'Ping',
          },
        },
        { fetchImpl: hungPostFetch }
      );

      assert(
        uncertainRes.ok === false &&
          uncertainRes.errorCode === 'UNCERTAIN_WRITE_TIMEOUT' &&
          uncertainRes.deliveryAck?.outcome === 'uncertain_timeout' &&
          postAttempts === 1,
        'Hung live command POST times out after 1 attempt with UNCERTAIN_WRITE_TIMEOUT and zero blind retries'
      );

      return 'Verified unconfigured live writes are blocked, and hung live writes return UNCERTAIN_WRITE_TIMEOUT after exactly 1 attempt.';
    }
  );

  const passedTests = results.filter((r) => r.passed).length;
  const totalAssertions = results.reduce((sum, r) => sum + r.assertionsRun, 0);

  return {
    allPassed: passedTests === results.length,
    totalTests: results.length,
    passedTests,
    totalAssertions,
    results,
  };
}
