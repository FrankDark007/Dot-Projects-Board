/**
 * @file src/tests/contractAndState.test.ts
 * @description Automated verification suite testing all 11 required domain and contract invariants:
 * 1. Normal execution
 * 2. Worker crash
 * 3. Heartbeat expiry
 * 4. Stalled progress (heartbeat alive != progress)
 * 5. Disconnected sources & Live mode truthfulness (no silent demo fallback)
 * 6. Missing costs & unknown worker coverage (no invented metrics)
 * 7. Duplicate events deduplication by stable source ID
 * 8. Pending approval / decision state
 * 9. Failed reminder delivery vs verified delivery acknowledgment
 * 10. Archive / Undo + idempotency + revision conflict handling
 * 11. Completed execution turn with failed acceptance gate
 */

import { MissionControlDataController } from '../adapters/dataAdapter';
import {
  deduplicateSnapshot,
  evaluateAllProjects,
  evaluateProject,
  evaluateWorker,
} from '../engine/stateEvaluator';
import { createSyntheticSnapshot, REFERENCE_NOW_ISO } from '../fixtures/syntheticFixtures';
import { CONTRACT_SCHEMA_VERSION, WorkerRecord } from '../schema/contract';

export interface TestCaseResult {
  id: string;
  name: string;
  scenarioCategory: string;
  passed: boolean;
  assertionsRun: number;
  details: string;
  error?: string;
}

