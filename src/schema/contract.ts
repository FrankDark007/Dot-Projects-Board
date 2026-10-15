/**
 * @file src/schema/contract.ts
 * @description Typed, versioned JSON integration contract for the `dot` Mission Control dashboard.
 * Keeps project completion, worker liveness, meaningful progress, coverage, approval state,
 * and connection health strictly separate.
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
  emitterName: string; // e.g. "local-project-board", "synthetic-fixture"
  observedAt: string; // ISO-8601 timestamp when observation was recorded
  sequence?: number; // Optional monotonic sequence number from source emitter
}

/**
 * 1. Connection Health State (Strictly distinct states)
 */
export type ConnectionHealthState =
  | 'demo_synthetic' // Explicit synthetic demo mode
  | 'never_connected' // Live mode configured, zero valid snapshots received yet
  | 'connected' // Live mode with fresh valid snapshot
  | 'stale' // Live mode with preserved valid snapshot whose age exceeds freshness threshold or had a transient poll warning
  | 'disconnected'; // Live mode where endpoint failed after previously connecting (showing preserved last-known snapshot with warning)

/**
 * 2. Worker Execution State
 * Derived strictly from execution evidence.
 * - A heartbeat proves process liveness, NOT meaningful task progress.
 * - An expired heartbeat makes current execution UNKNOWN unless authoritative stop evidence exists.
 * - An open session, git commit, or queue label does NOT prove active execution.
 */
export type RawWorkerStatus =
  | 'running'
  | 'idle'
  | 'queued'
  | 'stopped'
  | 'crashed'
  | 'failed'
  | 'disconnected'
  | 'unknown';

export type EvaluatedWorkerState =
  | 'active_running' // Confirmed alive (fresh heartbeat) AND confirmed progressing (fresh progress)
  | 'stalled_progress' // Confirmed alive (fresh heartbeat), but meaningful progress is stale/missing
  | 'unknown_expired_heartbeat' // Reported running, but heartbeat expired (or timestamp invalid/future) without authoritative stop evidence -> execution unknown
  | 'idle' // Registered & alive, no active task run
  | 'queued' // Queued in dispatcher, not yet running
  | 'stopped' // Cleanly stopped with authoritative exit record
  | 'crashed' // Confirmed abnormal process termination (signal / non-zero crash)
  | 'failed' // Confirmed task run failure
  | 'disconnected' // Telemetry source explicitly disconnected
  | 'unknown'; // Telemetry coverage unavailable

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
 * unless all required milestones and all required acceptance gates pass with verified evidence.
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
  required: boolean; // Required gates MUST pass for Verified Complete; optional gate failures stay visible as warnings
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
  required?: boolean; // Defaults to true
  status:
    | 'completed_verified'
    | 'in_progress'
    | 'blocked'
    | 'pending'
    | 'failed_acceptance';
  dependsOnMilestoneIds: string[];
  completedSteps?: string[];
  currentStep?: string | null;
  remainingSteps: string[];
  estimateLabel?: string; // Must be explicitly labeled as an estimate if present
  acceptanceGates: AcceptanceGate[];
}

export interface TaskItem {
  taskId: string;
  projectId: string;
  milestoneId: string;
  title: string;
  owner: string;
  status:
    | 'running'
    | 'blocked'
    | 'waiting_decision'
    | 'queued'
    | 'done_unverified'
    | 'verified'
    | 'failed';
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
  hostLabel: string;
  rawStatus: RawWorkerStatus;
  currentRunId: string | null;
  currentTaskSummary: string | null;
  lastHeartbeatAt: string | null;
  lastMeaningfulProgressAt: string | null;
  lastProgressSummary: string | null;
  authoritativeStopProof?: string; // If present with stopped/crashed/failed, proves process terminated
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
  status:
    | 'running'
    | 'succeeded_turn'
    | 'failed'
    | 'crashed'
    | 'stalled'
    | 'cancelled';
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
  kind:
    | 'question_for_me'
    | 'approval_gate'
    | 'failure_intervention'
    | 'missing_information'
    | 'scope_conflict';
  severity?: 'confirmed_failure' | 'missing_info_or_decision';
  status: 'open' | 'resolved' | 'superseded';
  exactPromptOrFailure: string;
  contextSummary: string;
  createdAt: string;
  owner: string;
  recommendedNextStep: string;
  options?: string[];
  resolvedAt?: string;
  resolutionNote?: string;
  source: SourceAttribution;
}

export interface EvidenceLink {
  evidenceId: string;
  projectId: string;
  kind:
    | 'test_report'
    | 'git_diff'
    | 'deployment_check'
    | 'log_excerpt'
    | 'artifact_bundle'
    | 'review_gate';
  label: string;
  uriOrRef: string;
  verified: boolean;
  createdAt: string;
  summary: string;
  metricsSummary?: string;
  source: SourceAttribution;
}

export interface ActivityEvent {
  eventId: string;
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
  isMeaningfulProgress: boolean;
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
  status: 'acknowledged' | 'accepted_pending_delivery' | 'failed_delivery' | 'uncertain_timeout';
  deliveryChannel: string;
  ackId: string | null;
  errorMessage?: string;
}

export interface ProjectRecord {
  projectId: string;
  revision: number;
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
    kind:
      | 'decision_needed'
      | 'worker_crashed'
      | 'acceptance_failed'
      | 'dependency_stalled'
      | 'telemetry_lost';
    isConfirmedFailure?: boolean; // True for verified crash/gate failure, false for missing info/decision
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
 * In Live mode, controls remain disabled unless the live backend explicitly advertises
 * a verified command endpoint and capability flags.
 */
export interface BackendCapabilities {
  commandEndpointVerified?: boolean;
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
  sequence?: number;
  generatedAt: string;
  evaluationThresholds: {
    heartbeatExpirySeconds: number;
    stalledProgressSeconds: number;
    staleFeedWarningSeconds?: number;
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

export type CommandPayload =
  | {
      type: 'archive_project';
      projectId: string;
      archive: boolean;
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
  idempotencyKey: string;
  expectedRevision: number;
  issuedAt: string;
  command: CommandPayload;
}

/**
 * Future Command Contract Response
 * Strictly distinguishes:
 * - `commandAccepted`: Backend validated and persisted the request
 * - `deliveryAck.outcome`: Whether a downstream notification/action was actually delivered,
 *   merely queued (`accepted_pending_delivery`), failed (`failed_delivery`), or timed out (`uncertain_timeout`).
 */
export interface OperatorCommandResponse {
  ok: boolean;
  idempotencyKey: string;
  commandAccepted?: boolean;
  deduplicatedReplay?: boolean;
  newRevision?: number;
  acknowledgedAt?: string;
  deliveryAck?: {
    acknowledged: boolean;
    outcome?: 'delivered_acknowledged' | 'accepted_pending_delivery' | 'failed_delivery' | 'uncertain_timeout';
    ackId: string | null;
    channel: string;
    recipient: string;
    error?: string;
  };
  errorCode?:
    | 'CAPABILITY_UNSUPPORTED'
    | 'LIVE_COMMANDS_UNCONFIGURED'
    | 'REVISION_CONFLICT'
    | 'DELIVERY_FAILED'
    | 'UNCERTAIN_WRITE_TIMEOUT'
    | 'NOT_CONNECTED'
    | 'VALIDATION_ERROR';
  errorMessage?: string;
}
