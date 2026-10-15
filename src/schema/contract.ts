/**
 * @file src/schema/contract.ts
 * @description Typed, versioned JSON integration contract for the `dot` Mission Control dashboard.
 * Keeps project completion, worker execution, approval state, and connection health strictly separate.
 */

export const CONTRACT_SCHEMA_VERSION = 'dot.mission-control.v1' as const;

export type SchemaVersion = typeof CONTRACT_SCHEMA_VERSION;

export type DataSourceKind =
  | 'local_orchestrator'
  | 'md_worker_daemon'
  | 'ci_verifier'
  | 'git_observer'
  | 'human_operator'
  | 'synthetic_demo';

export interface SourceAttribution {
  sourceId: string; // Stable deduplication ID from the emitting subsystem
  kind: DataSourceKind;
  emitterName: string; // e.g. "mac-studio-runner-01", "dot-supervisor"
  observedAt: string; // ISO-8601 timestamp when observation was recorded
}

/**
 * 1. Connection Health State (Independent of project or worker status)
 */
export type ConnectionHealthState =
  | 'demo_synthetic'
  | 'not_connected'
  | 'connected'
  | 'degraded_stale';

/**
 * 2. Worker Execution State
 * Derived strictly from fresh execution evidence.
 * - A heartbeat proves process liveness, NOT meaningful task progress.
 * - An open session, git commit, or queue label does NOT prove active execution.
 */
export type RawWorkerStatus =
  | 'running'
  | 'idle'
  | 'queued'
  | 'crashed'
  | 'failed'
  | 'disconnected'
  | 'unknown';

export type EvaluatedWorkerState =
  | 'active_running' // Fresh heartbeat AND fresh meaningful progress
  | 'stalled_progress' // Fresh heartbeat (alive), but no meaningful progress within threshold
  | 'stale_heartbeat' // Reported running, but heartbeat expired beyond threshold
  | 'idle' // Alive/registered, no assigned active run
  | 'queued' // Run queued, waiting for slot/worker
  | 'crashed' // Process terminated abnormally (exit code / signal)
  | 'failed' // Task run failed with explicit error
  | 'disconnected' // Telemetry source unreachable
  | 'unknown'; // Coverage unavailable

/**
 * 3. Approval & Decision State
 */
export type ApprovalState =
  | 'none_required'
  | 'waiting_for_me'
  | 'approved'
  | 'rejected';

/**
 * 4. Acceptance & Verification State
 * A finished agent turn or completed worker run NEVER implies project completion
 * unless acceptance gates pass.
 */
export type AcceptanceStatus =
  | 'not_run'
  | 'pending_review'
  | 'failed_gates'
  | 'verified_passed';

export type PriorityLevel = 'critical' | 'high' | 'normal' | 'low';

export type CostCoverageState = 'complete' | 'partial' | 'unavailable';

export interface CostTelemetry {
  coverage: CostCoverageState;
  knownUsd: number | null; // Null when unavailable; never invented
  isEstimate: boolean;
  untrackedSources: string[]; // Explicit list of workers/steps missing cost metering
  note?: string;
}

export interface AcceptanceGate {
  gateId: string;
  label: string;
  required: boolean;
  status: 'passed' | 'failed' | 'pending' | 'skipped';
  verifiedAt: string | null;
  verifierSource: string | null;
  details: string;
  evidenceId?: string;
}

export interface MilestoneNode {
  milestoneId: string;
  title: string;
  order: number;
  status: 'completed_verified' | 'in_progress' | 'blocked' | 'pending' | 'failed_acceptance';
  dependsOnMilestoneIds: string[];
  remainingSteps: string[];
  estimateLabel?: string; // Must be explicitly labeled as an estimate if present
  acceptanceGates: AcceptanceGate[];
}

export interface TaskItem {
  taskId: string;
  projectId: string;
  milestoneId: string;
  title: string;
  owner: string; // e.g., "dot", "dot/codex-worker-2", "you"
  status: 'running' | 'blocked' | 'waiting_decision' | 'queued' | 'done_unverified' | 'verified' | 'failed';
  assignedWorkerId: string | null;
  lastMeaningfulProgressAt: string | null;
  summary: string;
  source: SourceAttribution;
}

export interface WorkerRecord {
  workerId: string;
  projectId: string | null;
  name: string;
  role: string;
  hostLabel: string; // e.g., "local-adapter (unverified in AI Studio)" or synthetic fixture label
  rawStatus: RawWorkerStatus;
  currentRunId: string | null;
  currentTaskSummary: string | null;
  lastHeartbeatAt: string | null;
  lastMeaningfulProgressAt: string | null;
  lastProgressSummary: string | null;
  exitReason?: string;
  coverageAvailable: boolean;
  source: SourceAttribution;
}

export interface WorkerRunRecord {
  runId: string;
  workerId: string;
  projectId: string;
  milestoneId: string | null;
  startedAt: string;
  endedAt: string | null;
  lastHeartbeatAt: string;
  lastMeaningfulProgressAt: string | null;
  status: 'running' | 'succeeded_turn' | 'failed' | 'crashed' | 'stalled' | 'cancelled';
  turnCount: number;
  summary: string;
  failureDiagnostic?: string;
  producedEvidenceIds: string[];
  source: SourceAttribution;
}

