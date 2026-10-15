/**
 * @file src/engine/stateEvaluator.ts
 * @description Pure, deterministic state evaluation and deduplication engine for `dot` Mission Control.
 * Enforces strict separation between:
 * 1) Project completion & acceptance verification (all required milestones & gates + valid verified evidence)
 * 2) Worker execution liveness vs meaningful progress vs coverage uncertainty
 * 3) Operator approval / decision state (confirmed failures vs missing info)
 * 4) Telemetry connection health vs data freshness
 */

import {
  ActivityEvent,
  ApprovalState,
  DecisionRequest,
  EvaluatedWorkerState,
  MissionControlSnapshot,
  ProjectRecord,
  SourceAttribution,
  WorkerRecord,
} from '../schema/contract';
import { evaluateTimestamp } from '../utils/timeFormat';

export interface EvaluatedWorker extends WorkerRecord {
  evaluatedState: EvaluatedWorkerState;
  isConfirmedAlive: boolean;
  isMakingProgress: boolean;
  isExecutionUnknown: boolean;
  heartbeatAgeSeconds: number | null;
  progressAgeSeconds: number | null;
  timestampWarning?: string;
  statusExplanation: string;
}

export interface ProjectWorkerSummary {
  coverageKnown: boolean;
  hasUncertainWorkerCount: boolean;
  /**
   * Confirmed running/alive workers (includes both actively progressing and alive-but-stalled).
   * Null when project-level worker coverage is unknown and zero workers are confirmed.
   */
  confirmedRunningCount: number | null;
  /**
   * Subset of confirmedRunningCount that also have fresh meaningful progress (`active_running`).
   */
  confirmedProgressingCount: number | null;
  /**
   * Backwards-compatible alias for confirmedProgressingCount when coverage is known and no workers are unknown,
   * or null when coverage is unknown.
   */
  activeRunningCount: number | null;
  /**
   * Workers that are confirmed alive (fresh heartbeat) but have stalled progress.
   */
  stalledProgressCount: number;
  /**
   * Workers whose current execution state cannot be confirmed (expired heartbeat without authoritative stop proof,
   * invalid/future timestamp, or coverageAvailable=false).
   */
  unknownExecutionCount: number;
  /**
   * Alias preserved for tests checking expired heartbeats specifically.
   */
  staleHeartbeatCount: number;
  crashedOrFailedCount: number;
  idleOrQueuedCount: number;
  disconnectedCount: number;
  workers: EvaluatedWorker[];
}

export type ProjectOverviewBucket =
  | 'working_now'
  | 'blocked'
  | 'waiting_for_me'
  | 'unfinished'
  | 'recently_verified_complete';

export interface EvaluatedProject {
  project: ProjectRecord;
  buckets: ProjectOverviewBucket[];
  primaryStatusLabel: string;
  primaryStatusTone: 'active' | 'warning' | 'danger' | 'neutral' | 'verified';
  workerSummary: ProjectWorkerSummary;
  approvalState: ApprovalState;
  openDecisionsForMe: DecisionRequest[];
  allOpenDecisions: DecisionRequest[];
  remainingMilestoneCount: number;
  remainingRequiredMilestoneCount: number;
  totalMilestoneCount: number;
  remainingStepCount: number;
  passedGateCount: number;
  failedGateCount: number;
  failedRequiredGateCount: number;
  failedOptionalGateCount: number;
  pendingGateCount: number;
  pendingRequiredGateCount: number;
  skippedRequiredGateCount: number;
  lastVerifiedUpdateAt: string | null;
  executionFinishedButAcceptanceFailed: boolean;
  inconsistentCompletionClaim: boolean;
  completionContradictionReason: string | null;
  telemetryUncertain: boolean;
}

export interface DeduplicationResult {
  snapshot: MissionControlSnapshot;
  droppedDuplicates: {
    events: number;
    workers: number;
    tasks: number;
    runs: number;
    decisions: number;
    evidence: number;
  };
  totalDropped: number;
}

/**
 * Compares two `SourceAttribution` records to decide whether `incoming` is newer than `existing`.
 * 1) If both share the same `emitterName` and both define numeric `sequence`, higher `sequence` wins.
 * 2) Otherwise, newer valid `observedAt` timestamp wins.
 */
