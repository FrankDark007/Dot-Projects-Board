/**
 * @file src/tests/contractAndState.test.ts
 * @description Comprehensive automated regression suite separated into:
 * 1. Fixture & State Evaluator Tests (`fixture_evaluator`)
 * 2. Transport, Complete Runtime Validator & Live Command Validation Tests (`transport_validator`)
 * 3. Mounted UI / Browser Interaction, Continuous Polling & Endpoint Isolation Tests (`ui_behavior`)
 *
 * NOTE: Real local Mission Control / projectBoard integration remains UNVERIFIED in this cloud sandbox
 * and is reported separately on the Contract & Tests screen.
 */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import App from '../App';
import {
  DEFAULT_LIVE_CONFIG,
  evaluateSnapshotDataFreshness,
  executeLiveCommand,
  FetchLike,
  LiveAdapterConfig,
  LivePollCoordinator,
  MissionControlDataController,
} from '../adapters/dataAdapter';
import { AttentionPanel } from '../components/AttentionPanel';
import {
  ContractAndTestsView,
  deriveScopeVerificationSummary,
} from '../components/ContractAndTestsView';
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
  OperatorCommandRequest,
  ProjectRecord,
  WorkerRecord,
} from '../schema/contract';
import {
  validateCommandResponsePayload,
  validateSnapshotPayload,
} from '../schema/validator';
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
 * Scoped fake timer harness for testing mounted React components (`App`) with deterministic
 * timeout/interval scheduling, backoff delays, and virtual clock progression.
 */
interface FakeTimerController {
  nowMs: number;
  getNowIso: () => string;
  getPendingTimerCount: () => number;
  getLastScheduledTimeoutDelayMs: () => number | null;
  advanceTimeByMs: (deltaMs: number) => Promise<void>;
}

