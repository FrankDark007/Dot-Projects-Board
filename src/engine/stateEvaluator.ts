/**
 * @file src/engine/stateEvaluator.ts
 * @description Pure, deterministic state evaluation and deduplication engine for `dot` Mission Control.
 * Enforces strict separation between:
 * 1) Project completion & acceptance verification
 * 2) Worker execution liveness vs meaningful progress
 * 3) Operator approval / decision state
 * 4) Telemetry connection health
 */

import {
  ActivityEvent,
  ApprovalState,
  DecisionRequest,
  EvaluatedWorkerState,
  MissionControlSnapshot,
  ProjectRecord,
  WorkerRecord,
} from '../schema/contract';

export interface EvaluatedWorker extends WorkerRecord {
  evaluatedState: EvaluatedWorkerState;
  heartbeatAgeSeconds: number | null;
  progressAgeSeconds: number | null;
  statusExplanation: string;
}

export interface ProjectWorkerSummary {
  coverageKnown: boolean;
  activeRunningCount: number | null; // Null when coverage is unknown
  stalledProgressCount: number;
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
  totalMilestoneCount: number;
  remainingStepCount: number;
  passedGateCount: number;
  failedGateCount: number;
  pendingGateCount: number;
  lastVerifiedUpdateAt: string | null;
  executionFinishedButAcceptanceFailed: boolean;
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
 * Deduplicates all entities in a snapshot by both their primary stable ID and `source.sourceId`.
 * When duplicate IDs exist, preserves the record with the newer `source.observedAt` timestamp.
 */
export function deduplicateSnapshot(raw: MissionControlSnapshot): DeduplicationResult {
  const dedupeByKey = <T>(
    items: T[],
    getId: (item: T) => string,
    getSourceId: (item: T) => string,
    getObservedAt: (item: T) => string
  ): { list: T[]; dropped: number } => {
    const byPrimary = new Map<string, T>();
    const seenSourceIds = new Set<string>();
    let dropped = 0;

    for (const item of items) {
      const id = getId(item);
      const sourceId = getSourceId(item);

      if (byPrimary.has(id)) {
        dropped += 1;
        const existing = byPrimary.get(id)!;
        if (Date.parse(getObservedAt(item)) > Date.parse(getObservedAt(existing))) {
          byPrimary.set(id, item);
        }
        continue;
      }

      if (sourceId && seenSourceIds.has(sourceId)) {
        dropped += 1;
        continue;
      }

      byPrimary.set(id, item);
      if (sourceId) {
        seenSourceIds.add(sourceId);
      }
    }

    return { list: Array.from(byPrimary.values()), dropped };
  };

  const eventsRes = dedupeByKey<ActivityEvent>(
    raw.events,
    (e) => e.eventId,
    (e) => e.source.sourceId,
    (e) => e.source.observedAt
  );
  const workersRes = dedupeByKey<WorkerRecord>(
    raw.workers,
    (w) => w.workerId,
    (w) => w.source.sourceId,
    (w) => w.source.observedAt
  );
  const tasksRes = dedupeByKey(
    raw.tasks,
    (t) => t.taskId,
    (t) => t.source.sourceId,
    (t) => t.source.observedAt
  );
  const runsRes = dedupeByKey(
    raw.runs,
    (r) => r.runId,
    (r) => r.source.sourceId,
    (r) => r.source.observedAt
  );
  const decisionsRes = dedupeByKey(
    raw.decisions,
    (d) => d.decisionId,
    (d) => d.source.sourceId,
    (d) => d.source.observedAt
  );
  const evidenceRes = dedupeByKey(
    raw.evidence,
    (ev) => ev.evidenceId,
    (ev) => ev.source.sourceId,
    (ev) => ev.source.observedAt
  );

  // Sort events newest-first deterministically
  const sortedEvents = [...eventsRes.list].sort(
    (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)
  );

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
 * Evaluates a single worker record against current reference time and thresholds.
 * Enforces:
 * - Heartbeat expiry -> `stale_heartbeat` (not counted as running)
 * - Fresh heartbeat without meaningful progress -> `stalled_progress` (heartbeats prove liveness, not progress)
 */
export function evaluateWorker(
  worker: WorkerRecord,
  nowIso: string,
  thresholds: { heartbeatExpirySeconds: number; stalledProgressSeconds: number }
): EvaluatedWorker {
  const nowMs = Date.parse(nowIso);
  const hbMs = worker.lastHeartbeatAt ? Date.parse(worker.lastHeartbeatAt) : null;
  const progMs = worker.lastMeaningfulProgressAt
    ? Date.parse(worker.lastMeaningfulProgressAt)
    : null;

  const heartbeatAgeSeconds =
    hbMs !== null && !Number.isNaN(hbMs) ? Math.max(0, Math.floor((nowMs - hbMs) / 1000)) : null;
  const progressAgeSeconds =
    progMs !== null && !Number.isNaN(progMs)
      ? Math.max(0, Math.floor((nowMs - progMs) / 1000))
      : null;

  if (!worker.coverageAvailable || worker.rawStatus === 'unknown') {
    return {
      ...worker,
      evaluatedState: 'unknown',
      heartbeatAgeSeconds,
      progressAgeSeconds,
      statusExplanation: 'Worker execution telemetry coverage is unavailable.',
    };
  }

  if (worker.rawStatus === 'disconnected') {
    return {
      ...worker,
      evaluatedState: 'disconnected',
      heartbeatAgeSeconds,
      progressAgeSeconds,
      statusExplanation: 'Worker daemon disconnected from local supervisor.',
    };
  }

  if (worker.rawStatus === 'crashed') {
    return {
      ...worker,
      evaluatedState: 'crashed',
      heartbeatAgeSeconds,
      progressAgeSeconds,
      statusExplanation: worker.exitReason
        ? `Process crashed: ${worker.exitReason}`
        : 'Worker process terminated unexpectedly.',
    };
  }

  if (worker.rawStatus === 'failed') {
    return {
      ...worker,
      evaluatedState: 'failed',
      heartbeatAgeSeconds,
      progressAgeSeconds,
      statusExplanation: worker.exitReason
        ? `Task run failed: ${worker.exitReason}`
        : 'Worker stopped after unrecovered task error.',
    };
  }

  if (worker.rawStatus === 'queued') {
    return {
      ...worker,
      evaluatedState: 'queued',
      heartbeatAgeSeconds,
      progressAgeSeconds,
      statusExplanation: 'Queued in dispatcher; no worker process is executing yet.',
    };
  }

  if (worker.rawStatus === 'idle') {
    return {
      ...worker,
      evaluatedState: 'idle',
      heartbeatAgeSeconds,
      progressAgeSeconds,
      statusExplanation: 'Session idle; waiting for task assignment.',
    };
  }

  // worker.rawStatus === 'running'
  if (
    heartbeatAgeSeconds === null ||
    heartbeatAgeSeconds > thresholds.heartbeatExpirySeconds
  ) {
    return {
      ...worker,
      evaluatedState: 'stale_heartbeat',
      heartbeatAgeSeconds,
      progressAgeSeconds,
      statusExplanation:
        heartbeatAgeSeconds === null
          ? 'Reported running, but no heartbeat timestamp was recorded.'
          : `Heartbeat expired (${heartbeatAgeSeconds}s ago > ${thresholds.heartbeatExpirySeconds}s threshold). Cannot verify process is still alive.`,
    };
  }

  if (
    progressAgeSeconds === null ||
    progressAgeSeconds > thresholds.stalledProgressSeconds
  ) {
    return {
      ...worker,
      evaluatedState: 'stalled_progress',
      heartbeatAgeSeconds,
      progressAgeSeconds,
      statusExplanation:
        progressAgeSeconds === null
          ? 'Heartbeat is fresh, but zero meaningful progress events have been recorded.'
          : `Process alive (heartbeat ${heartbeatAgeSeconds}s ago), but stalled with no meaningful progress for ${Math.floor(
              progressAgeSeconds / 60
            )}m (threshold ${Math.floor(thresholds.stalledProgressSeconds / 60)}m).`,
    };
  }

  return {
    ...worker,
    evaluatedState: 'active_running',
    heartbeatAgeSeconds,
    progressAgeSeconds,
    statusExplanation: `Actively executing with fresh heartbeat (${heartbeatAgeSeconds}s ago) and verified progress (${progressAgeSeconds}s ago).`,
  };
}

/**
 * Evaluates a project record and its associated workers, runs, decisions, and milestones.
 * Strictly separates completion, execution, and approval states.
 */
export function evaluateProject(
  project: ProjectRecord,
  snapshot: MissionControlSnapshot,
  nowIso: string
): EvaluatedProject {
  const projectWorkers = snapshot.workers
    .filter((w) => w.projectId === project.projectId)
    .map((w) => evaluateWorker(w, nowIso, snapshot.evaluationThresholds));

  const activeRunningCount = project.workerCoverageKnown
    ? projectWorkers.filter((w) => w.evaluatedState === 'active_running').length
    : null;

  const stalledProgressCount = projectWorkers.filter(
    (w) => w.evaluatedState === 'stalled_progress'
  ).length;
  const staleHeartbeatCount = projectWorkers.filter(
    (w) => w.evaluatedState === 'stale_heartbeat'
  ).length;
  const crashedOrFailedCount = projectWorkers.filter(
    (w) => w.evaluatedState === 'crashed' || w.evaluatedState === 'failed'
  ).length;
  const idleOrQueuedCount = projectWorkers.filter(
    (w) => w.evaluatedState === 'idle' || w.evaluatedState === 'queued'
  ).length;
  const disconnectedCount = projectWorkers.filter(
    (w) => w.evaluatedState === 'disconnected'
  ).length;

  const workerSummary: ProjectWorkerSummary = {
    coverageKnown: project.workerCoverageKnown,
    activeRunningCount,
    stalledProgressCount,
    staleHeartbeatCount,
    crashedOrFailedCount,
    idleOrQueuedCount,
    disconnectedCount,
    workers: projectWorkers,
  };

  const allOpenDecisions = snapshot.decisions.filter(
    (d) => d.projectId === project.projectId && d.status === 'open'
  );
  const openDecisionsForMe = allOpenDecisions.filter(
    (d) => d.owner.toLowerCase() === 'you' || d.owner.toLowerCase() === 'operator'
  );

  const approvalState: ApprovalState =
    openDecisionsForMe.length > 0 ? 'waiting_for_me' : 'none_required';

  // Milestone & Acceptance Gate tallies
  const totalMilestoneCount = project.milestones.length;
  const remainingMilestones = project.milestones.filter(
    (m) => m.status !== 'completed_verified'
  );
  const remainingMilestoneCount = remainingMilestones.length;
  const remainingStepCount = project.milestones.reduce(
    (acc, m) => acc + m.remainingSteps.length,
    0
  );

  let passedGateCount = 0;
  let failedGateCount = 0;
  let pendingGateCount = 0;

  for (const m of project.milestones) {
    for (const g of m.acceptanceGates) {
      if (g.status === 'passed') passedGateCount += 1;
      else if (g.status === 'failed') failedGateCount += 1;
      else if (g.status === 'pending') pendingGateCount += 1;
    }
  }

  // Check if a worker run finished its turn, but acceptance failed or is unverified
  const projectRuns = snapshot.runs.filter((r) => r.projectId === project.projectId);
  const hasSucceededTurn = projectRuns.some((r) => r.status === 'succeeded_turn');
  const executionFinishedButAcceptanceFailed =
    hasSucceededTurn &&
    (project.acceptanceStatus === 'failed_gates' || failedGateCount > 0);

  // Is project verified complete?
  // Requires acceptanceStatus === 'verified_passed', 0 remaining milestones, and 0 failed/pending required gates
  const isVerifiedComplete =
    project.acceptanceStatus === 'verified_passed' &&
    remainingMilestoneCount === 0 &&
    failedGateCount === 0;

  // Determine Overview Buckets (a project can belong to multiple truthful buckets, e.g., Blocked + Waiting For Me + Unfinished)
  const buckets: ProjectOverviewBucket[] = [];

  if (activeRunningCount !== null && activeRunningCount > 0) {
    buckets.push('working_now');
  }

  if (openDecisionsForMe.length > 0) {
    buckets.push('waiting_for_me');
  }

  const isBlocked =
    project.blocker !== null ||
    crashedOrFailedCount > 0 ||
    stalledProgressCount > 0 ||
    staleHeartbeatCount > 0 ||
    failedGateCount > 0 ||
    openDecisionsForMe.length > 0;

  if (isBlocked && !isVerifiedComplete) {
    buckets.push('blocked');
  }

  if (isVerifiedComplete) {
    buckets.push('recently_verified_complete');
  } else {
    buckets.push('unfinished');
  }

  // Last verified update timestamp (from meaningful progress events or latestUsefulResult, never raw heartbeats)
  const meaningfulEvents = snapshot.events.filter(
    (e) => e.projectId === project.projectId && e.isMeaningfulProgress
  );
  const latestEventIso =
    meaningfulEvents.length > 0 ? meaningfulEvents[0].timestamp : null;
  const latestResultIso = project.latestUsefulResult?.observedAt ?? null;

  let lastVerifiedUpdateAt: string | null = latestEventIso;
  if (
    latestResultIso &&
    (!lastVerifiedUpdateAt || Date.parse(latestResultIso) > Date.parse(lastVerifiedUpdateAt))
  ) {
    lastVerifiedUpdateAt = latestResultIso;
  }

  // Primary status label & tone
  let primaryStatusLabel = 'Unfinished · Idle';
  let primaryStatusTone: EvaluatedProject['primaryStatusTone'] = 'neutral';

  if (isVerifiedComplete) {
    primaryStatusLabel = 'Verified Complete';
    primaryStatusTone = 'verified';
  } else if (executionFinishedButAcceptanceFailed) {
    primaryStatusLabel = 'Turn Finished · Acceptance Failed';
    primaryStatusTone = 'danger';
  } else if (crashedOrFailedCount > 0) {
    primaryStatusLabel = 'Blocked · Worker Crashed';
    primaryStatusTone = 'danger';
  } else if (openDecisionsForMe.length > 0) {
    primaryStatusLabel = 'Waiting for You';
    primaryStatusTone = 'warning';
  } else if (stalledProgressCount > 0) {
    primaryStatusLabel = 'Stalled · Heartbeat Only (No Progress)';
    primaryStatusTone = 'warning';
  } else if (staleHeartbeatCount > 0) {
    primaryStatusLabel = 'Stale Heartbeat · Liveness Unverified';
    primaryStatusTone = 'warning';
  } else if (project.blocker) {
    primaryStatusLabel = 'Blocked';
    primaryStatusTone = 'danger';
  } else if (activeRunningCount !== null && activeRunningCount > 0) {
    primaryStatusLabel = 'Working Now';
    primaryStatusTone = 'active';
  } else if (!project.workerCoverageKnown) {
    primaryStatusLabel = 'Unfinished · Worker Coverage Unknown';
    primaryStatusTone = 'neutral';
  } else if (idleOrQueuedCount > 0) {
    primaryStatusLabel = 'Unfinished · Queued / Idle';
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
    totalMilestoneCount,
    remainingStepCount,
    passedGateCount,
    failedGateCount,
    pendingGateCount,
    lastVerifiedUpdateAt,
    executionFinishedButAcceptanceFailed,
  };
}

export function evaluateAllProjects(
  snapshot: MissionControlSnapshot,
  nowIso: string
): EvaluatedProject[] {
  return snapshot.projects.map((p) => evaluateProject(p, snapshot, nowIso));
}