function isIncomingSourceNewer(
  incoming: SourceAttribution,
  existing: SourceAttribution
): boolean {
  if (
    incoming.emitterName &&
    incoming.emitterName === existing.emitterName &&
    typeof incoming.sequence === 'number' &&
    typeof existing.sequence === 'number' &&
    incoming.sequence !== existing.sequence
  ) {
    return incoming.sequence > existing.sequence;
  }

  const incomingMs = Date.parse(incoming.observedAt);
  const existingMs = Date.parse(existing.observedAt);
  if (!Number.isNaN(incomingMs) && (Number.isNaN(existingMs) || incomingMs > existingMs)) {
    return true;
  }
  return false;
}

/**
 * Deduplicates entities in a snapshot by both primary ID and `source.sourceId`,
 * applying explicit per-source sequence ordering (`source.sequence` within `source.emitterName`,
 * then `source.observedAt`).
 */
export function deduplicateSnapshot(raw: MissionControlSnapshot): DeduplicationResult {
  const dedupeByKey = <T>(
    items: T[],
    getId: (item: T) => string,
    getSource: (item: T) => SourceAttribution
  ): { list: T[]; dropped: number } => {
    const byPrimary = new Map<string, T>();
    const primaryBySourceId = new Map<string, string>();
    let dropped = 0;

    for (const item of items) {
      const id = getId(item);
      const src = getSource(item);
      const sourceId = src?.sourceId;

      if (byPrimary.has(id)) {
        dropped += 1;
        const existing = byPrimary.get(id)!;
        if (isIncomingSourceNewer(src, getSource(existing))) {
          byPrimary.set(id, item);
          if (sourceId) {
            primaryBySourceId.set(sourceId, id);
          }
        }
        continue;
      }

      if (sourceId && primaryBySourceId.has(sourceId)) {
        dropped += 1;
        const existingPrimaryId = primaryBySourceId.get(sourceId)!;
        const existing = byPrimary.get(existingPrimaryId);
        if (existing && isIncomingSourceNewer(src, getSource(existing))) {
          byPrimary.delete(existingPrimaryId);
          byPrimary.set(id, item);
          primaryBySourceId.set(sourceId, id);
        }
        continue;
      }

      byPrimary.set(id, item);
      if (sourceId) {
        primaryBySourceId.set(sourceId, id);
      }
    }

    return { list: Array.from(byPrimary.values()), dropped };
  };

  const eventsRes = dedupeByKey<ActivityEvent>(
    raw.events,
    (e) => e.eventId,
    (e) => e.source
  );
  const workersRes = dedupeByKey<WorkerRecord>(
    raw.workers,
    (w) => w.workerId,
    (w) => w.source
  );
  const tasksRes = dedupeByKey(
    raw.tasks,
    (t) => t.taskId,
    (t) => t.source
  );
  const runsRes = dedupeByKey(
    raw.runs,
    (r) => r.runId,
    (r) => r.source
  );
  const decisionsRes = dedupeByKey(
    raw.decisions,
    (d) => d.decisionId,
    (d) => d.source
  );
  const evidenceRes = dedupeByKey(
    raw.evidence,
    (ev) => ev.evidenceId,
    (ev) => ev.source
  );

  // Explicit deterministic event ordering:
  // 1) Event timestamp descending
  // 2) Per-source sequence descending when from same emitter
  // 3) Source observedAt descending
  // 4) eventId lexical tie-breaker
  const sortedEvents = [...eventsRes.list].sort((a, b) => {
    const aMs = Date.parse(a.timestamp);
    const bMs = Date.parse(b.timestamp);
    if (!Number.isNaN(aMs) && !Number.isNaN(bMs) && aMs !== bMs) {
      return bMs - aMs;
    }
    if (Number.isNaN(aMs) && !Number.isNaN(bMs)) return 1;
    if (!Number.isNaN(aMs) && Number.isNaN(bMs)) return -1;

    if (
      a.source?.emitterName &&
      a.source.emitterName === b.source?.emitterName &&
      typeof a.source.sequence === 'number' &&
      typeof b.source.sequence === 'number' &&
      a.source.sequence !== b.source.sequence
    ) {
      return b.source.sequence - a.source.sequence;
    }

    const aObs = Date.parse(a.source?.observedAt ?? '');
    const bObs = Date.parse(b.source?.observedAt ?? '');
    if (!Number.isNaN(aObs) && !Number.isNaN(bObs) && aObs !== bObs) {
      return bObs - aObs;
    }

    return a.eventId.localeCompare(b.eventId);
  });

  const droppedDuplicates = {
    events: eventsRes.dropped,
    workers: workersRes.dropped,
    tasks: tasksRes.dropped,
    runs: runsRes.dropped,
    decisions: decisionsRes.dropped,
    evidence: evidenceRes.dropped,
  };

  const totalDropped =
    droppedDuplicates.events +
    droppedDuplicates.workers +
    droppedDuplicates.tasks +
    droppedDuplicates.runs +
    droppedDuplicates.decisions +
    droppedDuplicates.evidence;

  return {
    snapshot: {
      ...raw,
      events: sortedEvents,
      workers: workersRes.list,
      tasks: tasksRes.list,
      runs: runsRes.list,
      decisions: decisionsRes.list,
      evidence: evidenceRes.list,
    },
    droppedDuplicates,
    totalDropped,
  };
}