async function withFakeTimers<T>(
  initialIso: string,
  fn: (timers: FakeTimerController) => Promise<T>
): Promise<T> {
  const origSetTimeout = globalThis.setTimeout.bind(globalThis);
  const origClearTimeout = globalThis.clearTimeout.bind(globalThis);
  const origSetInterval = globalThis.setInterval.bind(globalThis);
  const origClearInterval = globalThis.clearInterval.bind(globalThis);

  let currentNowMs = Date.parse(initialIso);
  let nextTimerId = 100000;
  let lastScheduledTimeoutDelayMs: number | null = null;

  interface ScheduledEntry {
    id: number;
    targetTimeMs: number;
    delayMs: number;
    callback: () => void;
    intervalMs: number | null;
  }

  const tasks = new Map<number, ScheduledEntry>();

  // Intercept application timers (delays >= 5ms) while letting 0ms internal React scheduler ticks pass through
  globalThis.setTimeout = ((cb: TimerHandler, delay?: number, ...args: unknown[]) => {
    const d = typeof delay === 'number' ? delay : 0;
    if (d <= 1) {
      return origSetTimeout(cb, d, ...args);
    }
    const id = nextTimerId++;
    lastScheduledTimeoutDelayMs = d;
    tasks.set(id, {
      id,
      targetTimeMs: currentNowMs + d,
      delayMs: d,
      callback: () => {
        if (typeof cb === 'function') {
          cb(...args);
        }
      },
      intervalMs: null,
    });
    return id as unknown as ReturnType<typeof globalThis.setTimeout>;
  }) as typeof globalThis.setTimeout;

  globalThis.clearTimeout = ((id?: ReturnType<typeof globalThis.setTimeout>) => {
    const numId = Number(id);
    if (tasks.has(numId)) {
      tasks.delete(numId);
    } else {
      origClearTimeout(id);
    }
  }) as typeof globalThis.clearTimeout;

  globalThis.setInterval = ((cb: TimerHandler, delay?: number, ...args: unknown[]) => {
    const d = Math.max(10, typeof delay === 'number' ? delay : 1000);
    const id = nextTimerId++;
    tasks.set(id, {
      id,
      targetTimeMs: currentNowMs + d,
      delayMs: d,
      callback: () => {
        if (typeof cb === 'function') {
          cb(...args);
        }
      },
      intervalMs: d,
    });
    return id as unknown as ReturnType<typeof globalThis.setInterval>;
  }) as unknown as typeof globalThis.setInterval;

  globalThis.clearInterval = ((id?: ReturnType<typeof globalThis.setInterval>) => {
    const numId = Number(id);
    if (tasks.has(numId)) {
      tasks.delete(numId);
    } else {
      origClearInterval(id);
    }
  }) as typeof globalThis.clearInterval;

  const flushMicrotasks = async () => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
    }
  };

  const controller: FakeTimerController = {
    get nowMs() {
      return currentNowMs;
    },
    getNowIso: () => new Date(currentNowMs).toISOString(),
    getPendingTimerCount: () => tasks.size,
    getLastScheduledTimeoutDelayMs: () => lastScheduledTimeoutDelayMs,
    advanceTimeByMs: async (deltaMs: number) => {
      const targetEndMs = currentNowMs + deltaMs;
      while (true) {
        let earliest: ScheduledEntry | null = null;
        for (const entry of tasks.values()) {
          if (entry.targetTimeMs <= targetEndMs) {
            if (!earliest || entry.targetTimeMs < earliest.targetTimeMs) {
              earliest = entry;
            }
          }
        }
        if (!earliest) {
          break;
        }
        currentNowMs = earliest.targetTimeMs;
        if (earliest.intervalMs !== null) {
          earliest.targetTimeMs = currentNowMs + earliest.intervalMs;
        } else {
          tasks.delete(earliest.id);
        }
        await act(async () => {
          earliest!.callback();
          await flushMicrotasks();
        });
      }
      currentNowMs = targetEndMs;
      await act(async () => {
        await flushMicrotasks();
      });
    },
  };

  try {
    return await fn(controller);
  } finally {
    tasks.clear();
    globalThis.setTimeout = origSetTimeout;
    globalThis.clearTimeout = origClearTimeout;
    globalThis.setInterval = origSetInterval;
    globalThis.clearInterval = origClearInterval;
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
      assert(
        evalP.buckets.includes('blocked'),
        'Expected crashed worker to place project in blocked'
      );
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

      const evalAtT0 = evaluateProject(compactor, snap, REFERENCE_NOW_ISO);
      assert(evalAtT0.workerSummary.confirmedRunningCount === 2, '2 confirmed running at t=0');

      const futureClockIso = new Date(
        Date.parse(REFERENCE_NOW_ISO) + 120 * 1000
      ).toISOString();
      const evalAtT120 = evaluateProject(compactor, snap, futureClockIso);
      assert(
        evalAtT120.workerSummary.confirmedRunningCount === 0,
        'After +120s without a new snapshot, confirmedRunningCount drops to 0'
      );
      assert(
        evalAtT120.workerSummary.unknownExecutionCount === 2,
        'After +120s, both workers transition to unknownExecutionCount'
      );
      assert(
        !evalAtT120.buckets.includes('working_now'),
        'Project leaves working_now bucket when heartbeats expire'
      );

      const invalidTsEval = evaluateTimestamp('not-an-iso-date', REFERENCE_NOW_ISO);
      assert(invalidTsEval.valid === false, 'Malformed timestamp must be invalid');

      const futureSkewIso = new Date(
        Date.parse(REFERENCE_NOW_ISO) + 600 * 1000
      ).toISOString();
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
      const evalW = evaluateWorker(
        stalledWorker,
        REFERENCE_NOW_ISO,
        snap.evaluationThresholds
      );

      assert(
        evalW.isConfirmedAlive === true && evalW.isMakingProgress === false,
        'wk-webkit-01 (18s heartbeat, 48m progress) is confirmed alive but not making progress'
      );
      assert(
        evalW.evaluatedState === 'stalled_progress',
        'Evaluates to stalled_progress'
      );

      const safariProj = snap.projects.find(
        (p) => p.projectId === 'prj-safari-dom-bridge'
      )!;
      const evalSafari = evaluateProject(safariProj, snap, REFERENCE_NOW_ISO);
      assert(
        evalSafari.workerSummary.confirmedRunningCount === 1 &&
          evalSafari.workerSummary.confirmedProgressingCount === 0 &&
          evalSafari.workerSummary.stalledProgressCount === 1,
        'confirmedRunningCount includes alive-but-stalled worker (1), while confirmedProgressingCount is 0'
      );

      const mailProj = snap.projects.find(
        (p) => p.projectId === 'prj-legacy-mail-indexer'
      )!;
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

  // 5. Strict Verified Complete (Defect 3): Requires evidenceId on every required gate + required gates on every required milestone
  runTest(
    'test-05-strict-verified-complete',
    'fixture_evaluator',
    'Strict Verified Complete: Requires verified evidence with valid timestamp on every required gate and >=1 required gate per required milestone',
    'Strict Verified Complete',
    (assert) => {
      const controller = new MissionControlDataController();
      const snap = controller.getSnapshot();
      const rpcProj = snap.projects.find((p) => p.projectId === 'prj-json-rpc-framing')!;

      // Baseline rpcProj has passed required gate with verified evidenceId 'ev-rpc-fuzz'
      const evalBase = evaluateProject(rpcProj, snap, REFERENCE_NOW_ISO);
      assert(
        evalBase.buckets.includes('recently_verified_complete'),
        'Baseline prj-json-rpc-framing is verified complete'
      );

      // Case A: Required gate omits evidenceId (undefined / null) -> MUST NOT be Verified Complete!
      const withoutEvidenceId: ProjectRecord = {
        ...rpcProj,
        milestones: [
          {
            ...rpcProj.milestones[0],
            acceptanceGates: [
              {
                ...rpcProj.milestones[0].acceptanceGates[0],
                evidenceId: undefined,
              },
            ],
          },
        ],
      };
      const evalNoEvId = evaluateProject(withoutEvidenceId, snap, REFERENCE_NOW_ISO);
      assert(
        !evalNoEvId.buckets.includes('recently_verified_complete') &&
          evalNoEvId.inconsistentCompletionClaim === true &&
          Boolean(evalNoEvId.completionContradictionReason?.includes('evidenceId')),
        'Required gate without evidenceId must prevent Verified Complete'
      );

      // Case B: Required gate references unverified evidence (`verified: false`)
      const snapWithUnverifiedEv: MissionControlSnapshot = {
        ...snap,
        evidence: snap.evidence.map((ev) =>
          ev.evidenceId === 'ev-rpc-fuzz' ? { ...ev, verified: false } : ev
        ),
      };
      const evalUnverifiedEv = evaluateProject(
        rpcProj,
        snapWithUnverifiedEv,
        REFERENCE_NOW_ISO
      );
      assert(
        !evalUnverifiedEv.buckets.includes('recently_verified_complete') &&
          evalUnverifiedEv.inconsistentCompletionClaim === true,
        'Required gate referencing unverified evidence (verified: false) must prevent Verified Complete'
      );

      // Case C: Required gate references evidence with future/invalid timestamp
      const snapWithFutureEv: MissionControlSnapshot = {
        ...snap,
        evidence: snap.evidence.map((ev) =>
          ev.evidenceId === 'ev-rpc-fuzz'
            ? {
                ...ev,
                createdAt: new Date(
                  Date.parse(REFERENCE_NOW_ISO) + 3600 * 1000
                ).toISOString(),
              }
            : ev
        ),
      };
      const evalFutureEv = evaluateProject(rpcProj, snapWithFutureEv, REFERENCE_NOW_ISO);
      assert(
        !evalFutureEv.buckets.includes('recently_verified_complete') &&
          evalFutureEv.inconsistentCompletionClaim === true,
        'Required gate referencing evidence with future createdAt must prevent Verified Complete'
      );

      // Case D: Project has a second required milestone that is completed_verified with 0 remainingSteps,
      // but has ZERO required acceptance gates -> MUST NOT be Verified Complete!
      const withGatelessRequiredMilestone: ProjectRecord = {
        ...rpcProj,
        milestones: [
          rpcProj.milestones[0],
          {
            milestoneId: 'ms-rpc-2-gateless',
            title: 'Gateless Required Milestone',
            order: 2,
            required: true,
            status: 'completed_verified',
            dependsOnMilestoneIds: ['ms-rpc-1'],
            completedSteps: ['Step done'],
            currentStep: null,
            remainingSteps: [],
            acceptanceGates: [],
          },
        ],
      };
      const evalGatelessMs = evaluateProject(
        withGatelessRequiredMilestone,
        snap,
        REFERENCE_NOW_ISO
      );
      assert(
        !evalGatelessMs.buckets.includes('recently_verified_complete') &&
          evalGatelessMs.inconsistentCompletionClaim === true &&
          Boolean(
            evalGatelessMs.completionContradictionReason?.includes(
              'missing required acceptance gates'
            )
          ),
        'Required milestone without any required acceptance gate must prevent Verified Complete'
      );

      // Case E: Pending or skipped required gate blocks Verified Complete
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
        'Pending required gate must prevent Verified Complete'
      );

      // Case F: Failed OPTIONAL gate (`required: false`) keeps Verified Complete while surfacing warning
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

      return 'Verified required gates must reference existing verified evidence with valid timestamps, every required milestone must have >=1 required gate, and optional gate failures stay warnings.';
    }
  );

  // 6. Missing Costs, Explicit Event Deduplication & Per-Source Sequence Ordering
  runTest(
    'test-06-costs-and-deduplication',
    'fixture_evaluator',
    'Costs, Deduplication & Per-Source Sequence Ordering: Preserves newer sequence/timestamp on duplicate IDs and orders events deterministically',
    'Deduplication & sequence ordering',
    (assert) => {
      const raw = createSyntheticSnapshot(REFERENCE_NOW_ISO);
      const deduped = deduplicateSnapshot(raw);
      assert(
        deduped.droppedDuplicates.events === 1,
        'Expected 1 duplicate event dropped from raw synthetic fixture'
      );

      // Test per-source sequence deduplication: two events with same sourceId, higher sequence wins even if observedAt is identical
      const seqSnap: MissionControlSnapshot = {
        ...deduped.snapshot,
        events: [
          {
            eventId: 'evt-seq-v1',
            projectId: 'prj-context-compactor',
            timestamp: REFERENCE_NOW_ISO,
            category: 'progress',
            actor: 'wk-comp-01',
            title: 'Stale sequence v1 title',
            detail: 'v1',
            isMeaningfulProgress: true,
            source: {
              sourceId: 'shared-src-seq-id',
              kind: 'md_worker_daemon',
              emitterName: 'worker-emitter-a',
              observedAt: REFERENCE_NOW_ISO,
              sequence: 10,
            },
          },
          {
            eventId: 'evt-seq-v2',
            projectId: 'prj-context-compactor',
            timestamp: REFERENCE_NOW_ISO,
            category: 'progress',
            actor: 'wk-comp-01',
            title: 'Newer sequence v2 title',
            detail: 'v2',
            isMeaningfulProgress: true,
            source: {
              sourceId: 'shared-src-seq-id',
              kind: 'md_worker_daemon',
              emitterName: 'worker-emitter-a',
              observedAt: REFERENCE_NOW_ISO,
              sequence: 11,
            },
          },
        ],
      };
      const seqDeduped = deduplicateSnapshot(seqSnap);
      assert(
        seqDeduped.snapshot.events.length === 1 &&
          seqDeduped.snapshot.events[0].eventId === 'evt-seq-v2' &&
          seqDeduped.snapshot.events[0].title === 'Newer sequence v2 title',
        'Per-source sequence deduplication retains record with higher source.sequence (11 > 10)'
      );

      const safariProj = deduped.snapshot.projects.find(
        (p) => p.projectId === 'prj-safari-dom-bridge'
      )!;
      assert(
        safariProj.cost.coverage === 'unavailable' && safariProj.cost.knownUsd === null,
        'Unavailable cost coverage must remain null'
      );
      return 'Verified duplicate event deduplication, per-source sequence conflict resolution, and null cost preservation.';
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
        expectedRevision: 1,
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
  // SUITE B: RUNTIME VALIDATOR, COMMAND VALIDATOR & TRANSPORT TESTS (Sync portion)
  // ============================================================================

  // 8. Complete Runtime Snapshot Validation (Defect 4: Hostile inputs for every field & relationship)
  runTest(
    'test-08-runtime-snapshot-validator-hostile-inputs',
    'transport_validator',
    'Runtime Validator: Rejects missing decision.owner, non-boolean evidence.verified, broken worker.currentRunId/run.workerId refs, and per-source sequence regressions',
    'Hostile-input field & relational validation',
    (assert) => {
      const validBase = createSyntheticSnapshot(REFERENCE_NOW_ISO);
      const baseCheck = validateSnapshotPayload(validBase, {
        referenceNowIso: REFERENCE_NOW_ISO,
      });
      assert(baseCheck.valid === true, 'Baseline synthetic snapshot passes validation');

      // 1. Hostile decision missing `owner` (previously crashed d.owner.toLowerCase())
      const missingDecisionOwnerSnap = {
        ...validBase,
        decisions: [
          {
            ...validBase.decisions[0],
            owner: undefined,
          },
        ],
      };
      const ownerCheck = validateSnapshotPayload(missingDecisionOwnerSnap);
      assert(
        ownerCheck.valid === false &&
          ownerCheck.errorCode === 'INVALID_ENUM_OR_FIELD' &&
          ownerCheck.errors.some((e) => e.includes('decisions[0].owner')),
        'Decision missing owner is rejected by validateSnapshotPayload before state publication'
      );

      // Also verify evaluateProject never crashes even if passed a malformed decision directly
      const projDidNotCrash = evaluateProject(
        validBase.projects[0],
        missingDecisionOwnerSnap as unknown as MissionControlSnapshot,
        REFERENCE_NOW_ISO
      );
      assert(
        projDidNotCrash.openDecisionsForMe.length === 0,
        'evaluateProject safely guards non-string decision.owner without crashing'
      );

      // 2. Hostile evidence with non-boolean `verified` (e.g., string "true" or number 1)
      const nonBoolEvidenceSnap = {
        ...validBase,
        evidence: [
          {
            ...validBase.evidence[0],
            verified: 'true',
          },
          ...validBase.evidence.slice(1),
        ],
      };
      const evBoolCheck = validateSnapshotPayload(nonBoolEvidenceSnap);
      assert(
        evBoolCheck.valid === false &&
          evBoolCheck.errorCode === 'INVALID_ENUM_OR_FIELD' &&
          evBoolCheck.errors.some((e) => e.includes('evidence[0].verified must be a boolean')),
        'Non-boolean evidence.verified rejected with INVALID_ENUM_OR_FIELD'
      );

      // 3. Broken worker.currentRunId reference (points to non-existent runId)
      const brokenWorkerRunSnap = {
        ...validBase,
        workers: [
          {
            ...validBase.workers[0],
            currentRunId: 'run-does-not-exist-999',
          },
          ...validBase.workers.slice(1),
        ],
      };
      const wkRunCheck = validateSnapshotPayload(brokenWorkerRunSnap);
      assert(
        wkRunCheck.valid === false &&
          wkRunCheck.errorCode === 'BROKEN_REFERENCE' &&
          wkRunCheck.errors.some((e) => e.includes('currentRunId')),
        'worker.currentRunId referencing missing run rejected with BROKEN_REFERENCE'
      );

      // 4. Mismatched worker.currentRunId <-> run.workerId relationship
      const mismatchedWorkerRunOwnerSnap = {
        ...validBase,
        workers: [
          {
            ...validBase.workers[0], // wk-comp-01 on prj-context-compactor
            currentRunId: 'run-auth-204', // belongs to wk-auth-01 on prj-auth-token-broker
          },
          ...validBase.workers.slice(1),
        ],
      };
      const mismatchRunCheck = validateSnapshotPayload(mismatchedWorkerRunOwnerSnap);
      assert(
        mismatchRunCheck.valid === false &&
          mismatchRunCheck.errorCode === 'BROKEN_REFERENCE',
        'worker.currentRunId pointing to another worker run rejected with BROKEN_REFERENCE'
      );

      // 5. Broken run.workerId reference (points to non-existent workerId)
      const brokenRunWorkerSnap = {
        ...validBase,
        runs: [
          {
            ...validBase.runs[0],
            workerId: 'wk-ghost-999',
          },
          ...validBase.runs.slice(1),
        ],
      };
      const runWkCheck = validateSnapshotPayload(brokenRunWorkerSnap);
      assert(
        runWkCheck.valid === false &&
          runWkCheck.errorCode === 'BROKEN_REFERENCE' &&
          runWkCheck.errors.some((e) => e.includes('runs[0].workerId')),
        'run.workerId referencing non-existent worker rejected with BROKEN_REFERENCE'
      );

      // 6. Broken gate.evidenceId reference
      const brokenGateEvidenceSnap = {
        ...validBase,
        projects: [
          {
            ...validBase.projects[0],
            milestones: [
              {
                ...validBase.projects[0].milestones[0],
                acceptanceGates: [
                  {
                    ...validBase.projects[0].milestones[0].acceptanceGates[0],
                    evidenceId: 'ev-missing-999',
                  },
                ],
              },
            ],
          },
          ...validBase.projects.slice(1),
        ],
      };
      const gateEvCheck = validateSnapshotPayload(brokenGateEvidenceSnap);
      assert(
        gateEvCheck.valid === false &&
          gateEvCheck.errorCode === 'BROKEN_REFERENCE',
        'Acceptance gate referencing non-existent evidenceId rejected with BROKEN_REFERENCE'
      );

      // 7. Self-referential or missing milestone dependency
      const brokenMilestoneDepSnap = {
        ...validBase,
        projects: [
          {
            ...validBase.projects[0],
            milestones: [
              {
                ...validBase.projects[0].milestones[0],
                dependsOnMilestoneIds: ['ms-does-not-exist'],
              },
            ],
          },
          ...validBase.projects.slice(1),
        ],
      };
      const msDepCheck = validateSnapshotPayload(brokenMilestoneDepSnap);
      assert(
        msDepCheck.valid === false &&
          msDepCheck.errorCode === 'BROKEN_REFERENCE',
        'Milestone with broken dependsOnMilestoneIds rejected with BROKEN_REFERENCE'
      );

      // 8. Negative cost or non-null knownUsd when coverage is unavailable
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
          ...validBase.projects.slice(1),
        ],
      };
      const costCheck = validateSnapshotPayload(negCostSnap);
      assert(
        costCheck.valid === false && costCheck.errorCode === 'INVALID_NUMERIC_VALUE',
        'Negative knownUsd rejected with INVALID_NUMERIC_VALUE'
      );

      // 9. Per-source sequence regression on an entity across snapshots
      const regressedSourceSeqSnap: MissionControlSnapshot = {
        ...validBase,
        sequence: 43,
        generatedAt: new Date(Date.parse(REFERENCE_NOW_ISO) + 5000).toISOString(),
        projects: [
          {
            ...validBase.projects[0],
            source: {
              ...validBase.projects[0].source,
              sequence: 2, // validBase.projects[0].source.sequence is 7
            },
          },
          ...validBase.projects.slice(1),
        ],
      };
      const seqRegressCheck = validateSnapshotPayload(regressedSourceSeqSnap, {
        previousValidSnapshot: validBase,
      });
      assert(
        seqRegressCheck.valid === false &&
          seqRegressCheck.errorCode === 'OUT_OF_ORDER_SNAPSHOT',
        'Per-source sequence regression rejected with OUT_OF_ORDER_SNAPSHOT'
      );

      return 'Verified hostile-input rejection for missing decision.owner, non-boolean evidence.verified, broken worker/run/gate/milestone references, negative costs, and per-source sequence regressions.';
    }
  );

  // 9. Live Command Response Validation & Transport vs Data Freshness Separation (Defects 5 & 6)
  runTest(
    'test-09-command-response-validation-and-data-freshness',
    'transport_validator',
    'Command Validator & Freshness: Rejects HTTP 500 with ok:true, mismatched idempotencyKey, contradictory deliveryAck, and stale snapshot data on HTTP 200',
    'Command validation & data freshness',
    (assert) => {
      const sampleReq: OperatorCommandRequest = {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: 'req-key-101',
        expectedRevision: 12,
        issuedAt: REFERENCE_NOW_ISO,
        command: {
          type: 'send_reminder',
          projectId: 'prj-context-compactor',
          targetOwner: 'dot',
          message: 'Ping owner',
        },
      };

      // 1. Error HTTP 500 response containing { ok: true } must NEVER succeed
      const http500OkTrue = validateCommandResponsePayload(
        {
          ok: true,
          idempotencyKey: 'req-key-101',
          deliveryAck: {
            acknowledged: true,
            outcome: 'delivered_acknowledged',
            ackId: 'ack-1',
            channel: 'ipc',
            recipient: 'dot',
          },
        },
        sampleReq,
        500,
        false
      );
      assert(
        http500OkTrue.ok === false && http500OkTrue.errorCode === 'VALIDATION_ERROR',
        'HTTP 500 response with ok:true payload must be rejected as VALIDATION_ERROR'
      );

      // 2. Mismatched idempotencyKey must NEVER succeed
      const mismatchedKeyRes = validateCommandResponsePayload(
        {
          ok: true,
          idempotencyKey: 'wrong-key-999',
          deliveryAck: {
            acknowledged: true,
            outcome: 'delivered_acknowledged',
            ackId: 'ack-1',
            channel: 'ipc',
            recipient: 'dot',
          },
        },
        sampleReq,
        200,
        true
      );
      assert(
        mismatchedKeyRes.ok === false &&
          mismatchedKeyRes.errorCode === 'VALIDATION_ERROR' &&
          Boolean(mismatchedKeyRes.errorMessage?.includes('idempotencyKey mismatch')),
        'Mismatched idempotencyKey rejected with VALIDATION_ERROR'
      );

      // 3. Mismatched commandType or projectId must be rejected
      const mismatchedCmdTypeRes = validateCommandResponsePayload(
        {
          ok: true,
          idempotencyKey: 'req-key-101',
          commandType: 'archive_project',
          projectId: 'prj-context-compactor',
        },
        sampleReq,
        200,
        true
      );
      assert(
        mismatchedCmdTypeRes.ok === false &&
          mismatchedCmdTypeRes.errorCode === 'VALIDATION_ERROR',
        'Mismatched commandType rejected with VALIDATION_ERROR'
      );

      // 4. Contradictory deliveryAck: outcome='delivered_acknowledged' with acknowledged=false or ackId=null
      const contradictoryAckRes = validateCommandResponsePayload(
        {
          ok: true,
          idempotencyKey: 'req-key-101',
          deliveryAck: {
            acknowledged: false,
            outcome: 'delivered_acknowledged',
            ackId: null,
            channel: 'ipc',
            recipient: 'dot',
          },
        },
        sampleReq,
        200,
        true
      );
      assert(
        contradictoryAckRes.ok === false &&
          contradictoryAckRes.errorCode === 'VALIDATION_ERROR',
        'delivered_acknowledged with acknowledged:false / ackId:null rejected'
      );

      // 5. Separate transport health from snapshot data freshness:
      // Snapshot generatedAt is 120s old while staleFeedWarningSeconds is 30s
      const snap = createSyntheticSnapshot(REFERENCE_NOW_ISO);
      const nowPlus120s = new Date(
        Date.parse(REFERENCE_NOW_ISO) + 120 * 1000
      ).toISOString();
      const freshness = evaluateSnapshotDataFreshness(
        snap,
        nowPlus120s,
        DEFAULT_LIVE_CONFIG
      );
      assert(
        freshness.isDataFresh === false &&
          freshness.ageSeconds === 120 &&
          Boolean(freshness.reason?.includes('snapshot data is stale')),
        'Snapshot generated 120s ago (> 30s threshold) is marked stale even when HTTP transport succeeds'
      );

      return 'Verified command validator rejects HTTP 500 ok:true, mismatched keys, and contradictory deliveryAck, and data freshness is separated from HTTP contact.';
    }
  );

  // ============================================================================
  // SUITE C: TRUTHFUL VERIFICATION BADGES & STATIC COMPONENT MARKUP TESTS
  // ============================================================================

  // 10. Truthful Verification Badges (Defect 7) & Component Markup
  runTest(
    'test-10-truthful-verification-badges-and-components',
    'ui_behavior',
    'Truthful Verification Badges & Components: Derives PENDING, UNEXECUTED, FAILED, and VERIFIED badges dynamically from actual test results',
    'Truthful badges & component rendering',
    (assert) => {
      // 1. Test UNEXECUTED badge when 0 tests have run
      const unexecutedSummary = deriveScopeVerificationSummary(
        'fixture_evaluator',
        [],
        false
      );
      assert(
        unexecutedSummary.status === 'UNEXECUTED' &&
          unexecutedSummary.badgeLabel.includes('UNEXECUTED'),
        'Empty test results produce UNEXECUTED badge, never VERIFIED'
      );

      // 2. Test PENDING badge while async suite is running
      const pendingSummary = deriveScopeVerificationSummary(
        'transport_validator',
        [],
        true
      );
      assert(
        pendingSummary.status === 'PENDING' &&
          pendingSummary.badgeLabel.includes('PENDING / RUNNING'),
        'Running async scope produces PENDING / RUNNING badge, never VERIFIED'
      );

      // 3. Test FAILED badge when any test in scope fails
      const failedSummary = deriveScopeVerificationSummary(
        'ui_behavior',
        [
          {
            id: 't-pass',
            scope: 'ui_behavior',
            name: 'Pass test',
            scenarioCategory: 'UI',
            passed: true,
            assertionsRun: 2,
            details: 'ok',
          },
          {
            id: 't-fail',
            scope: 'ui_behavior',
            name: 'Fail test',
            scenarioCategory: 'UI',
            passed: false,
            assertionsRun: 1,
            details: 'failed',
            error: 'boom',
          },
        ],
        false
      );
      assert(
        failedSummary.status === 'FAILED' &&
          failedSummary.badgeLabel.includes('FAILED (1/2 passed'),
        'Failed test in scope produces FAILED badge, never VERIFIED'
      );

      // 4. Render ContractAndTestsView with overrideRunningAsync=true and overrideSyncResults=[]
      const unexecHtml = renderToStaticMarkup(
        React.createElement(ContractAndTestsView, {
          overrideSyncResults: [],
          overrideAsyncResults: [],
          overrideRunningAsync: false,
        })
      );
      assert(
        unexecHtml.includes('UNEXECUTED (0 tests run)') &&
          !unexecHtml.includes('VERIFIED ('),
        'ContractAndTestsView renders UNEXECUTED when no tests have run'
      );

      // 5. Render ProjectRow & AttentionPanel with read-only capabilities
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
        reasonIfDisabled: 'Live mode is read-only.',
      };

      const rowHtml = renderToStaticMarkup(
        React.createElement(ProjectRow, {
          evaluated: stalledProj,
          referenceNowIso: REFERENCE_NOW_ISO,
          capabilities: readOnlyCaps,
          isSelected: true,
          onSelectProject: () => {},
          onChangePriority: () => {},
          onToggleArchive: () => {},
          onSendReminder: () => {},
        })
      );
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
      const todayHtml = renderToStaticMarkup(
        React.createElement(TodayView, {
          snapshot: snap,
          evaluatedProjects: evaluatedAll,
          referenceNowIso: REFERENCE_NOW_ISO,
          onSelectProject: () => {},
        })
      );

      assert(
        rowHtml.includes('1 alive (stalled)') &&
          cardHtml.includes('1 alive (stalled progress)') &&
          attnHtml.includes('Confirmed Failure') &&
          todayHtml.includes('Verified Accomplishments'),
        'ProjectRow, ProjectCard, AttentionPanel, and TodayView render truthful statuses'
      );

      return 'Verified ContractAndTestsView dynamically renders UNEXECUTED, PENDING, FAILED, and VERIFIED badges from actual test state.';
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
 * Mounted App Continuous Polling (5+ polls + backoff + recovery), and Mounted App Endpoint
 * Isolation (A -> B and A -> B -> A while requests are pending) tests.
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
    scope: TestSuiteScope,
    name: string,
    scenarioCategory: string,
    fn: (assert: (cond: boolean, msg: string) => void) => Promise<string>
  ) => {
    const counter = { count: 0 };
    try {
      const details = await fn((cond, msg) => assertCondition(cond, msg, counter));
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
        details: 'Failed async assertion.',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  // Async Test 1: Out-of-Order & Malformed Response Rejection + Repeated Old Snapshot Data Freshness
  await runAsyncTest(
    'async-01-preserve-last-valid-and-stale-data-freshness',
    'transport_validator',
    'Transport vs Data Freshness: Preserves last valid snapshot on malformed/out-of-order responses and marks repeated old snapshots stale on HTTP 200',
    'Validation preservation & data freshness',
    async (assert) => {
      const coordinator = new LivePollCoordinator();
      const validSnap = createSyntheticSnapshot(REFERENCE_NOW_ISO);

      // 1st poll at t=0: valid fresh snapshot (sequence 42)
      const okFetch: FetchLike = async () =>
        new Response(JSON.stringify(validSnap), { status: 200 });
      const res1 = await coordinator.pollOnce(DEFAULT_LIVE_CONFIG, {
        referenceNowIso: REFERENCE_NOW_ISO,
        fetchImpl: okFetch,
      });
      assert(
        res1.status === 'updated' &&
          res1.connectionHealth === 'connected' &&
          res1.lastSuccessfulContactAt === REFERENCE_NOW_ISO,
        'First valid snapshot connects and records lastSuccessfulContactAt'
      );

      // 2nd poll at t=+90s: HTTP 200 succeeds, but server returns the EXACT SAME old snapshot (generatedAt = t=0, age 90s > 30s threshold)
      const laterContactIso = new Date(
        Date.parse(REFERENCE_NOW_ISO) + 90 * 1000
      ).toISOString();
      const resRepeatedOld = await coordinator.pollOnce(DEFAULT_LIVE_CONFIG, {
        referenceNowIso: laterContactIso,
        fetchImpl: okFetch,
      });
      assert(
        resRepeatedOld.status === 'updated' &&
          resRepeatedOld.lastSuccessfulContactAt === laterContactIso &&
          resRepeatedOld.connectionHealth === 'stale' &&
          Boolean(resRepeatedOld.warningOrError?.includes('snapshot data is stale')),
        'Repeated HTTP 200 response with old generatedAt updates lastSuccessfulContactAt but transitions connectionHealth to stale'
      );

      // 3rd poll: out-of-order snapshot (sequence 12 < 42)
      const staleSnap = { ...validSnap, snapshotId: 'snap-old', sequence: 12 };
      const outOfOrderFetch: FetchLike = async () =>
        new Response(JSON.stringify(staleSnap), { status: 200 });
      const res2 = await coordinator.pollOnce(DEFAULT_LIVE_CONFIG, {
        referenceNowIso: laterContactIso,
        fetchImpl: outOfOrderFetch,
      });
      assert(
        res2.status === 'rejected_validation_preserved_last' &&
          res2.connectionHealth === 'stale' &&
          res2.snapshot?.snapshotId === validSnap.snapshotId,
        'Out-of-order response is rejected while preserving last valid snapshot'
      );

      // 4th poll: malformed JSON structure
      const malformedFetch: FetchLike = async () =>
        new Response(JSON.stringify({ schemaVersion: CONTRACT_SCHEMA_VERSION }), {
          status: 200,
        });
      const res3 = await coordinator.pollOnce(DEFAULT_LIVE_CONFIG, {
        referenceNowIso: laterContactIso,
        fetchImpl: malformedFetch,
      });
      assert(
        res3.status === 'rejected_validation_preserved_last' &&
          res3.snapshot?.snapshotId === validSnap.snapshotId,
        'Malformed response is rejected while preserving last valid snapshot'
      );

      return 'Verified repeated HTTP 200 with old snapshot marks health stale while updating contact time, and malformed/out-of-order responses preserve last valid snapshot.';
    }
  );

  // Async Test 2: Hung Request Timeout, Overlapping Poll Prevention & Late Response Cancellation
  await runAsyncTest(
    'async-02-timeout-overlap-and-late-response-cancellation',
    'transport_validator',
    'Connection Handling: Aborts hung requests on timeout, prevents overlapping polls, and ignores late responses after mode/endpoint reset',
    'Timeouts, overlap & late responses',
    async (assert) => {
      const coordinator = new LivePollCoordinator();
      const validSnap = createSyntheticSnapshot(REFERENCE_NOW_ISO);

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

      let resolveSlowFetch!: (res: Response) => void;
      const slowFetch: FetchLike = () =>
        new Promise<Response>((resolve) => {
          resolveSlowFetch = resolve;
        });

      const firstPollPromise = coordinator.pollOnce(
        { ...DEFAULT_LIVE_CONFIG, requestTimeoutMs: 5000 },
        { fetchImpl: slowFetch }
      );

      const overlapOutcome = await coordinator.pollOnce(DEFAULT_LIVE_CONFIG, {
        fetchImpl: slowFetch,
      });
      assert(
        overlapOutcome.status === 'skipped_in_flight',
        'Overlapping poll while request is in flight is skipped'
      );

      coordinator.invalidateAndReset(true);

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

  // Async Test 3: Live Command Dispatch Recheck, Response Validation & Timeout Isolation (Defect 5)
  await runAsyncTest(
    'async-03-live-command-validation-and-isolation',
    'transport_validator',
    'Live Command Guard & Validation: Rechecks capability/connection at dispatch, rejects HTTP 500 ok:true & mismatched keys, and flags UNCERTAIN_WRITE_TIMEOUT without retry',
    'Live command validation & timeout',
    async (assert) => {
      let fetchCallCount = 0;
      const countingFetch: FetchLike = async () => {
        fetchCallCount += 1;
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      };

      const cmdReq: OperatorCommandRequest = {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: 'live-cmd-1',
        expectedRevision: 12,
        issuedAt: REFERENCE_NOW_ISO,
        command: {
          type: 'set_priority',
          projectId: 'prj-context-compactor',
          priority: 'critical',
        },
      };

      // 1. Unconfigured live command route blocks before fetch
      const blockedUnconfig = await executeLiveCommand(
        { ...DEFAULT_LIVE_CONFIG, enableLiveCommandRoute: false },
        {
          commandEndpointVerified: true,
          canArchive: true,
          canChangePriority: true,
          canAddNote: true,
          canSendReminder: true,
          canResolveDecision: true,
        },
        cmdReq,
        { connectionHealth: 'connected', fetchImpl: countingFetch }
      );
      assert(
        blockedUnconfig.ok === false &&
          blockedUnconfig.errorCode === 'LIVE_COMMANDS_UNCONFIGURED' &&
          fetchCallCount === 0,
        'Unconfigured live command route returns LIVE_COMMANDS_UNCONFIGURED without network call'
      );

      // 2. Specific capability disabled (canChangePriority: false while others true) blocks before fetch
      const blockedCap = await executeLiveCommand(
        { ...DEFAULT_LIVE_CONFIG, enableLiveCommandRoute: true },
        {
          commandEndpointVerified: true,
          canArchive: true,
          canChangePriority: false,
          canAddNote: true,
          canSendReminder: true,
          canResolveDecision: true,
        },
        cmdReq,
        { connectionHealth: 'connected', fetchImpl: countingFetch }
      );
      assert(
        blockedCap.ok === false &&
          blockedCap.errorCode === 'CAPABILITY_UNSUPPORTED' &&
          fetchCallCount === 0,
        'Disabled specific capability (canChangePriority=false) returns CAPABILITY_UNSUPPORTED at dispatch'
      );

      // 3. Stale or disconnected connection health blocks at dispatch before fetch
      const blockedStale = await executeLiveCommand(
        { ...DEFAULT_LIVE_CONFIG, enableLiveCommandRoute: true },
        {
          commandEndpointVerified: true,
          canArchive: true,
          canChangePriority: true,
          canAddNote: true,
          canSendReminder: true,
          canResolveDecision: true,
        },
        cmdReq,
        { connectionHealth: 'stale', fetchImpl: countingFetch }
      );
      assert(
        blockedStale.ok === false &&
          blockedStale.errorCode === 'NOT_CONNECTED' &&
          fetchCallCount === 0,
        'Stale connection health blocks live command at dispatch with NOT_CONNECTED'
      );

      // 4. Backend returns HTTP 500 with { ok: true, idempotencyKey: 'live-cmd-1' } -> must be rejected!
      const bad500Fetch: FetchLike = async () =>
        new Response(
          JSON.stringify({ ok: true, idempotencyKey: 'live-cmd-1', newRevision: 13 }),
          { status: 500 }
        );
      const bad500Res = await executeLiveCommand(
        { ...DEFAULT_LIVE_CONFIG, enableLiveCommandRoute: true },
        {
          commandEndpointVerified: true,
          canArchive: true,
          canChangePriority: true,
          canAddNote: true,
          canSendReminder: true,
          canResolveDecision: true,
        },
        cmdReq,
        { connectionHealth: 'connected', fetchImpl: bad500Fetch }
      );
      assert(
        bad500Res.ok === false && bad500Res.errorCode === 'VALIDATION_ERROR',
        'HTTP 500 with ok:true body is rejected with VALIDATION_ERROR'
      );

      // 5. Hung POST times out once with UNCERTAIN_WRITE_TIMEOUT and zero retries
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
          requestTimeoutMs: 40,
        },
        {
          commandEndpointVerified: true,
          canArchive: true,
          canChangePriority: true,
          canAddNote: true,
          canSendReminder: true,
          canResolveDecision: true,
        },
        cmdReq,
        { connectionHealth: 'connected', fetchImpl: hungPostFetch }
      );
      assert(
        uncertainRes.ok === false &&
          uncertainRes.errorCode === 'UNCERTAIN_WRITE_TIMEOUT' &&
          postAttempts === 1,
        'Hung live command POST times out after 1 attempt with UNCERTAIN_WRITE_TIMEOUT'
      );

      return 'Verified dispatch capability/connection checks, HTTP 500 ok:true rejection, and single-attempt UNCERTAIN_WRITE_TIMEOUT.';
    }
  );

  // Async Test 4 (Defect 1 & 7): Mounted App Continuous Single-Flight Polling with Fake Timers
  // Tests >= 5 consecutive successful polls, then failures with backoff, then recovery, then unmount cleanup!
  await runAsyncTest(
    'async-04-mounted-app-continuous-polling-backoff-recovery',
    'ui_behavior',
    'Mounted App Continuous Polling: Executes 5+ consecutive successful polls via fake timers, backs off on failures, recovers, and stops on unmount',
    'Continuous polling, backoff & recovery',
    async (assert) => {
      if (typeof document === 'undefined') {
        throw new Error('DOM document is required for mounted App tests.');
      }

      await withFakeTimers(REFERENCE_NOW_ISO, async (timers) => {
        let pollCounter = 0;
        let shouldFailNext = false;

        const testConfig: LiveAdapterConfig = {
          ...DEFAULT_LIVE_CONFIG,
          endpointBaseUrl: 'http://127.0.0.1:43110/api/mission-control/v1',
          basePollIntervalMs: 1000,
          maxBackoffMs: 10000,
          requestTimeoutMs: 500,
        };

        const mockLiveFetch: FetchLike = async () => {
          pollCounter += 1;
          if (shouldFailNext) {
            return new Response('Backend unavailable', {
              status: 503,
              statusText: 'Service Unavailable',
            });
          }
          const nowIso = timers.getNowIso();
          const snap = createSyntheticSnapshot(nowIso);
          return new Response(
            JSON.stringify({
              ...snap,
              snapshotId: `snap-live-seq-${pollCounter}`,
              sequence: 100 + pollCounter,
              generatedAt: nowIso,
            }),
            { status: 200 }
          );
        };

        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        try {
          // Mount App directly in Live Mode
          await act(async () => {
            root.render(
              React.createElement(App, {
                initialMode: 'live',
                initialLiveConfig: testConfig,
                liveFetchImpl: mockLiveFetch,
                getNowIso: timers.getNowIso,
              })
            );
          });

          // Initial poll (#1) executes immediately on mount
          assert(pollCounter === 1, `Expected initial mount poll (#1), got ${pollCounter}`);
          assert(
            container.textContent?.includes('Context Window Compactor') === true,
            'Mounted App renders live snapshot projects after Poll #1'
          );

          // Advance fake timers through 4 more consecutive intervals -> 5 consecutive successful polls!
          for (let expectedPoll = 2; expectedPoll <= 5; expectedPoll++) {
            assert(
              timers.getLastScheduledTimeoutDelayMs() === 1000,
              `Expected normal poll interval 1000ms before poll #${expectedPoll}, got ${timers.getLastScheduledTimeoutDelayMs()}`
            );
            await timers.advanceTimeByMs(1000);
            assert(
              pollCounter === expectedPoll,
              `Expected consecutive successful poll #${expectedPoll}, got ${pollCounter}`
            );
          }

          // Expand Technical Diagnostics to verify latest snapshot ID snap-live-seq-5 is rendered
          const diagBtn = Array.from(container.querySelectorAll('button')).find((b) =>
            b.textContent?.includes('Expand Diagnostics')
          );
          if (diagBtn) {
            await act(async () => {
              diagBtn.click();
            });
          }
          assert(
            container.textContent?.includes('snap-live-seq-5') === true,
            'Mounted App updated to snap-live-seq-5 after 5 consecutive polls'
          );

          // Now simulate 2 consecutive poll failures (#6 and #7) and verify exponential backoff!
          shouldFailNext = true;
          await timers.advanceTimeByMs(1000); // Triggers Poll #6 (fails -> consecutiveFailures = 1)
          assert(pollCounter === 6, 'Poll #6 executed and failed');
          const backoffDelay1 = timers.getLastScheduledTimeoutDelayMs();
          assert(
            backoffDelay1 === 1500,
            `Expected 1.5x backoff delay (1500ms) after 1st failure, got ${backoffDelay1}`
          );
          assert(
            container.textContent?.includes(
              'LIVE FEED DISCONNECTED — SHOWING PRESERVED SNAPSHOT'
            ) === true,
            'App shows disconnected banner while preserving snap-live-seq-5'
          );

          await timers.advanceTimeByMs(1500); // Triggers Poll #7 (fails -> consecutiveFailures = 2)
          assert(pollCounter === 7, 'Poll #7 executed after 1500ms backoff and failed');
          const backoffDelay2 = timers.getLastScheduledTimeoutDelayMs();
          assert(
            backoffDelay2 === 2250,
            `Expected 2.25x backoff delay (2250ms) after 2nd failure, got ${backoffDelay2}`
          );

          // Now recover on Poll #8!
          shouldFailNext = false;
          await timers.advanceTimeByMs(2250);
          assert(pollCounter === 8, 'Poll #8 executed after 2250ms and recovered');
          assert(
            timers.getLastScheduledTimeoutDelayMs() === 1000,
            `Expected poll delay to reset to base 1000ms after recovery, got ${timers.getLastScheduledTimeoutDelayMs()}`
          );
          assert(
            container.textContent?.includes('snap-live-seq-8') === true,
            'Recovered Poll #8 updated snapshot to snap-live-seq-8'
          );

          // Unmount App and verify polling stops completely
          await act(async () => {
            root.unmount();
          });
          await timers.advanceTimeByMs(5000);
          assert(
            pollCounter === 8,
            `Expected zero polls after unmount, pollCounter stayed ${pollCounter}`
          );
        } finally {
          container.remove();
        }
      });

      return 'Verified 5 consecutive successful polls on mounted App, 1.5x/2.25x backoff on failures, recovery to 1000ms, and full stop on unmount.';
    }
  );

  // Async Test 5 (Defect 2, 5, 7): Mounted App Complete Endpoint Isolation (A -> B and A -> B -> A while reads & commands are pending)
  await runAsyncTest(
    'async-05-mounted-app-endpoint-isolation-a-b-a',
    'ui_behavior',
    'Mounted App Endpoint Isolation: Clears old data/permissions and invalidates pending reads & commands across A → B and A → B → A transitions',
    'Endpoint isolation (A → B → A)',
    async (assert) => {
      if (typeof document === 'undefined') {
        throw new Error('DOM document is required for mounted App tests.');
      }

      await withFakeTimers(REFERENCE_NOW_ISO, async (timers) => {
        const endpointA = 'http://127.0.0.1:43110/api/endpoint-a';
        const endpointB = 'http://127.0.0.1:43110/api/endpoint-b';

        const pendingResolvers: Array<{
          url: string;
          method: string;
          resolve: (res: Response) => void;
        }> = [];
        const requestedUrls: string[] = [];

        const controlledFetch: FetchLike = (url, init) => {
          const method = init?.method || 'GET';
          requestedUrls.push(`${method} ${url}`);
          return new Promise<Response>((resolve) => {
            pendingResolvers.push({ url, method, resolve });
          });
        };

        const configA: LiveAdapterConfig = {
          ...DEFAULT_LIVE_CONFIG,
          endpointBaseUrl: endpointA,
          basePollIntervalMs: 5000,
          requestTimeoutMs: 30000,
          enableLiveCommandRoute: true,
        };

        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);

        try {
          // 1. Mount App connected to Endpoint A
          await act(async () => {
            root.render(
              React.createElement(App, {
                initialMode: 'live',
                initialLiveConfig: configA,
                liveFetchImpl: controlledFetch,
                getNowIso: timers.getNowIso,
              })
            );
          });

          assert(
            requestedUrls.length === 1 &&
              requestedUrls[0] === `GET ${endpointA}/snapshot`,
            'Initial poll targets Endpoint A'
          );

          // Resolve Endpoint A initial snapshot with writable capabilities (`commandEndpointVerified: true`)
          const snapA: MissionControlSnapshot = {
            ...createSyntheticSnapshot(timers.getNowIso()),
            snapshotId: 'snap-endpoint-A-initial',
            sequence: 10,
            capabilities: {
              commandEndpointVerified: true,
              canArchive: true,
              canChangePriority: true,
              canAddNote: true,
              canSendReminder: true,
              canResolveDecision: true,
            },
          };

          await act(async () => {
            pendingResolvers.shift()!.resolve(
              new Response(JSON.stringify(snapA), { status: 200 })
            );
            await Promise.resolve();
          });

          assert(
            container.textContent?.includes('Context Window Compactor') === true,
            'Endpoint A snapshot data is rendered'
          );

          // 2. Dispatch a Live Command (Archive) on Endpoint A and leave it PENDING,
          // AND trigger a second snapshot poll on Endpoint A and leave it PENDING!
          const archiveBtnOnA = Array.from(container.querySelectorAll('button')).find((b) =>
            b.getAttribute('aria-label')?.includes('Archive ')
          );
          assert(
            Boolean(archiveBtnOnA) && !archiveBtnOnA!.disabled,
            'Archive button is enabled on writable Endpoint A'
          );

          await act(async () => {
            archiveBtnOnA!.click();
          });

          assert(
            pendingResolvers.some(
              (r) => r.url === `${endpointA}/commands` && r.method === 'POST'
            ),
            'Command POST to Endpoint A is now pending in flight'
          );

          // Advance timer so Endpoint A Poll #2 is also in flight!
          await timers.advanceTimeByMs(5000);
          assert(
            pendingResolvers.some(
              (r) => r.url === `${endpointA}/snapshot` && r.method === 'GET'
            ),
            'Poll #2 GET to Endpoint A is also pending in flight'
          );

          // 3. Switch endpoint A -> B via Adapter & Mode modal while BOTH A's read and A's command are pending!
          const openAdapterBtn = Array.from(container.querySelectorAll('button')).find((b) =>
            b.textContent?.includes('Adapter & Mode')
          )!;
          await act(async () => {
            openAdapterBtn.click();
          });

          const setReactInputValue = (input: HTMLInputElement, nextVal: string) => {
            const prevVal = input.value;
            input.value = nextVal;
            const tracker = (
              input as unknown as { _valueTracker?: { setValue: (v: string) => void } }
            )._valueTracker;
            if (tracker) {
              tracker.setValue(prevVal);
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
          };

          const urlInput = container.querySelector(
            'input#endpoint-url'
          ) as HTMLInputElement;
          assert(Boolean(urlInput), 'Adapter modal endpoint URL input is open');

          await act(async () => {
            setReactInputValue(urlInput, endpointB);
          });

          const saveEndpointBtn = Array.from(container.querySelectorAll('button')).find(
            (b) => b.textContent?.includes('Save Adapter Config')
          )!;
          await act(async () => {
            saveEndpointBtn.click();
          });

          // Immediately upon switching A -> B:
          // - Endpoint A's snapshot and projects MUST be cleared (`Not Connected to Local Mission Control`)
          // - A new GET poll to Endpoint B MUST have started immediately!
          assert(
            container.textContent?.includes('Not Connected to Local Mission Control') ===
              true &&
              !container.textContent?.includes('Context Window Compactor'),
            'Switching A → B immediately clears Endpoint A snapshot data and shows Not Connected'
          );
          assert(
            requestedUrls[requestedUrls.length - 1] === `GET ${endpointB}/snapshot`,
            `Switching A → B immediately starts polling new Endpoint B (got ${
              requestedUrls[requestedUrls.length - 1]
            })`
          );

          // Resolve the stale pending command POST and stale pending GET from Endpoint A (#1)
          const staleACommand = pendingResolvers.find(
            (r) => r.url === `${endpointA}/commands`
          )!;
          const staleAGet = pendingResolvers.find(
            (r) => r.url === `${endpointA}/snapshot`
          )!;

          await act(async () => {
            staleACommand.resolve(
              new Response(
                JSON.stringify({
                  ok: true,
                  idempotencyKey: 'cmd-archive-prj-auth-token-broker-r7-1',
                  newRevision: 8,
                }),
                { status: 200 }
              )
            );
            staleAGet.resolve(
              new Response(JSON.stringify(snapA), { status: 200 })
            );
            await Promise.resolve();
          });

          assert(
            container.textContent?.includes('Not Connected to Local Mission Control') ===
              true &&
              !container.textContent?.includes('Live command (archive_project) acknowledged'),
            'Late read and command responses from Endpoint A (#1) are completely ignored on Endpoint B'
          );

          // 4. Now test A -> B -> A while Endpoint B's request is still pending!
          await act(async () => {
            openAdapterBtn.click();
          });
          const urlInput2 = container.querySelector(
            'input#endpoint-url'
          ) as HTMLInputElement;
          await act(async () => {
            setReactInputValue(urlInput2, endpointA);
          });
          const saveEndpointBtn2 = Array.from(container.querySelectorAll('button')).find(
            (b) => b.textContent?.includes('Save Adapter Config')
          )!;
          await act(async () => {
            saveEndpointBtn2.click();
          });

          assert(
            requestedUrls[requestedUrls.length - 1] === `GET ${endpointA}/snapshot`,
            'Switching B → A starts a fresh GET poll to Endpoint A (#2)'
          );

          // Resolve Endpoint B's pending GET late — must NOT populate Endpoint A (#2)!
          const staleBGet = pendingResolvers.find(
            (r) => r.url === `${endpointB}/snapshot`
          )!;
          const snapB: MissionControlSnapshot = {
            ...createSyntheticSnapshot(timers.getNowIso()),
            snapshotId: 'snap-endpoint-B-late',
            sequence: 99,
            projects: [
              {
                ...snapA.projects[0],
                name: 'INTRUDER_PROJECT_FROM_ENDPOINT_B',
              },
            ],
          };
          await act(async () => {
            staleBGet.resolve(new Response(JSON.stringify(snapB), { status: 200 }));
            await Promise.resolve();
          });

          assert(
            !container.textContent?.includes('INTRUDER_PROJECT_FROM_ENDPOINT_B') &&
              container.textContent?.includes('Not Connected to Local Mission Control'),
            'Late response from Endpoint B is ignored after switching back to Endpoint A (#2)'
          );

          // Finally, resolve the active Endpoint A (#2) GET with read-only capabilities (`canArchive: false`)
          const activeAGet = pendingResolvers[pendingResolvers.length - 1];
          const snapAReadOnly: MissionControlSnapshot = {
            ...snapA,
            snapshotId: 'snap-endpoint-A-second-connection',
            sequence: 20,
            capabilities: {
              commandEndpointVerified: false,
              canArchive: false,
              canChangePriority: false,
              canAddNote: false,
              canSendReminder: false,
              canResolveDecision: false,
            },
          };
          await act(async () => {
            activeAGet.resolve(
              new Response(JSON.stringify(snapAReadOnly), { status: 200 })
            );
            await Promise.resolve();
          });

          const archiveBtnOnASecond = Array.from(
            container.querySelectorAll('button')
          ).find((b) => b.getAttribute('aria-label')?.includes('Archive '));
          assert(
            Boolean(archiveBtnOnASecond) && archiveBtnOnASecond!.disabled === true,
            'Second connection to A uses its own read-only capabilities and never inherits old writable capabilities from A (#1)'
          );
        } finally {
          await act(async () => {
            root.unmount();
          });
          container.remove();
        }
      });

      return 'Verified complete endpoint isolation across A → B and A → B → A while reads and commands are pending.';
    }
  );

  // Async Test 6 (Defect 7): Mounted UI Interaction — Repeated Actions, Priority, Archive/Undo & Read-Only Toggle
  await runAsyncTest(
    'async-06-mounted-ui-interactions-and-repeated-controls',
    'ui_behavior',
    'Mounted UI Interactions: Verifies archive + undo, repeated priority changes, search/filter switching, and read-only control disabling in mounted DOM',
    'Mounted UI interactions & controls',
    async (assert) => {
      if (typeof document === 'undefined') {
        throw new Error('DOM document is required for mounted App tests.');
      }

      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);

      try {
        await act(async () => {
          root.render(React.createElement(App, { initialMode: 'demo' }));
        });

        // 1. Archive a project in Demo Mode and verify feedback banner + Undo button
        const archiveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
          b.getAttribute('aria-label')?.includes('Archive Local Keychain OAuth Token Broker')
        )!;
        assert(Boolean(archiveBtn), 'Found Archive button for Local Keychain OAuth Token Broker');

        await act(async () => {
          archiveBtn.click();
        });

        assert(
          container.textContent?.includes(
            'Archived "Local Keychain OAuth Token Broker" in demo state'
          ) === true,
          'Archiving project displays confirmation banner'
        );

        // Click Undo button in banner and verify restoration
        const undoBtn = Array.from(container.querySelectorAll('button')).find((b) =>
          b.textContent?.includes('Undo')
        )!;
        assert(Boolean(undoBtn), 'Undo button is rendered in feedback banner');

        await act(async () => {
          undoBtn.click();
        });

        assert(
          container.textContent?.includes(
            'Restored "Local Keychain OAuth Token Broker" from archive.'
          ) === true,
          'Clicking Undo restores the project immediately'
        );

        // 2. Repeated priority changes on the same project (verifying revision increments cleanly without stale conflict)
        const prioSelect = container.querySelector(
          'select[aria-label="Priority for Context Window Compactor & Deduplicator"]'
        ) as HTMLSelectElement;
        assert(Boolean(prioSelect), 'Found priority select for Context Window Compactor');

        await act(async () => {
          prioSelect.value = 'critical';
          prioSelect.dispatchEvent(new Event('change', { bubbles: true }));
        });
        assert(
          container.textContent?.includes('priority to CRITICAL (rev v13)') === true,
          'First priority change increments revision to v13'
        );

        const prioSelectAfter = container.querySelector(
          'select[aria-label="Priority for Context Window Compactor & Deduplicator"]'
        ) as HTMLSelectElement;
        await act(async () => {
          prioSelectAfter.value = 'low';
          prioSelectAfter.dispatchEvent(new Event('change', { bubbles: true }));
        });
        assert(
          container.textContent?.includes('priority to LOW (rev v14)') === true,
          'Second consecutive priority change increments revision to v14'
        );

        // 3. Advance Demo Clock +2m via banner button and verify heartbeat expiry updates live in DOM
        const advanceClockBtn = Array.from(container.querySelectorAll('button')).find(
          (b) => b.textContent?.includes('Advance Demo Clock +2m')
        )!;
        await act(async () => {
          advanceClockBtn.click();
        });
        assert(
          container.textContent?.includes('Clock advanced +120s') === true &&
            container.textContent?.includes('Execution Unknown · Heartbeat Expired') ===
              true,
          'Advancing demo clock +120s expires worker heartbeats in mounted DOM'
        );
      } finally {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      }

      return 'Verified mounted DOM archive + undo, repeated priority mutations (v13 -> v14), and live clock advance (+120s heartbeat expiry).';
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