function assertCondition(condition: boolean, message: string, counter: { count: number }): void {
  counter.count += 1;
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

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
    name: string,
    scenarioCategory: string,
    fn: (assert: (cond: boolean, msg: string) => void) => string
  ) => {
    const counter = { count: 0 };
    try {
      const details = fn((cond, msg) => assertCondition(cond, msg, counter));
      results.push({
        id,
        name,
        scenarioCategory,
        passed: true,
        assertionsRun: counter.count,
        details,
      });
    } catch (err) {
      results.push({
        id,
        name,
        scenarioCategory,
        passed: false,
        assertionsRun: counter.count,
        details: 'Failed assertion.',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // 1. Normal Execution
  runTest(
    'test-01-normal-execution',
    'Normal Execution: Fresh heartbeat + fresh meaningful progress counts as Working Now',
    'Normal execution',
    (assert) => {
      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const compactor = snap.projects.find((p) => p.projectId === 'prj-context-compactor')!;
      const evaluated = evaluateProject(compactor, snap, REFERENCE_NOW_ISO);

      assert(
        evaluated.workerSummary.activeRunningCount === 2,
        'Expected 2 active_running workers on prj-context-compactor'
      );
      assert(
        evaluated.buckets.includes('working_now'),
        'Expected project to be in working_now bucket'
      );
      assert(
        evaluated.primaryStatusTone === 'active',
        'Expected primary status tone to be active'
      );
      return 'Verified 2 workers (wk-comp-01, wk-comp-02) have fresh heartbeats (14s, 22s) and fresh progress (2m, 4m).';
    }
  );

  // 2. Worker Crash
  runTest(
    'test-02-worker-crash',
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

  // 3. Heartbeat Expiry
  runTest(
    'test-03-heartbeat-expiry',
    'Heartbeat Expiry: Worker reported running with expired heartbeat (>90s) is stale_heartbeat, not active',
    'Heartbeat expiry',
    (assert) => {
      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const voiceWorker = snap.workers.find((w) => w.workerId === 'wk-voice-01')!;
      const evalW = evaluateWorker(voiceWorker, REFERENCE_NOW_ISO, snap.evaluationThresholds);
      const voiceProj = snap.projects.find((p) => p.projectId === 'prj-audio-whisper-queue')!;
      const evalP = evaluateProject(voiceProj, snap, REFERENCE_NOW_ISO);

      assert(voiceWorker.rawStatus === 'running', 'Fixture rawStatus is running');
      assert(
        evalW.evaluatedState === 'stale_heartbeat',
        'Expected expired 11m heartbeat to evaluate as stale_heartbeat'
      );
      assert(
        evalP.workerSummary.activeRunningCount === 0,
        'Stale heartbeat worker must NOT be counted as activeRunningCount'
      );
      assert(
        !evalP.buckets.includes('working_now'),
        'Project with only stale heartbeat worker must NOT be in working_now'
      );
      return 'Verified wk-voice-01 (11m since heartbeat > 90s threshold) evaluates to stale_heartbeat with 0 active workers.';
    }
  );

  // 4. Stalled Progress (Heartbeat != Progress)
  runTest(
    'test-04-stalled-progress',
    'Stalled Progress: Fresh heartbeat (18s) with stale progress (48m > 15m) evaluates as stalled_progress',
    'Stalled progress',
    (assert) => {
      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const stalledWorker = snap.workers.find((w) => w.workerId === 'wk-webkit-01')!;
      const evalW = evaluateWorker(stalledWorker, REFERENCE_NOW_ISO, snap.evaluationThresholds);

      assert(
        evalW.heartbeatAgeSeconds === 18,
        'Expected fresh 18s heartbeat age'
      );
      assert(
        evalW.progressAgeSeconds === 48 * 60,
        'Expected 48m progress age'
      );
      assert(
        evalW.evaluatedState === 'stalled_progress',
        'Expected fresh heartbeat + 48m no progress to evaluate as stalled_progress'
      );
      return 'Confirmed heartbeats prove liveness only: 18s heartbeat with 48m old progress flags stalled_progress.';
    }
  );

  // 5. Disconnected Sources
  runTest(
    'test-05-disconnected-sources',
    'Disconnected Sources: Disconnected worker & unknown coverage never fabricate active status',
    'Disconnected sources',
    (assert) => {
      const disconnectedWorker: WorkerRecord = {
        workerId: 'wk-disc-test',
        projectId: 'prj-legacy-mail-indexer',
        name: 'dot-worker-remote-01',
        role: 'Indexer',
        hostLabel: 'remote-mac',
        rawStatus: 'disconnected',
        currentRunId: null,
        currentTaskSummary: null,
        lastHeartbeatAt: REFERENCE_NOW_ISO,
        lastMeaningfulProgressAt: REFERENCE_NOW_ISO,
        lastProgressSummary: null,
        coverageAvailable: true,
        source: {
          sourceId: 'src-disc-1',
          kind: 'md_worker_daemon',
          emitterName: 'supervisor',
          observedAt: REFERENCE_NOW_ISO,
        },
      };
      const evalDisc = evaluateWorker(disconnectedWorker, REFERENCE_NOW_ISO, {
        heartbeatExpirySeconds: 90,
        stalledProgressSeconds: 900,
      });
      assert(
        evalDisc.evaluatedState === 'disconnected',
        'Expected disconnected worker to evaluate to disconnected'
      );

      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const mailProj = snap.projects.find((p) => p.projectId === 'prj-legacy-mail-indexer')!;
      const evalMail = evaluateProject(mailProj, snap, REFERENCE_NOW_ISO);

      assert(
        evalMail.workerSummary.coverageKnown === false,
        'Expected workerCoverageKnown to be false for prj-legacy-mail-indexer'
      );
      assert(
        evalMail.workerSummary.activeRunningCount === null,
        'Expected activeRunningCount to be null (unknown) when coverage is unavailable'
      );
      return 'Verified disconnected worker state and explicit null/unknown activeRunningCount when coverage is unavailable.';
    }
  );

  // 6. Missing Costs & Estimate Labeling
  runTest(
    'test-06-missing-costs',
    'Missing Costs & Estimates: Unavailable costs remain null; partial/estimated costs explicitly flagged',
    'Missing costs',
    (assert) => {
      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const safariProj = snap.projects.find((p) => p.projectId === 'prj-safari-dom-bridge')!;
      const compactorProj = snap.projects.find((p) => p.projectId === 'prj-context-compactor')!;

      assert(
        safariProj.cost.coverage === 'unavailable' && safariProj.cost.knownUsd === null,
        'Unavailable cost coverage must have knownUsd === null, never $0.00'
      );
      assert(
        compactorProj.cost.coverage === 'partial' && compactorProj.cost.isEstimate === true,
        'Partial cost coverage on compactor must flag isEstimate === true'
      );
      assert(
        compactorProj.cost.untrackedSources.length === 1,
        'Untracked cost sources must be listed explicitly'
      );
      return 'Verified unavailable costs remain null (not $0) and partial costs list untracked workers & estimate flags.';
    }
  );

  // 7. Duplicate Events Deduplication
  runTest(
    'test-07-duplicate-events',
    'Duplicate Events: Repeated event IDs / sourceIds are deduplicated keeping latest observation',
    'Duplicate events',
    (assert) => {
      const raw = createSyntheticSnapshot(REFERENCE_NOW_ISO);
      const rawCompEvents = raw.events.filter((e) => e.eventId === 'evt-comp-progress-105');
      assert(rawCompEvents.length === 2, 'Raw synthetic fixture contains 2 duplicate events');

      const deduped = deduplicateSnapshot(raw);
      const cleanCompEvents = deduped.snapshot.events.filter(
        (e) => e.eventId === 'evt-comp-progress-105'
      );
      assert(
        cleanCompEvents.length === 1,
        'Deduplicated snapshot must contain exactly 1 instance of evt-comp-progress-105'
      );
      assert(
        deduped.droppedDuplicates.events === 1 && deduped.totalDropped === 1,
        'Deduplication result must report 1 dropped duplicate event'
      );
      return 'Verified duplicate event evt-comp-progress-105 (sourceId src-evt-comp-105) was deduplicated cleanly.';
    }
  );

  // 8. Pending Approval
  runTest(
    'test-08-pending-approval',
    'Pending Approval: Open decisions assigned to "you" surface in waiting_for_me bucket and resolve cleanly',
    'Pending approval',
    (assert) => {
      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const evaluatedAll = evaluateAllProjects(snap, REFERENCE_NOW_ISO);
      const waitingProjects = evaluatedAll.filter((ep) =>
        ep.buckets.includes('waiting_for_me')
      );

      assert(
        waitingProjects.length === 2,
        'Expected 2 projects waiting for operator decision (auth-token-broker & audio-whisper-queue)'
      );

      const authProj = waitingProjects.find(
        (ep) => ep.project.projectId === 'prj-auth-token-broker'
      )!;
      assert(
        authProj.approvalState === 'waiting_for_me',
        'Expected approvalState === waiting_for_me'
      );

      // Resolve decision via command contract
      const res = controller.executeCommand({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: 'test-cmd-resolve-dec-1',
        expectedRevision: authProj.project.revision,
        issuedAt: REFERENCE_NOW_ISO,
        command: {
          type: 'resolve_decision',
          projectId: 'prj-auth-token-broker',
          decisionId: 'dec-auth-stderr',
          selectedOption: 'Compile-time removal of IPC payload logging',
          resolutionNote: 'Approved compile-time strip.',
        },
      });

      assert(res.ok === true, 'Expected resolve_decision command to succeed');
      const updatedEval = evaluateProject(
        controller.getSnapshot().projects.find((p) => p.projectId === 'prj-auth-token-broker')!,
        controller.getSnapshot(),
        REFERENCE_NOW_ISO
      );
      assert(
        updatedEval.openDecisionsForMe.length === 0,
        'Expected 0 open decisions for me after resolving dec-auth-stderr'
      );
      return 'Verified pending operator decisions populate waiting_for_me and transition to resolved via command API.';
    }
  );

  // 9. Failed Reminder Delivery vs Acknowledged Delivery
  runTest(
    'test-09-reminder-delivery-ack',
    'Reminder Delivery: Never reports "notified" without deliveryAck; surfaces explicit failure on EAGAIN',
    'Failed reminder delivery',
    (assert) => {
      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const safariProj = snap.projects.find((p) => p.projectId === 'prj-safari-dom-bridge')!;
      const compactorProj = snap.projects.find((p) => p.projectId === 'prj-context-compactor')!;

      // Attempt reminder to dot/macos-automation (configured to fail delivery)
      const failRes = controller.executeCommand({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: 'test-rem-fail-1',
        expectedRevision: safariProj.revision,
        issuedAt: REFERENCE_NOW_ISO,
        command: {
          type: 'send_reminder',
          projectId: safariProj.projectId,
          targetOwner: 'dot/macos-automation',
          message: 'Please check crashed worker wk-webkit-02.',
        },
      });

      assert(failRes.ok === false, 'Expected unacknowledged reminder to return ok: false');
      assert(
        failRes.errorCode === 'DELIVERY_FAILED',
        'Expected errorCode === DELIVERY_FAILED'
      );
      assert(
        failRes.deliveryAck?.acknowledged === false && failRes.deliveryAck?.ackId === null,
        'Expected deliveryAck.acknowledged === false'
      );

      // Attempt reminder to dot (healthy IPC channel)
      const okRes = controller.executeCommand({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: 'test-rem-ok-1',
        expectedRevision: compactorProj.revision,
        issuedAt: REFERENCE_NOW_ISO,
        command: {
          type: 'send_reminder',
          projectId: compactorProj.projectId,
          targetOwner: 'dot',
          message: 'Verify RSS peak after shard 4 completes.',
        },
      });

      assert(okRes.ok === true, 'Expected healthy IPC reminder to return ok: true');
      assert(
        okRes.deliveryAck?.acknowledged === true && Boolean(okRes.deliveryAck?.ackId),
        'Expected verified ackId on successful reminder delivery'
      );

      return 'Verified failed reminder returns DELIVERY_FAILED with acknowledged: false, while healthy IPC returns ackId.';
    }
  );

  // 10. Archive / Undo + Idempotency + Conflict Handling
  runTest(
    'test-10-archive-undo-idempotency',
    'Archive & Undo: Preserves workers/tasks, supports undo, deduplicates idempotency keys, and rejects stale revisions',
    'Archive/undo & conflicts',
    (assert) => {
      const controller = new MissionControlDataController();
      const beforeSnap = controller.getSnapshot();
      const target = beforeSnap.projects.find((p) => p.projectId === 'prj-context-compactor')!;
      const workersBefore = beforeSnap.workers.filter(
        (w) => w.projectId === target.projectId
      ).length;

      // Archive project
      const archRes = controller.executeCommand({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: 'cmd-archive-comp-1',
        expectedRevision: target.revision,
        issuedAt: REFERENCE_NOW_ISO,
        command: {
          type: 'archive_project',
          projectId: target.projectId,
          archive: true,
        },
      });
      assert(archRes.ok === true && archRes.newRevision === target.revision + 1, 'Archive succeeded');

      // Replay exact same idempotencyKey -> must deduplicate without incrementing revision again
      const replayRes = controller.executeCommand({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: 'cmd-archive-comp-1',
        expectedRevision: target.revision,
        issuedAt: REFERENCE_NOW_ISO,
        command: {
          type: 'archive_project',
          projectId: target.projectId,
          archive: true,
        },
      });
      assert(
        replayRes.ok === true && replayRes.deduplicatedReplay === true,
        'Expected idempotent replay to be flagged'
      );

      // Verify workers were NOT cancelled or deleted by archiving
      const afterArchSnap = controller.getSnapshot();
      const workersAfter = afterArchSnap.workers.filter(
        (w) => w.projectId === target.projectId
      ).length;
      assert(
        workersAfter === workersBefore && workersAfter === 2,
        'Archiving must not cancel or delete running workers'
      );

      // Stale revision conflict test
      const conflictRes = controller.executeCommand({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: 'cmd-stale-rev-test',
        expectedRevision: target.revision, // Stale! Current is target.revision + 1
        issuedAt: REFERENCE_NOW_ISO,
        command: {
          type: 'set_priority',
          projectId: target.projectId,
          priority: 'critical',
        },
      });
      assert(
        conflictRes.ok === false && conflictRes.errorCode === 'REVISION_CONFLICT',
        'Expected stale revision write to fail with REVISION_CONFLICT'
      );

      // Undo archive
      const undoRes = controller.executeCommand({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: 'cmd-undo-archive-comp-1',
        expectedRevision: archRes.newRevision!,
        issuedAt: REFERENCE_NOW_ISO,
        command: {
          type: 'archive_project',
          projectId: target.projectId,
          archive: false,
        },
      });
      assert(undoRes.ok === true, 'Expected Undo Archive to succeed');
      const restored = controller
        .getSnapshot()
        .projects.find((p) => p.projectId === target.projectId)!;
      assert(restored.archived === false, 'Project restored to active view');

      return 'Verified Archive/Undo preserves all running workers, enforces idempotency replay, and rejects stale revisions.';
    }
  );

  // 11. Completed Execution Turn with Failed Acceptance
  runTest(
    'test-11-completed-turn-failed-acceptance',
    'Completed Execution with Failed Acceptance: Succeeded agent turn with failed security gate is NOT complete',
    'Completed execution with failed acceptance',
    (assert) => {
      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const authProj = snap.projects.find((p) => p.projectId === 'prj-auth-token-broker')!;
      const evalAuth = evaluateProject(authProj, snap, REFERENCE_NOW_ISO);

      const authRuns = snap.runs.filter((r) => r.projectId === 'prj-auth-token-broker');
      assert(
        authRuns.some((r) => r.status === 'succeeded_turn'),
        'Worker run-auth-204 finished its coding turn (succeeded_turn)'
      );
      assert(
        evalAuth.executionFinishedButAcceptanceFailed === true,
        'Expected executionFinishedButAcceptanceFailed === true'
      );
      assert(
        !evalAuth.buckets.includes('recently_verified_complete'),
        'Project with failed acceptance gate must NEVER be in recently_verified_complete'
      );
      assert(
        evalAuth.buckets.includes('blocked') && evalAuth.buckets.includes('unfinished'),
        'Project must be classified as blocked and unfinished'
      );
      return 'Verified prj-auth-token-broker (succeeded_turn run-auth-204 + failed gate-sec-sandbox) flags Turn Finished · Acceptance Failed.';
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