/**
 * Evaluates a single worker record against `nowIso` and thresholds.
 * Enforces:
 * - Invalid or implausibly future timestamps are treated as UNCERTAIN, never fresh.
 * - Expired heartbeat without authoritative stop proof makes execution UNKNOWN (`unknown_expired_heartbeat`).
 * - Fresh heartbeat with stale/missing progress is alive/running with stalled progress (`stalled_progress`).
 */
export function evaluateWorker(
  worker: WorkerRecord,
  nowIso: string,
  thresholds: { heartbeatExpirySeconds: number; stalledProgressSeconds: number }
): EvaluatedWorker {
  const hbEval = evaluateTimestamp(worker.lastHeartbeatAt, nowIso);
  const progEval = evaluateTimestamp(worker.lastMeaningfulProgressAt, nowIso);

  const heartbeatAgeSeconds = hbEval.valid ? hbEval.ageSeconds : null;
  const progressAgeSeconds = progEval.valid ? progEval.ageSeconds : null;

  const warnings: string[] = [];
  if (worker.lastHeartbeatAt && !hbEval.valid) {
    warnings.push(`Heartbeat timestamp uncertain: ${hbEval.reason}`);
  }
  if (worker.lastMeaningfulProgressAt && !progEval.valid) {
    warnings.push(`Progress timestamp uncertain: ${progEval.reason}`);
  }
  const timestampWarning = warnings.length > 0 ? warnings.join(' · ') : undefined;

  if (!worker.coverageAvailable || worker.rawStatus === 'unknown') {
    return {
      ...worker,
      evaluatedState: 'unknown',
      isConfirmedAlive: false,
      isMakingProgress: false,
      isExecutionUnknown: true,
      heartbeatAgeSeconds,
      progressAgeSeconds,
      timestampWarning,
      statusExplanation: 'Worker execution telemetry coverage is unavailable.',
    };
  }

  if (worker.rawStatus === 'disconnected') {
    return {
      ...worker,
      evaluatedState: 'disconnected',
      isConfirmedAlive: false,
      isMakingProgress: false,
      isExecutionUnknown: true,
      heartbeatAgeSeconds,
      progressAgeSeconds,
      timestampWarning,
      statusExplanation:
        'Worker daemon disconnected from local supervisor; current state unconfirmed.',
    };
  }

  if (worker.rawStatus === 'crashed') {
    return {
      ...worker,
      evaluatedState: 'crashed',
      isConfirmedAlive: false,
      isMakingProgress: false,
      isExecutionUnknown: false,
      heartbeatAgeSeconds,
      progressAgeSeconds,
      timestampWarning,
      statusExplanation: worker.exitReason
        ? `Confirmed crash: ${worker.exitReason}`
        : 'Worker process terminated abnormally.',
    };
  }

  if (worker.rawStatus === 'failed') {
    return {
      ...worker,
      evaluatedState: 'failed',
      isConfirmedAlive: false,
      isMakingProgress: false,
      isExecutionUnknown: false,
      heartbeatAgeSeconds,
      progressAgeSeconds,
      timestampWarning,
      statusExplanation: worker.exitReason
        ? `Confirmed run failure: ${worker.exitReason}`
        : 'Worker stopped after unrecovered task error.',
    };
  }

  if (worker.rawStatus === 'stopped') {
    return {
      ...worker,
      evaluatedState: 'stopped',
      isConfirmedAlive: false,
      isMakingProgress: false,
      isExecutionUnknown: false,
      heartbeatAgeSeconds,
      progressAgeSeconds,
      timestampWarning,
      statusExplanation: worker.authoritativeStopProof
        ? `Stopped cleanly (${worker.authoritativeStopProof}).`
        : 'Worker stopped cleanly.',
    };
  }

  if (worker.rawStatus === 'queued') {
    return {
      ...worker,
      evaluatedState: 'queued',
      isConfirmedAlive: false,
      isMakingProgress: false,
      isExecutionUnknown: false,
      heartbeatAgeSeconds,
      progressAgeSeconds,
      timestampWarning,
      statusExplanation: 'Queued in dispatcher; no worker process is executing yet.',
    };
  }

  if (worker.rawStatus === 'idle') {
    return {
      ...worker,
      evaluatedState: 'idle',
      isConfirmedAlive: false,
      isMakingProgress: false,
      isExecutionUnknown: false,
      heartbeatAgeSeconds,
      progressAgeSeconds,
      timestampWarning,
      statusExplanation: 'Session idle; waiting for task assignment.',
    };
  }

  // worker.rawStatus === 'running'
  // Check if authoritative stop proof was attached despite rawStatus='running'
  if (worker.authoritativeStopProof) {
    return {
      ...worker,
      evaluatedState: 'stopped',
      isConfirmedAlive: false,
      isMakingProgress: false,
      isExecutionUnknown: false,
      heartbeatAgeSeconds,
      progressAgeSeconds,
      timestampWarning,
      statusExplanation: `Authoritative stop recorded: ${worker.authoritativeStopProof}`,
    };
  }

  // If heartbeat timestamp is missing, invalid, future-skewed, or expired -> execution is UNKNOWN
  if (
    !hbEval.valid ||
    heartbeatAgeSeconds === null ||
    heartbeatAgeSeconds > thresholds.heartbeatExpirySeconds
  ) {
    const reason = !hbEval.valid
      ? `Heartbeat timestamp invalid/future (${hbEval.reason}). Current execution is unknown.`
      : `Heartbeat expired (${heartbeatAgeSeconds}s ago > ${thresholds.heartbeatExpirySeconds}s limit). Execution is unknown without authoritative stop evidence.`;

    return {
      ...worker,
      evaluatedState: 'unknown_expired_heartbeat',
      isConfirmedAlive: false,
      isMakingProgress: false,
      isExecutionUnknown: true,
      heartbeatAgeSeconds,
      progressAgeSeconds,
      timestampWarning,
      statusExplanation: reason,
    };
  }

  // Worker has a fresh valid heartbeat -> It IS confirmed alive/running!
  // Now check whether meaningful progress is also fresh and valid.
  if (
    !progEval.valid ||
    progressAgeSeconds === null ||
    progressAgeSeconds > thresholds.stalledProgressSeconds
  ) {
    const progDetail =
      !progEval.valid || progressAgeSeconds === null
        ? `no valid progress timestamp (${progEval.reason})`
        : `no meaningful progress for ${Math.floor(
            progressAgeSeconds / 60
          )}m (threshold ${Math.floor(thresholds.stalledProgressSeconds / 60)}m)`;

    return {
      ...worker,
      evaluatedState: 'stalled_progress',
      isConfirmedAlive: true,
      isMakingProgress: false,
      isExecutionUnknown: false,
      heartbeatAgeSeconds,
      progressAgeSeconds,
      timestampWarning,
      statusExplanation: `Alive & running (heartbeat ${heartbeatAgeSeconds}s ago), but stalled with ${progDetail}.`,
    };
  }

  return {
    ...worker,
    evaluatedState: 'active_running',
    isConfirmedAlive: true,
    isMakingProgress: true,
    isExecutionUnknown: false,
    heartbeatAgeSeconds,
    progressAgeSeconds,
    timestampWarning,
    statusExplanation: `Confirmed running with fresh heartbeat (${heartbeatAgeSeconds}s ago) and verified progress (${progressAgeSeconds}s ago).`,
  };
}