export interface DecisionRequest {
  decisionId: string;
  projectId: string;
  milestoneId: string | null;
  kind: 'question_for_me' | 'approval_gate' | 'failure_intervention' | 'scope_conflict';
  status: 'open' | 'resolved' | 'superseded';
  exactPromptOrFailure: string;
  contextSummary: string;
  createdAt: string;
  owner: string; // Who must act next (e.g. "you", "dot")
  recommendedNextStep: string;
  options?: string[];
  resolvedAt?: string;
  resolutionNote?: string;
  source: SourceAttribution;
}

export interface EvidenceLink {
  evidenceId: string;
  projectId: string;
  kind: 'test_report' | 'git_diff' | 'deployment_check' | 'log_excerpt' | 'artifact_bundle' | 'review_gate';
  label: string;
  uriOrRef: string; // Local path, commit SHA, or artifact URI
  verified: boolean;
  createdAt: string;
  summary: string;
  metricsSummary?: string;
  source: SourceAttribution;
}

export interface ActivityEvent {
  eventId: string; // Stable source ID used for strict deduplication
  projectId: string;
  timestamp: string;
  category:
    | 'progress'
    | 'heartbeat'
    | 'worker_crash'
    | 'gate_result'
    | 'decision_requested'
    | 'operator_command'
    | 'deployment';
  actor: string;
  title: string;
  detail: string;
  isMeaningfulProgress: boolean; // True only for verified work output, false for heartbeats/session opens
  source: SourceAttribution;
}

export interface OperatorNote {
  noteId: string;
  projectId: string;
  author: string;
  createdAt: string;
  body: string;
}

export interface ReminderReceipt {
  reminderId: string;
  projectId: string;
  targetOwner: string;
  sentAt: string;
  status: 'acknowledged' | 'failed_delivery' | 'pending_ack';
  deliveryChannel: string;
  ackId: string | null;
  errorMessage?: string;
}

export interface ProjectRecord {
  projectId: string;
  revision: number; // Incremented on writes for conflict detection
  name: string;
  slug: string;
  owner: string;
  priority: PriorityLevel;
  archived: boolean;
  archivedAt: string | null;
  currentScope: string;
  currentMilestoneId: string | null;
  nextAction: string;
  latestUsefulResult: {
    summary: string;
    observedAt: string;
    evidenceId: string | null;
  } | null;
  blocker: {
    summary: string;
    since: string;
    kind: 'decision_needed' | 'worker_crashed' | 'acceptance_failed' | 'dependency_stalled' | 'telemetry_lost';
    owner: string;
  } | null;
  acceptanceStatus: AcceptanceStatus;
  lastVerifiedCompleteAt: string | null;
  deployedRevision: {
    versionOrSha: string;
    environment: string;
    deployedAt: string;
    verifiedHealthy: boolean;
  } | null;
  workerCoverageKnown: boolean;
  cost: CostTelemetry;
  milestones: MilestoneNode[];
  notes: OperatorNote[];
  reminders: ReminderReceipt[];
  source: SourceAttribution;
}

/**
 * Backend Capability Advertisement
 * Live actions require an explicit capability flag from the local Mission Control backend.
 */
export interface BackendCapabilities {
  canArchive: boolean;
  canChangePriority: boolean;
  canAddNote: boolean;
  canSendReminder: boolean;
  canResolveDecision: boolean;
  reasonIfDisabled?: string;
}

export interface MissionControlSnapshot {
  schemaVersion: SchemaVersion;
  snapshotId: string;
  generatedAt: string;
  evaluationThresholds: {
    heartbeatExpirySeconds: number; // Default e.g. 90s
    stalledProgressSeconds: number; // Default e.g. 900s (15m)
  };
  capabilities: BackendCapabilities;
  projects: ProjectRecord[];
  tasks: TaskItem[];
  workers: WorkerRecord[];
  runs: WorkerRunRecord[];
  decisions: DecisionRequest[];
  evidence: EvidenceLink[];
  events: ActivityEvent[];
}

/**
 * Operator Command Contracts (with Idempotency & Optimistic Concurrency)
 */
export type CommandPayload =
  | {
      type: 'archive_project';
      projectId: string;
      archive: boolean; // false = undo archive
      reason?: string;
    }
  | {
      type: 'set_priority';
      projectId: string;
      priority: PriorityLevel;
    }
  | {
      type: 'add_note';
      projectId: string;
      body: string;
      author: string;
    }
  | {
      type: 'send_reminder';
      projectId: string;
      targetOwner: string;
      message: string;
    }
  | {
      type: 'resolve_decision';
      projectId: string;
      decisionId: string;
      resolutionNote: string;
      selectedOption?: string;
    };

export interface OperatorCommandRequest {
  schemaVersion: SchemaVersion;
  idempotencyKey: string; // Prevents duplicate writes on network retry
  expectedRevision: number; // Conflict detection against concurrent updates
  issuedAt: string;
  command: CommandPayload;
}

export interface OperatorCommandResponse {
  ok: boolean;
  idempotencyKey: string;
  deduplicatedReplay?: boolean;
  newRevision?: number;
  acknowledgedAt?: string;
  deliveryAck?: {
    acknowledged: boolean;
    ackId: string | null;
    channel: string;
    recipient: string;
    error?: string;
  };
  errorCode?:
    | 'CAPABILITY_UNSUPPORTED'
    | 'REVISION_CONFLICT'
    | 'DELIVERY_FAILED'
    | 'NOT_CONNECTED'
    | 'VALIDATION_ERROR';
  errorMessage?: string;
}