/**
 * Evaluates a project record and its associated workers, runs, decisions, milestones, and evidence.
 */
export function evaluateProject(
  project: ProjectRecord,
  snapshot: MissionControlSnapshot,
  nowIso: string
): EvaluatedProject {
  const projectWorkers = snapshot.workers
    .filter((w) => w.projectId === project.projectId)
    .map((w) => evaluateWorker(w, nowIso, snapshot.evaluationThresholds));

  const confirmedProgressing = projectWorkers.filter(
    (w) => w.evaluatedState === 'active_running'
  ).length;
  const stalledProgressCount = projectWorkers.filter(
    (w) => w.evaluatedState === 'stalled_progress'
  ).length;
  const confirmedAlive = projectWorkers.filter((w) => w.isConfirmedAlive).length;

  const staleHeartbeatCount = projectWorkers.filter(
    (w) => w.evaluatedState === 'unknown_expired_heartbeat'
  ).length;
  const unknownExecutionCount = projectWorkers.filter((w) => w.isExecutionUnknown).length;

  const crashedOrFailedCount = projectWorkers.filter(
    (w) => w.evaluatedState === 'crashed' || w.evaluatedState === 'failed'
  ).length;
  const idleOrQueuedCount = projectWorkers.filter(
    (w) =>
      w.evaluatedState === 'idle' ||
      w.evaluatedState === 'queued' ||
      w.evaluatedState === 'stopped'
  ).length;
  const disconnectedCount = projectWorkers.filter(
    (w) => w.evaluatedState === 'disconnected'
  ).length;

  const hasUncertainWorkerCount =
    !project.workerCoverageKnown || unknownExecutionCount > 0;

  // Never represent an uncertain total as zero when coverage is unknown
  const confirmedRunningCount =
    !project.workerCoverageKnown && confirmedAlive === 0 ? null : confirmedAlive;
  const confirmedProgressingCount =
    !project.workerCoverageKnown && confirmedProgressing === 0
      ? null
      : confirmedProgressing;

  const workerSummary: ProjectWorkerSummary = {
    coverageKnown: project.workerCoverageKnown,
    hasUncertainWorkerCount,
    confirmedRunningCount,
    confirmedProgressingCount,
    activeRunningCount: confirmedProgressingCount,
    stalledProgressCount,
    unknownExecutionCount,
    staleHeartbeatCount,
    crashedOrFailedCount,
    idleOrQueuedCount,
    disconnectedCount,
    workers: projectWorkers,
  };

  const allOpenDecisions = snapshot.decisions.filter(
    (d) => d.projectId === project.projectId && d.status === 'open'
  );
  const openDecisionsForMe = allOpenDecisions.filter((d) => {
    const ownerNorm = typeof d.owner === 'string' ? d.owner.trim().toLowerCase() : '';
    return ownerNorm === 'you' || ownerNorm === 'operator';
  });

  const approvalState: ApprovalState =
    openDecisionsForMe.length > 0 ? 'waiting_for_me' : 'none_required';

  // Milestone & Acceptance Gate verification
  const totalMilestoneCount = project.milestones.length;
  const requiredMilestones = project.milestones.filter((m) => m.required !== false);
  const remainingMilestones = project.milestones.filter(
    (m) => m.status !== 'completed_verified' || m.remainingSteps.length > 0
  );
  const remainingRequiredMilestones = requiredMilestones.filter(
    (m) => m.status !== 'completed_verified' || m.remainingSteps.length > 0
  );

  const remainingMilestoneCount = remainingMilestones.length;
  const remainingRequiredMilestoneCount = remainingRequiredMilestones.length;
  const remainingStepCount = project.milestones.reduce(
    (acc, m) => acc + m.remainingSteps.length,
    0
  );

  const requiredStepCount = requiredMilestones.reduce(
    (acc, m) => acc + m.remainingSteps.length,
    0
  );

  let passedGateCount = 0;
  let failedGateCount = 0;
  let failedRequiredGateCount = 0;
  let failedOptionalGateCount = 0;
  let pendingGateCount = 0;
  let pendingRequiredGateCount = 0;
  let skippedRequiredGateCount = 0;
  let totalRequiredGateCount = 0;
  const milestonesMissingRequiredGates: string[] = [];
  const evidenceOrGateProblems: string[] = [];

  const projectEvidenceMap = new Map(
    snapshot.evidence
      .filter((ev) => ev.projectId === project.projectId)
      .map((ev) => [ev.evidenceId, ev])
  );

  // Check if latestUsefulResult points to a missing, unverified, or invalid-timestamp evidence item
  if (project.latestUsefulResult?.evidenceId) {
    const linkedEv = projectEvidenceMap.get(project.latestUsefulResult.evidenceId);
    if (!linkedEv) {
      evidenceOrGateProblems.push(
        `Latest result references missing evidence "${project.latestUsefulResult.evidenceId}".`
      );
    } else if (linkedEv.verified !== true) {
      evidenceOrGateProblems.push(
        `Latest result evidence "${linkedEv.evidenceId}" is marked unverified.`
      );
    } else if (
      !evaluateTimestamp(linkedEv.createdAt, nowIso).valid ||
      !evaluateTimestamp(linkedEv.source?.observedAt, nowIso).valid
    ) {
      evidenceOrGateProblems.push(
        `Latest result evidence "${linkedEv.evidenceId}" has an invalid or future timestamp.`
      );
    }
  }

  for (const m of project.milestones) {
    const isMilestoneRequired = m.required !== false;
    const requiredGatesInMilestone = m.acceptanceGates.filter((g) => g.required === true);

    if (isMilestoneRequired && requiredGatesInMilestone.length === 0) {
      milestonesMissingRequiredGates.push(m.title || m.milestoneId);
    }

    for (const g of m.acceptanceGates) {
      const isGateRequired = isMilestoneRequired && g.required === true;
      if (isGateRequired) {
        totalRequiredGateCount += 1;
      }

      if (g.status === 'passed') {
        passedGateCount += 1;
        if (isGateRequired) {
          // 1) Required gate must have a valid, non-future verifiedAt timestamp
          const vTime = evaluateTimestamp(g.verifiedAt, nowIso);
          if (!vTime.valid) {
            evidenceOrGateProblems.push(
              `Required gate "${g.label}" has missing or invalid verifiedAt timestamp (${vTime.reason}).`
            );
          }

          // 2) Required gate MUST reference an existing, verified evidence record with valid timestamps
          if (typeof g.evidenceId !== 'string' || g.evidenceId.trim().length === 0) {
            evidenceOrGateProblems.push(
              `Required gate "${g.label}" does not reference any evidenceId.`
            );
          } else {
            const ev = projectEvidenceMap.get(g.evidenceId);
            if (!ev) {
              evidenceOrGateProblems.push(
                `Required gate "${g.label}" references missing evidence "${g.evidenceId}".`
              );
            } else if (ev.verified !== true) {
              evidenceOrGateProblems.push(
                `Required gate "${g.label}" references unverified evidence "${g.evidenceId}".`
              );
            } else {
              const evCreatedEval = evaluateTimestamp(ev.createdAt, nowIso);
              const evObservedEval = evaluateTimestamp(ev.source?.observedAt, nowIso);
              if (!evCreatedEval.valid) {
                evidenceOrGateProblems.push(
                  `Required gate "${g.label}" evidence "${g.evidenceId}" has invalid createdAt (${evCreatedEval.reason}).`
                );
              } else if (!evObservedEval.valid) {
                evidenceOrGateProblems.push(
                  `Required gate "${g.label}" evidence "${g.evidenceId}" has invalid source.observedAt (${evObservedEval.reason}).`
                );
              }
            }
          }
        }
      } else if (g.status === 'failed') {
        failedGateCount += 1;
        if (isGateRequired) {
          failedRequiredGateCount += 1;
        } else {
          failedOptionalGateCount += 1;
        }
      } else if (g.status === 'pending') {
        pendingGateCount += 1;
        if (isGateRequired) {
          pendingRequiredGateCount += 1;
        }
      } else if (g.status === 'skipped') {
        if (isGateRequired) {
          skippedRequiredGateCount += 1;
        }
      }
    }
  }

  const missingOrContradictoryEvidenceReason =
    evidenceOrGateProblems.length > 0 ? evidenceOrGateProblems[0] : null;

  // Check if a worker run finished its turn, but required acceptance failed
  const projectRuns = snapshot.runs.filter((r) => r.projectId === project.projectId);
  const hasSucceededTurn = projectRuns.some((r) => r.status === 'succeeded_turn');
  const executionFinishedButAcceptanceFailed =
    hasSucceededTurn &&
    (project.acceptanceStatus === 'failed_gates' || failedRequiredGateCount > 0);

  // Strict Verified Complete rules:
  // 1) acceptanceStatus === 'verified_passed'
  // 2) At least 1 required milestone exists, and EVERY required milestone has >= 1 required acceptance gate
  // 3) 0 remaining required milestones and 0 remaining required steps
  // 4) 0 failed, pending, or skipped required gates
  // 5) Every required gate references existing, verified evidence with valid non-future timestamps
  // 6) No active blocker or open decision, and 0 crashed/failed/stalled workers
  const strictCompletionReasons: string[] = [];
  if (requiredMilestones.length === 0) {
    strictCompletionReasons.push('No required milestones defined.');
  }
  if (milestonesMissingRequiredGates.length > 0) {
    strictCompletionReasons.push(
      `Required milestone(s) missing required acceptance gates: ${milestonesMissingRequiredGates.join(
        ', '
      )}.`
    );
  }
  if (remainingRequiredMilestoneCount > 0) {
    strictCompletionReasons.push(
      `${remainingRequiredMilestoneCount} required milestone(s) not completed.`
    );
  }
  if (requiredStepCount > 0) {
    strictCompletionReasons.push(`${requiredStepCount} required step(s) still remaining.`);
  }
  if (totalRequiredGateCount === 0) {
    strictCompletionReasons.push('No required acceptance gates verified.');
  }
  if (failedRequiredGateCount > 0) {
    strictCompletionReasons.push(`${failedRequiredGateCount} required gate(s) failed.`);
  }
  if (pendingRequiredGateCount > 0) {
    strictCompletionReasons.push(`${pendingRequiredGateCount} required gate(s) still pending.`);
  }
  if (skippedRequiredGateCount > 0) {
    strictCompletionReasons.push(`${skippedRequiredGateCount} required gate(s) skipped.`);
  }
  if (missingOrContradictoryEvidenceReason) {
    strictCompletionReasons.push(missingOrContradictoryEvidenceReason);
  }
  if (project.blocker !== null) {
    strictCompletionReasons.push('Project still has an active blocker record.');
  }
  if (allOpenDecisions.length > 0) {
    strictCompletionReasons.push(`${allOpenDecisions.length} unresolved decision(s) remain open.`);
  }
  if (crashedOrFailedCount > 0) {
    strictCompletionReasons.push(`${crashedOrFailedCount} worker(s) crashed or failed.`);
  }
  if (stalledProgressCount > 0) {
    strictCompletionReasons.push(`${stalledProgressCount} worker(s) have stalled progress.`);
  }

  const isVerifiedComplete =
    project.acceptanceStatus === 'verified_passed' && strictCompletionReasons.length === 0;

  const inconsistentCompletionClaim =
    project.acceptanceStatus === 'verified_passed' && strictCompletionReasons.length > 0;
  const completionContradictionReason = inconsistentCompletionClaim
    ? `Claimed verified_passed, but cannot verify completion: ${strictCompletionReasons.join(' ')}`
    : null;

  // Missing telemetry alone is NOT proof a project is stalled or blocked!
  const telemetryUncertain = !project.workerCoverageKnown || unknownExecutionCount > 0;

  // Determine Overview Buckets
  const buckets: ProjectOverviewBucket[] = [];

  // A project is Working Now if it has at least 1 confirmed alive/running worker (either actively progressing or alive-with-stalled-progress)
  if (confirmedRunningCount !== null && confirmedRunningCount > 0) {
    buckets.push('working_now');
  }

  if (openDecisionsForMe.length > 0) {
    buckets.push('waiting_for_me');
  }

  // Blocked requires an explicit blocker, confirmed crash/failure, stalled progress, failed required gate, open decision, or contradicted completion claim.
  // Note: Missing telemetry / expired heartbeat alone (`telemetryUncertain`) does NOT invent a "stalled" or "blocked" state unless accompanied by an explicit blocker!
  const isBlocked =
    project.blocker !== null ||
    crashedOrFailedCount > 0 ||
    stalledProgressCount > 0 ||
    failedRequiredGateCount > 0 ||
    openDecisionsForMe.length > 0 ||
    inconsistentCompletionClaim;

  if (isBlocked && !isVerifiedComplete) {
    buckets.push('blocked');
  }

  if (isVerifiedComplete) {
    buckets.push('recently_verified_complete');
  } else {
    buckets.push('unfinished');
  }

  // Last verified update timestamp (only from valid non-future meaningful progress events or latestUsefulResult)
  const validMeaningfulEvents = snapshot.events.filter(
    (e) =>
      e.projectId === project.projectId &&
      e.isMeaningfulProgress &&
      evaluateTimestamp(e.timestamp, nowIso).valid
  );
  const latestEventIso =
    validMeaningfulEvents.length > 0 ? validMeaningfulEvents[0].timestamp : null;

  const latestResultIso =
    project.latestUsefulResult?.observedAt &&
    evaluateTimestamp(project.latestUsefulResult.observedAt, nowIso).valid
      ? project.latestUsefulResult.observedAt
      : null;

  let lastVerifiedUpdateAt: string | null = latestEventIso;
  if (
    latestResultIso &&
    (!lastVerifiedUpdateAt || Date.parse(latestResultIso) > Date.parse(lastVerifiedUpdateAt))
  ) {
    lastVerifiedUpdateAt = latestResultIso;
  }

  // Primary status label & tone (Red strictly for confirmed failure; Amber for warnings / decisions / uncertainty)
  let primaryStatusLabel = 'Unfinished · Idle';
  let primaryStatusTone: EvaluatedProject['primaryStatusTone'] = 'neutral';

  if (isVerifiedComplete) {
    primaryStatusLabel =
      failedOptionalGateCount > 0
        ? `Verified Complete (${failedOptionalGateCount} optional warning)`
        : 'Verified Complete';
    primaryStatusTone = 'verified';
  } else if (inconsistentCompletionClaim) {
    primaryStatusLabel = 'Completion Contradicted · Unverified Gates';
    primaryStatusTone = 'warning';
  } else if (executionFinishedButAcceptanceFailed) {
    primaryStatusLabel = 'Turn Finished · Acceptance Gate Failed';
    primaryStatusTone = 'danger';
  } else if (crashedOrFailedCount > 0) {
    primaryStatusLabel = 'Confirmed Failure · Worker Crashed';
    primaryStatusTone = 'danger';
  } else if (failedRequiredGateCount > 0) {
    primaryStatusLabel = 'Confirmed Failure · Gate Failed';
    primaryStatusTone = 'danger';
  } else if (openDecisionsForMe.length > 0) {
    primaryStatusLabel = 'Needs You · Decision Pending';
    primaryStatusTone = 'warning';
  } else if (stalledProgressCount > 0) {
    primaryStatusLabel = 'Running (Alive) · Progress Stalled';
    primaryStatusTone = 'warning';
  } else if (staleHeartbeatCount > 0) {
    primaryStatusLabel = 'Execution Unknown · Heartbeat Expired';
    primaryStatusTone = 'warning';
  } else if (project.blocker) {
    primaryStatusLabel = project.blocker.isConfirmedFailure
      ? 'Blocked · Confirmed Failure'
      : 'Blocked · Awaiting Action';
    primaryStatusTone = project.blocker.isConfirmedFailure ? 'danger' : 'warning';
  } else if (confirmedProgressingCount !== null && confirmedProgressingCount > 0) {
    primaryStatusLabel = 'Running · Verified Progress';
    primaryStatusTone = 'active';
  } else if (!project.workerCoverageKnown) {
    primaryStatusLabel = 'Unfinished · Coverage Unknown';
    primaryStatusTone = 'neutral';
  } else if (idleOrQueuedCount > 0) {
    primaryStatusLabel = 'Unfinished · Idle / Queued';
    primaryStatusTone = 'neutral';
  }

  return {
    project,
    buckets,
    primaryStatusLabel,
    primaryStatusTone,
    workerSummary,
    approvalState,
    openDecisionsForMe,
    allOpenDecisions,
    remainingMilestoneCount,
    remainingRequiredMilestoneCount,
    totalMilestoneCount,
    remainingStepCount,
    passedGateCount,
    failedGateCount,
    failedRequiredGateCount,
    failedOptionalGateCount,
    pendingGateCount,
    pendingRequiredGateCount,
    skippedRequiredGateCount,
    lastVerifiedUpdateAt,
    executionFinishedButAcceptanceFailed,
    inconsistentCompletionClaim,
    completionContradictionReason,
    telemetryUncertain,
  };
}

export function evaluateAllProjects(
  snapshot: MissionControlSnapshot,
  nowIso: string
): EvaluatedProject[] {
  return snapshot.projects.map((p) => evaluateProject(p, snapshot, nowIso));
}
