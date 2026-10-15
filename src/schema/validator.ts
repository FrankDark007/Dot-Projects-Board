/**
 * @file src/schema/validator.ts
 * @description Comprehensive runtime validation for incoming MissionControlSnapshot payloads
 * and live OperatorCommandResponse payloads.
 *
 * Validates every field consumed by the UI and state evaluator:
 * - schemaVersion, snapshotId, generatedAt, sequence, evaluationThresholds, capabilities
 * - All nested strings, booleans, enums, IDs, ISO-8601 timestamps, and numeric bounds
 * - Strict boolean `evidence.verified`
 * - Non-empty strings for `decision.owner`, `decision.exactPromptOrFailure`, `decision.contextSummary`, `decision.recommendedNextStep`
 * - Bidirectional and cross-entity references (`worker.currentRunId` <-> `run.workerId`, `gate.evidenceId`, `latestUsefulResult.evidenceId`, `task.milestoneId`, `task.assignedWorkerId`, `run.milestoneId`, `run.producedEvidenceIds`, `decision.milestoneId`, `milestone.dependsOnMilestoneIds`)
 * - Monotonic snapshot and per-source sequence ordering
 */

import { evaluateTimestamp } from '../utils/timeFormat';
import {
  CommandErrorCode,
  CONTRACT_SCHEMA_VERSION,
  DeliveryOutcome,
  MissionControlSnapshot,
  OperatorCommandRequest,
  OperatorCommandResponse,
} from './contract';

export interface SnapshotValidationResult {
  valid: boolean;
  errorCode?:
    | 'MALFORMED_OBJECT'
    | 'SCHEMA_VERSION_MISMATCH'
    | 'INVALID_TIMESTAMP'
    | 'INVALID_THRESHOLDS'
    | 'DUPLICATE_ID'
    | 'BROKEN_REFERENCE'
    | 'INVALID_ENUM_OR_FIELD'
    | 'INVALID_NUMERIC_VALUE'
    | 'OUT_OF_ORDER_SNAPSHOT';
  errors: string[];
  snapshot?: MissionControlSnapshot;
}

const VALID_DATA_SOURCE_KINDS = new Set([
  'local_orchestrator',
  'md_worker_daemon',
  'ci_verifier',
  'git_observer',
  'human_operator',
  'synthetic_demo',
]);
const VALID_PRIORITIES = new Set(['critical', 'high', 'normal', 'low']);
const VALID_ACCEPTANCE_STATUS = new Set([
  'not_run',
  'pending_review',
  'failed_gates',
  'verified_passed',
]);
const VALID_COST_COVERAGE = new Set(['complete', 'partial', 'unavailable']);
const VALID_MILESTONE_STATUS = new Set([
  'completed_verified',
  'in_progress',
  'blocked',
  'pending',
  'failed_acceptance',
]);
const VALID_GATE_STATUS = new Set(['passed', 'failed', 'pending', 'skipped']);
const VALID_RAW_WORKER_STATUS = new Set([
  'running',
  'idle',
  'queued',
  'stopped',
  'crashed',
  'failed',
  'disconnected',
  'unknown',
]);
const VALID_TASK_STATUS = new Set([
  'running',
  'blocked',
  'waiting_decision',
  'queued',
  'done_unverified',
  'verified',
  'failed',
]);
const VALID_RUN_STATUS = new Set([
  'running',
  'succeeded_turn',
  'failed',
  'crashed',
  'stalled',
  'cancelled',
]);
const VALID_DECISION_KINDS = new Set([
  'question_for_me',
  'approval_gate',
  'failure_intervention',
  'missing_information',
  'scope_conflict',
]);
const VALID_DECISION_SEVERITIES = new Set([
  'confirmed_failure',
  'missing_info_or_decision',
]);
const VALID_DECISION_STATUS = new Set(['open', 'resolved', 'superseded']);
const VALID_EVIDENCE_KINDS = new Set([
  'test_report',
  'git_diff',
  'deployment_check',
  'log_excerpt',
  'artifact_bundle',
  'review_gate',
]);
const VALID_EVENT_CATEGORIES = new Set([
  'progress',
  'heartbeat',
  'worker_crash',
  'gate_result',
  'decision_requested',
  'operator_command',
  'deployment',
]);
const VALID_BLOCKER_KINDS = new Set([
  'decision_needed',
  'worker_crashed',
  'acceptance_failed',
  'dependency_stalled',
  'telemetry_lost',
]);
const VALID_REMINDER_STATUS = new Set([
  'acknowledged',
  'accepted_pending_delivery',
  'failed_delivery',
  'uncertain_timeout',
]);
const VALID_DELIVERY_OUTCOMES = new Set<DeliveryOutcome>([
  'delivered_acknowledged',
  'accepted_pending_delivery',
  'failed_delivery',
  'uncertain_timeout',
]);
const VALID_COMMAND_ERROR_CODES = new Set<CommandErrorCode>([
  'CAPABILITY_UNSUPPORTED',
  'LIVE_COMMANDS_UNCONFIGURED',
  'REVISION_CONFLICT',
  'DELIVERY_FAILED',
  'UNCERTAIN_WRITE_TIMEOUT',
  'NOT_CONNECTED',
  'VALIDATION_ERROR',
]);

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function isNullableString(val: unknown): val is string | null {
  return val === null || typeof val === 'string';
}

function isOptionalString(val: unknown): val is string | undefined {
  return val === undefined || typeof val === 'string';
}

function isValidIsoString(val: unknown): val is string {
  if (typeof val !== 'string' || val.trim().length === 0) return false;
  return !Number.isNaN(Date.parse(val));
}

function isNullableValidIsoString(val: unknown): val is string | null {
  return val === null || isValidIsoString(val);
}

function isStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((item) => typeof item === 'string');
}

function isNonEmptyStringArray(val: unknown): val is string[] {
  return Array.isArray(val) && val.every((item) => isNonEmptyString(item));
}

function validateSourceAttribution(
  source: unknown,
  path: string,
  errors: string[],
  numericErrors: string[],
  timestampErrors: string[]
): boolean {
  if (!isRecord(source)) {
    errors.push(`${path}.source must be an object.`);
    return false;
  }
  if (!isNonEmptyString(source.sourceId)) {
    errors.push(`${path}.source.sourceId must be a non-empty string.`);
  }
  if (!VALID_DATA_SOURCE_KINDS.has(String(source.kind))) {
    errors.push(`${path}.source.kind ("${String(source.kind)}") is invalid.`);
  }
  if (!isNonEmptyString(source.emitterName)) {
    errors.push(`${path}.source.emitterName must be a non-empty string.`);
  }
  if (!isValidIsoString(source.observedAt)) {
    timestampErrors.push(`${path}.source.observedAt must be a valid ISO-8601 timestamp.`);
  }
  if (
    source.sequence !== undefined &&
    (typeof source.sequence !== 'number' ||
      !Number.isInteger(source.sequence) ||
      source.sequence < 0)
  ) {
    numericErrors.push(`${path}.source.sequence must be a non-negative integer when present.`);
  }
  return (
    errors.length === 0 && numericErrors.length === 0 && timestampErrors.length === 0
  );
}

/**
 * Validates an untrusted JSON payload at runtime before accepting it as a `MissionControlSnapshot`.
 * Enforces complete field validation, relational integrity, and monotonic sequence/timestamp ordering.
 */
export function validateSnapshotPayload(
  raw: unknown,
  options?: {
    referenceNowIso?: string;
    previousValidSnapshot?: MissionControlSnapshot | null;
  }
): SnapshotValidationResult {
  const errors: string[] = [];
  const numericErrors: string[] = [];
  const timestampErrors: string[] = [];
  const referenceErrors: string[] = [];

  if (!isRecord(raw)) {
    return {
      valid: false,
      errorCode: 'MALFORMED_OBJECT',
      errors: ['Snapshot payload must be a JSON object.'],
    };
  }

  if (raw.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
    return {
      valid: false,
      errorCode: 'SCHEMA_VERSION_MISMATCH',
      errors: [
        `Expected schemaVersion "${CONTRACT_SCHEMA_VERSION}", received "${String(
          raw.schemaVersion ?? 'undefined'
        )}".`,
      ],
    };
  }

  if (!isNonEmptyString(raw.snapshotId)) {
    errors.push('snapshotId must be a non-empty string.');
  }

  if (!isValidIsoString(raw.generatedAt)) {
    return {
      valid: false,
      errorCode: 'INVALID_TIMESTAMP',
      errors: [`generatedAt ("${String(raw.generatedAt)}") is not a valid ISO timestamp.`],
    };
  }

  if (options?.referenceNowIso) {
    const genEval = evaluateTimestamp(raw.generatedAt, options.referenceNowIso);
    if (!genEval.valid) {
      return {
        valid: false,
        errorCode: 'INVALID_TIMESTAMP',
        errors: [
          `Snapshot generatedAt failed timestamp check: ${genEval.reason || 'invalid'}.`,
        ],
      };
    }
  }

  if (
    raw.sequence !== undefined &&
    (typeof raw.sequence !== 'number' || !Number.isInteger(raw.sequence) || raw.sequence < 0)
  ) {
    return {
      valid: false,
      errorCode: 'INVALID_NUMERIC_VALUE',
      errors: ['snapshot.sequence must be a non-negative integer when provided.'],
    };
  }

  // Ordering check against previous valid snapshot
  const prev = options?.previousValidSnapshot;
  if (prev) {
    if (
      typeof raw.sequence === 'number' &&
      typeof prev.sequence === 'number' &&
      raw.sequence < prev.sequence
    ) {
      return {
        valid: false,
        errorCode: 'OUT_OF_ORDER_SNAPSHOT',
        errors: [
          `Out-of-order snapshot rejected: incoming sequence ${raw.sequence} is older than current sequence ${prev.sequence}.`,
        ],
      };
    }

    const incomingMs = Date.parse(raw.generatedAt);
    const prevMs = Date.parse(prev.generatedAt);
    if (incomingMs < prevMs) {
      return {
        valid: false,
        errorCode: 'OUT_OF_ORDER_SNAPSHOT',
        errors: [
          `Out-of-order snapshot rejected: incoming generatedAt (${raw.generatedAt}) is older than current snapshot (${prev.generatedAt}).`,
        ],
      };
    }
  }

  // Validate thresholds
  if (!isRecord(raw.evaluationThresholds)) {
    return {
      valid: false,
      errorCode: 'INVALID_THRESHOLDS',
      errors: ['evaluationThresholds must be an object.'],
    };
  }
  const hbSec = raw.evaluationThresholds.heartbeatExpirySeconds;
  const stallSec = raw.evaluationThresholds.stalledProgressSeconds;
  const staleWarnSec = raw.evaluationThresholds.staleFeedWarningSeconds;
  if (
    typeof hbSec !== 'number' ||
    !Number.isFinite(hbSec) ||
    hbSec <= 0 ||
    typeof stallSec !== 'number' ||
    !Number.isFinite(stallSec) ||
    stallSec <= 0 ||
    (staleWarnSec !== undefined &&
      (typeof staleWarnSec !== 'number' || !Number.isFinite(staleWarnSec) || staleWarnSec <= 0))
  ) {
    return {
      valid: false,
      errorCode: 'INVALID_THRESHOLDS',
      errors: [
        'evaluationThresholds.heartbeatExpirySeconds, stalledProgressSeconds, and optional staleFeedWarningSeconds must be positive finite numbers.',
      ],
    };
  }

  // Validate capabilities
  if (!isRecord(raw.capabilities)) {
    errors.push('capabilities must be an object.');
  } else {
    for (const key of [
      'canArchive',
      'canChangePriority',
      'canAddNote',
      'canSendReminder',
      'canResolveDecision',
    ]) {
      if (typeof raw.capabilities[key] !== 'boolean') {
        errors.push(`capabilities.${key} must be a boolean.`);
      }
    }
    if (
      raw.capabilities.commandEndpointVerified !== undefined &&
      typeof raw.capabilities.commandEndpointVerified !== 'boolean'
    ) {
      errors.push('capabilities.commandEndpointVerified must be a boolean when provided.');
    }
    if (!isOptionalString(raw.capabilities.reasonIfDisabled)) {
      errors.push('capabilities.reasonIfDisabled must be a string when provided.');
    }
  }

  // Check top-level arrays exist
  for (const arrKey of [
    'projects',
    'tasks',
    'workers',
    'runs',
    'decisions',
    'evidence',
    'events',
  ]) {
    if (!Array.isArray(raw[arrKey])) {
      return {
        valid: false,
        errorCode: 'MALFORMED_OBJECT',
        errors: [`Snapshot field "${arrKey}" must be an array.`],
      };
    }
  }

  const projectIds = new Set<string>();
  const projectMilestoneMap = new Map<string, Set<string>>();
  const allMilestoneIds = new Set<string>();
  const allGateIds = new Set<string>();
  const allNoteIds = new Set<string>();
  const allReminderIds = new Set<string>();
  const workerIds = new Set<string>();
  const workerMap = new Map<string, Record<string, unknown>>();
  const taskIds = new Set<string>();
  const runIds = new Set<string>();
  const runMap = new Map<string, Record<string, unknown>>();
  const decisionIds = new Set<string>();
  const evidenceIds = new Set<string>();
  const evidenceProjectMap = new Map<string, string>();

  // Track previous per-source sequences by (entityKind:entityId:emitterName)
  const prevSourceSeqMap = new Map<string, number>();
  if (prev) {
    for (const p of prev.projects) {
      if (typeof p.source?.sequence === 'number') {
        prevSourceSeqMap.set(`project:${p.projectId}:${p.source.emitterName}`, p.source.sequence);
      }
    }
    for (const w of prev.workers) {
      if (typeof w.source?.sequence === 'number') {
        prevSourceSeqMap.set(`worker:${w.workerId}:${w.source.emitterName}`, w.source.sequence);
      }
    }
    for (const r of prev.runs) {
      if (typeof r.source?.sequence === 'number') {
        prevSourceSeqMap.set(`run:${r.runId}:${r.source.emitterName}`, r.source.sequence);
      }
    }
    for (const t of prev.tasks) {
      if (typeof t.source?.sequence === 'number') {
        prevSourceSeqMap.set(`task:${t.taskId}:${t.source.emitterName}`, t.source.sequence);
      }
    }
    for (const d of prev.decisions) {
      if (typeof d.source?.sequence === 'number') {
        prevSourceSeqMap.set(
          `decision:${d.decisionId}:${d.source.emitterName}`,
          d.source.sequence
        );
      }
    }
    for (const ev of prev.evidence) {
      if (typeof ev.source?.sequence === 'number') {
        prevSourceSeqMap.set(
          `evidence:${ev.evidenceId}:${ev.source.emitterName}`,
          ev.source.sequence
        );
      }
    }
  }

  // Pass 1: Validate Evidence first so Projects, Gates, and Runs can verify evidenceId existence & project ownership
  const evidence = raw.evidence as unknown[];
  for (let i = 0; i < evidence.length; i++) {
    const ev = evidence[i];
    const path = `evidence[${i}]`;
    if (!isRecord(ev)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(ev.evidenceId)) {
      errors.push(`${path}.evidenceId must be a non-empty string.`);
    } else if (evidenceIds.has(ev.evidenceId)) {
      return {
        valid: false,
        errorCode: 'DUPLICATE_ID',
        errors: [`Duplicate evidenceId "${ev.evidenceId}".`],
      };
    } else {
      evidenceIds.add(ev.evidenceId);
    }

    if (!isNonEmptyString(ev.projectId)) {
      errors.push(`${path}.projectId must be a non-empty string.`);
    } else if (isNonEmptyString(ev.evidenceId)) {
      evidenceProjectMap.set(ev.evidenceId, ev.projectId);
    }

    if (!VALID_EVIDENCE_KINDS.has(String(ev.kind))) {
      errors.push(`${path}.kind ("${String(ev.kind)}") is invalid.`);
    }
    if (!isNonEmptyString(ev.label)) {
      errors.push(`${path}.label must be a non-empty string.`);
    }
    if (!isNonEmptyString(ev.uriOrRef)) {
      errors.push(`${path}.uriOrRef must be a non-empty string.`);
    }
    if (typeof ev.verified !== 'boolean') {
      errors.push(`${path}.verified must be a boolean.`);
    }
    if (!isValidIsoString(ev.createdAt)) {
      timestampErrors.push(`${path}.createdAt must be a valid ISO timestamp.`);
    }
    if (!isNonEmptyString(ev.summary)) {
      errors.push(`${path}.summary must be a non-empty string.`);
    }
    if (!isOptionalString(ev.metricsSummary)) {
      errors.push(`${path}.metricsSummary must be a string when present.`);
    }

    validateSourceAttribution(ev.source, path, errors, numericErrors, timestampErrors);
    if (
      isNonEmptyString(ev.evidenceId) &&
      isRecord(ev.source) &&
      isNonEmptyString(ev.source.emitterName) &&
      typeof ev.source.sequence === 'number'
    ) {
      const prevSeq = prevSourceSeqMap.get(
        `evidence:${ev.evidenceId}:${ev.source.emitterName}`
      );
      if (prevSeq !== undefined && ev.source.sequence < prevSeq) {
        return {
          valid: false,
          errorCode: 'OUT_OF_ORDER_SNAPSHOT',
          errors: [
            `Evidence "${ev.evidenceId}" source sequence regressed from ${prevSeq} to ${ev.source.sequence}.`,
          ],
        };
      }
    }
  }

  // Pass 2: Validate Projects
  const projects = raw.projects as unknown[];
  for (let i = 0; i < projects.length; i++) {
    const p = projects[i];
    const path = `projects[${i}]`;
    if (!isRecord(p)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(p.projectId)) {
      errors.push(`${path}.projectId must be a non-empty string.`);
    } else if (projectIds.has(p.projectId)) {
      return {
        valid: false,
        errorCode: 'DUPLICATE_ID',
        errors: [`Duplicate projectId "${p.projectId}" in snapshot.`],
      };
    } else {
      projectIds.add(p.projectId);
    }

    if (typeof p.revision !== 'number' || !Number.isInteger(p.revision) || p.revision < 1) {
      return {
        valid: false,
        errorCode: 'INVALID_NUMERIC_VALUE',
        errors: [`${path}.revision must be a positive integer.`],
      };
    }

    if (prev && isNonEmptyString(p.projectId)) {
      const prevProj = prev.projects.find((pp) => pp.projectId === p.projectId);
      if (prevProj && p.revision < prevProj.revision) {
        return {
          valid: false,
          errorCode: 'OUT_OF_ORDER_SNAPSHOT',
          errors: [
            `Project "${p.projectId}" revision regressed from ${prevProj.revision} to ${p.revision}.`,
          ],
        };
      }
    }

    if (!isNonEmptyString(p.name)) errors.push(`${path}.name must be a non-empty string.`);
    if (!isNonEmptyString(p.slug)) errors.push(`${path}.slug must be a non-empty string.`);
    if (!isNonEmptyString(p.owner)) errors.push(`${path}.owner must be a non-empty string.`);
    if (!isNonEmptyString(p.currentScope)) {
      errors.push(`${path}.currentScope must be a non-empty string.`);
    }
    if (!isNonEmptyString(p.nextAction)) {
      errors.push(`${path}.nextAction must be a non-empty string.`);
    }
    if (!VALID_PRIORITIES.has(String(p.priority))) {
      errors.push(`${path}.priority ("${String(p.priority)}") is invalid.`);
    }
    if (typeof p.archived !== 'boolean') {
      errors.push(`${path}.archived must be a boolean.`);
    }
    if (!isNullableValidIsoString(p.archivedAt)) {
      timestampErrors.push(`${path}.archivedAt must be null or a valid ISO timestamp.`);
    }
    if (!VALID_ACCEPTANCE_STATUS.has(String(p.acceptanceStatus))) {
      errors.push(`${path}.acceptanceStatus ("${String(p.acceptanceStatus)}") is invalid.`);
    }
    if (!isNullableValidIsoString(p.lastVerifiedCompleteAt)) {
      timestampErrors.push(
        `${path}.lastVerifiedCompleteAt must be null or a valid ISO timestamp.`
      );
    }
    if (typeof p.workerCoverageKnown !== 'boolean') {
      errors.push(`${path}.workerCoverageKnown must be a boolean.`);
    }

    // Validate latestUsefulResult
    if (p.latestUsefulResult !== null) {
      if (!isRecord(p.latestUsefulResult)) {
        errors.push(`${path}.latestUsefulResult must be null or an object.`);
      } else {
        if (!isNonEmptyString(p.latestUsefulResult.summary)) {
          errors.push(`${path}.latestUsefulResult.summary must be a non-empty string.`);
        }
        if (!isValidIsoString(p.latestUsefulResult.observedAt)) {
          timestampErrors.push(
            `${path}.latestUsefulResult.observedAt must be a valid ISO timestamp.`
          );
        }
        const resEvId = p.latestUsefulResult.evidenceId;
        if (resEvId !== null) {
          if (!isNonEmptyString(resEvId)) {
            errors.push(
              `${path}.latestUsefulResult.evidenceId must be null or a non-empty string.`
            );
          } else if (
            !evidenceIds.has(resEvId) ||
            (isNonEmptyString(p.projectId) &&
              evidenceProjectMap.get(resEvId) !== p.projectId)
          ) {
            referenceErrors.push(
              `${path}.latestUsefulResult.evidenceId ("${resEvId}") does not exist on project "${String(
                p.projectId
              )}".`
            );
          }
        }
      }
    }

    // Validate blocker
    if (p.blocker !== null) {
      if (!isRecord(p.blocker)) {
        errors.push(`${path}.blocker must be null or an object.`);
      } else {
        if (!isNonEmptyString(p.blocker.summary)) {
          errors.push(`${path}.blocker.summary must be a non-empty string.`);
        }
        if (!isValidIsoString(p.blocker.since)) {
          timestampErrors.push(`${path}.blocker.since must be a valid ISO timestamp.`);
        }
        if (!VALID_BLOCKER_KINDS.has(String(p.blocker.kind))) {
          errors.push(`${path}.blocker.kind ("${String(p.blocker.kind)}") is invalid.`);
        }
        if (
          p.blocker.isConfirmedFailure !== undefined &&
          typeof p.blocker.isConfirmedFailure !== 'boolean'
        ) {
          errors.push(`${path}.blocker.isConfirmedFailure must be a boolean when present.`);
        }
        if (!isNonEmptyString(p.blocker.owner)) {
          errors.push(`${path}.blocker.owner must be a non-empty string.`);
        }
      }
    }

    // Validate deployedRevision
    if (p.deployedRevision !== null) {
      if (!isRecord(p.deployedRevision)) {
        errors.push(`${path}.deployedRevision must be null or an object.`);
      } else {
        if (!isNonEmptyString(p.deployedRevision.versionOrSha)) {
          errors.push(`${path}.deployedRevision.versionOrSha must be a non-empty string.`);
        }
        if (!isNonEmptyString(p.deployedRevision.environment)) {
          errors.push(`${path}.deployedRevision.environment must be a non-empty string.`);
        }
        if (!isValidIsoString(p.deployedRevision.deployedAt)) {
          timestampErrors.push(
            `${path}.deployedRevision.deployedAt must be a valid ISO timestamp.`
          );
        }
        if (typeof p.deployedRevision.verifiedHealthy !== 'boolean') {
          errors.push(`${path}.deployedRevision.verifiedHealthy must be a boolean.`);
        }
      }
    }

    // Validate CostTelemetry
    if (!isRecord(p.cost)) {
      errors.push(`${path}.cost must be an object.`);
    } else {
      if (!VALID_COST_COVERAGE.has(String(p.cost.coverage))) {
        errors.push(`${path}.cost.coverage is invalid.`);
      }
      if (
        p.cost.knownUsd !== null &&
        (typeof p.cost.knownUsd !== 'number' ||
          !Number.isFinite(p.cost.knownUsd) ||
          p.cost.knownUsd < 0)
      ) {
        return {
          valid: false,
          errorCode: 'INVALID_NUMERIC_VALUE',
          errors: [`${path}.cost.knownUsd must be null or a non-negative finite number.`],
        };
      }
      if (p.cost.coverage === 'unavailable' && p.cost.knownUsd !== null) {
        errors.push(`${path}.cost.knownUsd must be null when cost.coverage is "unavailable".`);
      }
      if (typeof p.cost.isEstimate !== 'boolean') {
        errors.push(`${path}.cost.isEstimate must be a boolean.`);
      }
      if (!isStringArray(p.cost.untrackedSources)) {
        errors.push(`${path}.cost.untrackedSources must be an array of strings.`);
      }
      if (!isOptionalString(p.cost.note)) {
        errors.push(`${path}.cost.note must be a string when present.`);
      }
    }

    // Validate Milestones
    const msIds = new Set<string>();
    if (isNonEmptyString(p.projectId)) {
      projectMilestoneMap.set(p.projectId, msIds);
    }

    if (!Array.isArray(p.milestones)) {
      errors.push(`${path}.milestones must be an array.`);
    } else {
      for (let mIdx = 0; mIdx < p.milestones.length; mIdx++) {
        const m = p.milestones[mIdx];
        const mPath = `${path}.milestones[${mIdx}]`;
        if (!isRecord(m)) {
          errors.push(`${mPath} must be an object.`);
          continue;
        }
        if (!isNonEmptyString(m.milestoneId)) {
          errors.push(`${mPath}.milestoneId must be a non-empty string.`);
        } else if (msIds.has(m.milestoneId) || allMilestoneIds.has(m.milestoneId)) {
          return {
            valid: false,
            errorCode: 'DUPLICATE_ID',
            errors: [
              `Duplicate milestoneId "${m.milestoneId}" in project "${String(p.projectId)}".`,
            ],
          };
        } else {
          msIds.add(m.milestoneId);
          allMilestoneIds.add(m.milestoneId);
        }

        if (!isNonEmptyString(m.title)) {
          errors.push(`${mPath}.title must be a non-empty string.`);
        }
        if (typeof m.order !== 'number' || !Number.isFinite(m.order)) {
          numericErrors.push(`${mPath}.order must be a finite number.`);
        }
        if (m.required !== undefined && typeof m.required !== 'boolean') {
          errors.push(`${mPath}.required must be a boolean when present.`);
        }
        if (!VALID_MILESTONE_STATUS.has(String(m.status))) {
          errors.push(`${mPath}.status ("${String(m.status)}") is invalid.`);
        }
        if (!isStringArray(m.dependsOnMilestoneIds)) {
          errors.push(`${mPath}.dependsOnMilestoneIds must be an array of strings.`);
        }
        if (m.completedSteps !== undefined && !isStringArray(m.completedSteps)) {
          errors.push(`${mPath}.completedSteps must be an array of strings when present.`);
        }
        if (m.currentStep !== undefined && !isNullableString(m.currentStep)) {
          errors.push(`${mPath}.currentStep must be a string or null when present.`);
        }
        if (!isStringArray(m.remainingSteps)) {
          errors.push(`${mPath}.remainingSteps must be an array of strings.`);
        }
        if (!isOptionalString(m.estimateLabel)) {
          errors.push(`${mPath}.estimateLabel must be a string when present.`);
        }

        if (!Array.isArray(m.acceptanceGates)) {
          errors.push(`${mPath}.acceptanceGates must be an array.`);
        } else {
          const gateIds = new Set<string>();
          for (let gIdx = 0; gIdx < m.acceptanceGates.length; gIdx++) {
            const g = m.acceptanceGates[gIdx];
            const gPath = `${mPath}.acceptanceGates[${gIdx}]`;
            if (!isRecord(g)) {
              errors.push(`${gPath} must be an object.`);
              continue;
            }
            if (!isNonEmptyString(g.gateId)) {
              errors.push(`${gPath}.gateId must be a non-empty string.`);
            } else if (gateIds.has(g.gateId) || allGateIds.has(g.gateId)) {
              return {
                valid: false,
                errorCode: 'DUPLICATE_ID',
                errors: [`Duplicate gateId "${g.gateId}" in milestone "${String(m.milestoneId)}".`],
              };
            } else {
              gateIds.add(g.gateId);
              allGateIds.add(g.gateId);
            }
            if (!isNonEmptyString(g.label)) {
              errors.push(`${gPath}.label must be a non-empty string.`);
            }
            if (!VALID_GATE_STATUS.has(String(g.status))) {
              errors.push(`${gPath}.status ("${String(g.status)}") is invalid.`);
            }
            if (typeof g.required !== 'boolean') {
              errors.push(`${gPath}.required must be a boolean.`);
            }
            if (!isNullableValidIsoString(g.verifiedAt)) {
              timestampErrors.push(`${gPath}.verifiedAt must be null or a valid ISO timestamp.`);
            }
            if (g.verifierSource !== null && !isNonEmptyString(g.verifierSource)) {
              errors.push(`${gPath}.verifierSource must be null or a non-empty string.`);
            }
            if (typeof g.details !== 'string') {
              errors.push(`${gPath}.details must be a string.`);
            }
            if (g.evidenceId !== undefined && g.evidenceId !== null) {
              if (!isNonEmptyString(g.evidenceId)) {
                errors.push(`${gPath}.evidenceId must be a non-empty string when provided.`);
              } else if (
                !evidenceIds.has(g.evidenceId) ||
                (isNonEmptyString(p.projectId) &&
                  evidenceProjectMap.get(g.evidenceId) !== p.projectId)
              ) {
                referenceErrors.push(
                  `${gPath}.evidenceId ("${g.evidenceId}") does not exist on project "${String(
                    p.projectId
                  )}".`
                );
              }
            }
          }
        }
      }

      // Second pass on milestones to verify dependsOnMilestoneIds exist in the same project
      for (let mIdx = 0; mIdx < p.milestones.length; mIdx++) {
        const m = p.milestones[mIdx];
        if (isRecord(m) && isStringArray(m.dependsOnMilestoneIds)) {
          for (const depId of m.dependsOnMilestoneIds) {
            if (!msIds.has(depId) || depId === m.milestoneId) {
              referenceErrors.push(
                `${path}.milestones[${mIdx}].dependsOnMilestoneIds contains invalid or self-referential milestoneId "${depId}".`
              );
            }
          }
        }
      }

      if (p.currentMilestoneId !== null && p.currentMilestoneId !== undefined) {
        if (typeof p.currentMilestoneId !== 'string' || !msIds.has(p.currentMilestoneId)) {
          referenceErrors.push(
            `${path}.currentMilestoneId ("${String(
              p.currentMilestoneId
            )}") does not exist in project milestones.`
          );
        }
      }
    }

    // Validate notes
    if (!Array.isArray(p.notes)) {
      errors.push(`${path}.notes must be an array.`);
    } else {
      for (let nIdx = 0; nIdx < p.notes.length; nIdx++) {
        const n = p.notes[nIdx];
        const nPath = `${path}.notes[${nIdx}]`;
        if (!isRecord(n)) {
          errors.push(`${nPath} must be an object.`);
          continue;
        }
        if (!isNonEmptyString(n.noteId)) {
          errors.push(`${nPath}.noteId must be a non-empty string.`);
        } else if (allNoteIds.has(n.noteId)) {
          return {
            valid: false,
            errorCode: 'DUPLICATE_ID',
            errors: [`Duplicate noteId "${n.noteId}".`],
          };
        } else {
          allNoteIds.add(n.noteId);
        }
        if (n.projectId !== p.projectId) {
          referenceErrors.push(
            `${nPath}.projectId ("${String(n.projectId)}") does not match parent projectId "${String(
              p.projectId
            )}".`
          );
        }
        if (!isNonEmptyString(n.author)) {
          errors.push(`${nPath}.author must be a non-empty string.`);
        }
        if (!isValidIsoString(n.createdAt)) {
          timestampErrors.push(`${nPath}.createdAt must be a valid ISO timestamp.`);
        }
        if (!isNonEmptyString(n.body)) {
          errors.push(`${nPath}.body must be a non-empty string.`);
        }
      }
    }

    // Validate reminders
    if (!Array.isArray(p.reminders)) {
      errors.push(`${path}.reminders must be an array.`);
    } else {
      for (let rIdx = 0; rIdx < p.reminders.length; rIdx++) {
        const rem = p.reminders[rIdx];
        const rPath = `${path}.reminders[${rIdx}]`;
        if (!isRecord(rem)) {
          errors.push(`${rPath} must be an object.`);
          continue;
        }
        if (!isNonEmptyString(rem.reminderId)) {
          errors.push(`${rPath}.reminderId must be a non-empty string.`);
        } else if (allReminderIds.has(rem.reminderId)) {
          return {
            valid: false,
            errorCode: 'DUPLICATE_ID',
            errors: [`Duplicate reminderId "${rem.reminderId}".`],
          };
        } else {
          allReminderIds.add(rem.reminderId);
        }
        if (rem.projectId !== p.projectId) {
          referenceErrors.push(
            `${rPath}.projectId ("${String(
              rem.projectId
            )}") does not match parent projectId "${String(p.projectId)}".`
          );
        }
        if (!isNonEmptyString(rem.targetOwner)) {
          errors.push(`${rPath}.targetOwner must be a non-empty string.`);
        }
        if (!isValidIsoString(rem.sentAt)) {
          timestampErrors.push(`${rPath}.sentAt must be a valid ISO timestamp.`);
        }
        if (!VALID_REMINDER_STATUS.has(String(rem.status))) {
          errors.push(`${rPath}.status ("${String(rem.status)}") is invalid.`);
        }
        if (!isNonEmptyString(rem.deliveryChannel)) {
          errors.push(`${rPath}.deliveryChannel must be a non-empty string.`);
        }
        if (rem.ackId !== null && !isNonEmptyString(rem.ackId)) {
          errors.push(`${rPath}.ackId must be null or a non-empty string.`);
        }
        if (!isOptionalString(rem.errorMessage)) {
          errors.push(`${rPath}.errorMessage must be a string when present.`);
        }
      }
    }

    validateSourceAttribution(p.source, path, errors, numericErrors, timestampErrors);
    if (
      isNonEmptyString(p.projectId) &&
      isRecord(p.source) &&
      isNonEmptyString(p.source.emitterName) &&
      typeof p.source.sequence === 'number'
    ) {
      const prevSeq = prevSourceSeqMap.get(`project:${p.projectId}:${p.source.emitterName}`);
      if (prevSeq !== undefined && p.source.sequence < prevSeq) {
        return {
          valid: false,
          errorCode: 'OUT_OF_ORDER_SNAPSHOT',
          errors: [
            `Project "${p.projectId}" source sequence regressed from ${prevSeq} to ${p.source.sequence}.`,
          ],
        };
      }
    }
  }

  // Verify evidence.projectId references exist in projectIds
  for (const [evId, projId] of evidenceProjectMap.entries()) {
    if (!projectIds.has(projId)) {
      referenceErrors.push(
        `Evidence "${evId}" references unknown projectId "${projId}".`
      );
    }
  }

  // Pass 3: Validate Workers
  const workers = raw.workers as unknown[];
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    const path = `workers[${i}]`;
    if (!isRecord(w)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(w.workerId)) {
      errors.push(`${path}.workerId must be a non-empty string.`);
    } else if (workerIds.has(w.workerId)) {
      return {
        valid: false,
        errorCode: 'DUPLICATE_ID',
        errors: [`Duplicate workerId "${w.workerId}" in snapshot.`],
      };
    } else {
      workerIds.add(w.workerId);
      workerMap.set(w.workerId, w);
    }

    if (w.projectId !== null && (!isNonEmptyString(w.projectId) || !projectIds.has(w.projectId))) {
      referenceErrors.push(
        `${path}.projectId ("${String(w.projectId)}") references unknown project.`
      );
    }
    if (!isNonEmptyString(w.name)) errors.push(`${path}.name must be a non-empty string.`);
    if (!isNonEmptyString(w.role)) errors.push(`${path}.role must be a non-empty string.`);
    if (!isNonEmptyString(w.hostLabel)) {
      errors.push(`${path}.hostLabel must be a non-empty string.`);
    }
    if (!VALID_RAW_WORKER_STATUS.has(String(w.rawStatus))) {
      errors.push(`${path}.rawStatus ("${String(w.rawStatus)}") is invalid.`);
    }
    if (w.currentRunId !== null && !isNonEmptyString(w.currentRunId)) {
      errors.push(`${path}.currentRunId must be null or a non-empty string.`);
    }
    if (!isNullableString(w.currentTaskSummary)) {
      errors.push(`${path}.currentTaskSummary must be null or a string.`);
    }
    if (!isNullableValidIsoString(w.lastHeartbeatAt)) {
      timestampErrors.push(`${path}.lastHeartbeatAt must be null or a valid ISO timestamp.`);
    }
    if (!isNullableValidIsoString(w.lastMeaningfulProgressAt)) {
      timestampErrors.push(
        `${path}.lastMeaningfulProgressAt must be null or a valid ISO timestamp.`
      );
    }
    if (!isNullableString(w.lastProgressSummary)) {
      errors.push(`${path}.lastProgressSummary must be null or a string.`);
    }
    if (!isOptionalString(w.authoritativeStopProof)) {
      errors.push(`${path}.authoritativeStopProof must be a string when present.`);
    }
    if (!isOptionalString(w.exitReason)) {
      errors.push(`${path}.exitReason must be a string when present.`);
    }
    if (typeof w.coverageAvailable !== 'boolean') {
      errors.push(`${path}.coverageAvailable must be a boolean.`);
    }

    validateSourceAttribution(w.source, path, errors, numericErrors, timestampErrors);
    if (
      isNonEmptyString(w.workerId) &&
      isRecord(w.source) &&
      isNonEmptyString(w.source.emitterName) &&
      typeof w.source.sequence === 'number'
    ) {
      const prevSeq = prevSourceSeqMap.get(`worker:${w.workerId}:${w.source.emitterName}`);
      if (prevSeq !== undefined && w.source.sequence < prevSeq) {
        return {
          valid: false,
          errorCode: 'OUT_OF_ORDER_SNAPSHOT',
          errors: [
            `Worker "${w.workerId}" source sequence regressed from ${prevSeq} to ${w.source.sequence}.`,
          ],
        };
      }
    }
  }

  // Pass 4: Validate Runs and cross-check worker <-> run relationships
  const runs = raw.runs as unknown[];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const path = `runs[${i}]`;
    if (!isRecord(r)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(r.runId)) {
      errors.push(`${path}.runId must be a non-empty string.`);
    } else if (runIds.has(r.runId)) {
      return {
        valid: false,
        errorCode: 'DUPLICATE_ID',
        errors: [`Duplicate runId "${r.runId}".`],
      };
    } else {
      runIds.add(r.runId);
      runMap.set(r.runId, r);
    }

    if (!isNonEmptyString(r.workerId) || !workerIds.has(r.workerId)) {
      referenceErrors.push(
        `${path}.workerId ("${String(r.workerId)}") references unknown worker.`
      );
    }
    if (!isNonEmptyString(r.projectId) || !projectIds.has(r.projectId)) {
      referenceErrors.push(
        `${path}.projectId ("${String(r.projectId)}") references unknown project.`
      );
    } else if (r.milestoneId !== null) {
      const projMs = projectMilestoneMap.get(r.projectId);
      if (!isNonEmptyString(r.milestoneId) || !projMs?.has(r.milestoneId)) {
        referenceErrors.push(
          `${path}.milestoneId ("${String(
            r.milestoneId
          )}") does not exist on project "${r.projectId}".`
        );
      }
    }

    if (!isValidIsoString(r.startedAt)) {
      timestampErrors.push(`${path}.startedAt must be a valid ISO timestamp.`);
    }
    if (!isNullableValidIsoString(r.endedAt)) {
      timestampErrors.push(`${path}.endedAt must be null or a valid ISO timestamp.`);
    } else if (
      typeof r.endedAt === 'string' &&
      isValidIsoString(r.startedAt) &&
      Date.parse(r.endedAt) < Date.parse(r.startedAt)
    ) {
      timestampErrors.push(`${path}.endedAt cannot be earlier than startedAt.`);
    }
    if (!isValidIsoString(r.lastHeartbeatAt)) {
      timestampErrors.push(`${path}.lastHeartbeatAt must be a valid ISO timestamp.`);
    }
    if (!isNullableValidIsoString(r.lastMeaningfulProgressAt)) {
      timestampErrors.push(
        `${path}.lastMeaningfulProgressAt must be null or a valid ISO timestamp.`
      );
    }
    if (!VALID_RUN_STATUS.has(String(r.status))) {
      errors.push(`${path}.status ("${String(r.status)}") is invalid.`);
    }
    if (
      typeof r.turnCount !== 'number' ||
      !Number.isInteger(r.turnCount) ||
      r.turnCount < 0
    ) {
      numericErrors.push(`${path}.turnCount must be a non-negative integer.`);
    }
    if (!isNonEmptyString(r.summary)) {
      errors.push(`${path}.summary must be a non-empty string.`);
    }
    if (!isOptionalString(r.failureDiagnostic)) {
      errors.push(`${path}.failureDiagnostic must be a string when present.`);
    }
    if (!isStringArray(r.producedEvidenceIds)) {
      errors.push(`${path}.producedEvidenceIds must be an array of strings.`);
    } else {
      for (const evId of r.producedEvidenceIds) {
        if (
          !evidenceIds.has(evId) ||
          (isNonEmptyString(r.projectId) && evidenceProjectMap.get(evId) !== r.projectId)
        ) {
          referenceErrors.push(
            `${path}.producedEvidenceIds references unknown or cross-project evidenceId "${evId}".`
          );
        }
      }
    }

    validateSourceAttribution(r.source, path, errors, numericErrors, timestampErrors);
    if (
      isNonEmptyString(r.runId) &&
      isRecord(r.source) &&
      isNonEmptyString(r.source.emitterName) &&
      typeof r.source.sequence === 'number'
    ) {
      const prevSeq = prevSourceSeqMap.get(`run:${r.runId}:${r.source.emitterName}`);
      if (prevSeq !== undefined && r.source.sequence < prevSeq) {
        return {
          valid: false,
          errorCode: 'OUT_OF_ORDER_SNAPSHOT',
          errors: [
            `Run "${r.runId}" source sequence regressed from ${prevSeq} to ${r.source.sequence}.`,
          ],
        };
      }
    }
  }

  // Verify worker.currentRunId references an existing run and matches workerId & projectId
  for (const [wId, w] of workerMap.entries()) {
    if (typeof w.currentRunId === 'string') {
      const linkedRun = runMap.get(w.currentRunId);
      if (!linkedRun) {
        referenceErrors.push(
          `Worker "${wId}" currentRunId ("${w.currentRunId}") does not exist in snapshot.runs.`
        );
      } else {
        if (linkedRun.workerId !== wId) {
          referenceErrors.push(
            `Worker "${wId}" currentRunId ("${w.currentRunId}") belongs to worker "${String(
              linkedRun.workerId
            )}".`
          );
        }
        if (w.projectId !== null && linkedRun.projectId !== w.projectId) {
          referenceErrors.push(
            `Worker "${wId}" projectId ("${String(
              w.projectId
            )}") conflicts with currentRunId projectId ("${String(linkedRun.projectId)}").`
          );
        }
      }
    }
  }

  // Pass 5: Validate Tasks
  const tasks = raw.tasks as unknown[];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const path = `tasks[${i}]`;
    if (!isRecord(t)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(t.taskId)) {
      errors.push(`${path}.taskId must be a non-empty string.`);
    } else if (taskIds.has(t.taskId)) {
      return {
        valid: false,
        errorCode: 'DUPLICATE_ID',
        errors: [`Duplicate taskId "${t.taskId}".`],
      };
    } else {
      taskIds.add(t.taskId);
    }

    if (!isNonEmptyString(t.projectId) || !projectIds.has(t.projectId)) {
      referenceErrors.push(
        `${path}.projectId ("${String(t.projectId)}") references unknown project.`
      );
    } else {
      const projMs = projectMilestoneMap.get(t.projectId);
      if (!isNonEmptyString(t.milestoneId) || !projMs?.has(t.milestoneId)) {
        referenceErrors.push(
          `${path}.milestoneId ("${String(
            t.milestoneId
          )}") does not exist on project "${t.projectId}".`
        );
      }
    }

    if (!isNonEmptyString(t.title)) errors.push(`${path}.title must be a non-empty string.`);
    if (!isNonEmptyString(t.owner)) errors.push(`${path}.owner must be a non-empty string.`);
    if (!VALID_TASK_STATUS.has(String(t.status))) {
      errors.push(`${path}.status ("${String(t.status)}") is invalid.`);
    }
    if (t.assignedWorkerId !== null) {
      if (!isNonEmptyString(t.assignedWorkerId) || !workerIds.has(t.assignedWorkerId)) {
        referenceErrors.push(
          `${path}.assignedWorkerId ("${String(t.assignedWorkerId)}") references unknown worker.`
        );
      } else {
        const assignedW = workerMap.get(t.assignedWorkerId);
        if (assignedW && assignedW.projectId !== null && assignedW.projectId !== t.projectId) {
          referenceErrors.push(
            `${path}.assignedWorkerId ("${t.assignedWorkerId}") is assigned to a different project ("${String(
              assignedW.projectId
            )}").`
          );
        }
      }
    }
    if (!isNullableValidIsoString(t.lastMeaningfulProgressAt)) {
      timestampErrors.push(
        `${path}.lastMeaningfulProgressAt must be null or a valid ISO timestamp.`
      );
    }
    if (!isNonEmptyString(t.summary)) {
      errors.push(`${path}.summary must be a non-empty string.`);
    }

    validateSourceAttribution(t.source, path, errors, numericErrors, timestampErrors);
    if (
      isNonEmptyString(t.taskId) &&
      isRecord(t.source) &&
      isNonEmptyString(t.source.emitterName) &&
      typeof t.source.sequence === 'number'
    ) {
      const prevSeq = prevSourceSeqMap.get(`task:${t.taskId}:${t.source.emitterName}`);
      if (prevSeq !== undefined && t.source.sequence < prevSeq) {
        return {
          valid: false,
          errorCode: 'OUT_OF_ORDER_SNAPSHOT',
          errors: [
            `Task "${t.taskId}" source sequence regressed from ${prevSeq} to ${t.source.sequence}.`,
          ],
        };
      }
    }
  }

  // Pass 6: Validate Decisions (strictly requiring owner, exactPromptOrFailure, contextSummary, recommendedNextStep)
  const decisions = raw.decisions as unknown[];
  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    const path = `decisions[${i}]`;
    if (!isRecord(d)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(d.decisionId)) {
      errors.push(`${path}.decisionId must be a non-empty string.`);
    } else if (decisionIds.has(d.decisionId)) {
      return {
        valid: false,
        errorCode: 'DUPLICATE_ID',
        errors: [`Duplicate decisionId "${d.decisionId}".`],
      };
    } else {
      decisionIds.add(d.decisionId);
    }

    if (!isNonEmptyString(d.projectId) || !projectIds.has(d.projectId)) {
      referenceErrors.push(
        `${path}.projectId ("${String(d.projectId)}") references unknown project.`
      );
    } else if (d.milestoneId !== null) {
      const projMs = projectMilestoneMap.get(d.projectId);
      if (!isNonEmptyString(d.milestoneId) || !projMs?.has(d.milestoneId)) {
        referenceErrors.push(
          `${path}.milestoneId ("${String(
            d.milestoneId
          )}") does not exist on project "${d.projectId}".`
        );
      }
    }

    if (!VALID_DECISION_KINDS.has(String(d.kind))) {
      errors.push(`${path}.kind ("${String(d.kind)}") is invalid.`);
    }
    if (
      d.severity !== undefined &&
      !VALID_DECISION_SEVERITIES.has(String(d.severity))
    ) {
      errors.push(`${path}.severity ("${String(d.severity)}") is invalid.`);
    }
    if (!VALID_DECISION_STATUS.has(String(d.status))) {
      errors.push(`${path}.status ("${String(d.status)}") is invalid.`);
    }
    if (!isNonEmptyString(d.exactPromptOrFailure)) {
      errors.push(`${path}.exactPromptOrFailure must be a non-empty string.`);
    }
    if (!isNonEmptyString(d.contextSummary)) {
      errors.push(`${path}.contextSummary must be a non-empty string.`);
    }
    if (!isValidIsoString(d.createdAt)) {
      timestampErrors.push(`${path}.createdAt must be a valid ISO timestamp.`);
    }
    if (!isNonEmptyString(d.owner)) {
      errors.push(`${path}.owner must be a non-empty string.`);
    }
    if (!isNonEmptyString(d.recommendedNextStep)) {
      errors.push(`${path}.recommendedNextStep must be a non-empty string.`);
    }
    if (d.options !== undefined && !isNonEmptyStringArray(d.options)) {
      errors.push(`${path}.options must be an array of non-empty strings when present.`);
    }
    if (d.resolvedAt !== undefined && !isValidIsoString(d.resolvedAt)) {
      timestampErrors.push(`${path}.resolvedAt must be a valid ISO timestamp when present.`);
    }
    if (!isOptionalString(d.resolutionNote)) {
      errors.push(`${path}.resolutionNote must be a string when present.`);
    }

    validateSourceAttribution(d.source, path, errors, numericErrors, timestampErrors);
    if (
      isNonEmptyString(d.decisionId) &&
      isRecord(d.source) &&
      isNonEmptyString(d.source.emitterName) &&
      typeof d.source.sequence === 'number'
    ) {
      const prevSeq = prevSourceSeqMap.get(
        `decision:${d.decisionId}:${d.source.emitterName}`
      );
      if (prevSeq !== undefined && d.source.sequence < prevSeq) {
        return {
          valid: false,
          errorCode: 'OUT_OF_ORDER_SNAPSHOT',
          errors: [
            `Decision "${d.decisionId}" source sequence regressed from ${prevSeq} to ${d.source.sequence}.`,
          ],
        };
      }
    }
  }

  // Pass 7: Validate Events
  const events = raw.events as unknown[];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const path = `events[${i}]`;
    if (!isRecord(e)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(e.eventId)) {
      errors.push(`${path}.eventId must be a non-empty string.`);
    }
    if (!isNonEmptyString(e.projectId) || !projectIds.has(e.projectId)) {
      referenceErrors.push(
        `${path}.projectId ("${String(e.projectId)}") references unknown project.`
      );
    }
    if (!isValidIsoString(e.timestamp)) {
      timestampErrors.push(`${path}.timestamp must be a valid ISO timestamp.`);
    }
    if (!VALID_EVENT_CATEGORIES.has(String(e.category))) {
      errors.push(`${path}.category ("${String(e.category)}") is invalid.`);
    }
    if (!isNonEmptyString(e.actor)) {
      errors.push(`${path}.actor must be a non-empty string.`);
    }
    if (!isNonEmptyString(e.title)) {
      errors.push(`${path}.title must be a non-empty string.`);
    }
    if (typeof e.detail !== 'string') {
      errors.push(`${path}.detail must be a string.`);
    }
    if (typeof e.isMeaningfulProgress !== 'boolean') {
      errors.push(`${path}.isMeaningfulProgress must be a boolean.`);
    }
    validateSourceAttribution(e.source, path, errors, numericErrors, timestampErrors);
  }

  if (referenceErrors.length > 0) {
    return {
      valid: false,
      errorCode: 'BROKEN_REFERENCE',
      errors: [...referenceErrors, ...errors, ...numericErrors, ...timestampErrors],
    };
  }

  if (numericErrors.length > 0) {
    return {
      valid: false,
      errorCode: 'INVALID_NUMERIC_VALUE',
      errors: [...numericErrors, ...errors, ...timestampErrors],
    };
  }

  if (timestampErrors.length > 0) {
    return {
      valid: false,
      errorCode: 'INVALID_TIMESTAMP',
      errors: [...timestampErrors, ...errors],
    };
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errorCode: 'INVALID_ENUM_OR_FIELD',
      errors,
    };
  }

  return {
    valid: true,
    errors: [],
    snapshot: raw as unknown as MissionControlSnapshot,
  };
}

/**
 * Validates a live backend's OperatorCommandResponse against HTTP status, request identity,
 * idempotencyKey, revision numbers, and delivery acknowledgment semantics.
 *
 * Guarantees:
 * - An HTTP error status (`!httpOk`) with `{ ok: true }` is ALWAYS rejected as contradictory.
 * - A mismatched `idempotencyKey`, `commandType`, or `projectId` is ALWAYS rejected.
 * - `send_reminder` with `ok: true` requires a valid `deliveryAck` object.
 * - `deliveryAck.outcome` of `failed_delivery` or `uncertain_timeout` cannot claim `ok: true` or `acknowledged: true`.
 */
export function validateCommandResponsePayload(
  raw: unknown,
  req: OperatorCommandRequest,
  httpStatus: number,
  httpOk: boolean
): OperatorCommandResponse {
  if (!isRecord(raw)) {
    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: false,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: `Malformed command response from live backend (HTTP ${httpStatus}: expected JSON object).`,
    };
  }

  if (typeof raw.ok !== 'boolean' || !isNonEmptyString(raw.idempotencyKey)) {
    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: false,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: `Malformed command response from live backend (HTTP ${httpStatus}: missing boolean ok or string idempotencyKey).`,
    };
  }

  // Exact idempotency key match check
  if (raw.idempotencyKey !== req.idempotencyKey) {
    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: false,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: `Command response idempotencyKey mismatch: expected "${req.idempotencyKey}", received "${raw.idempotencyKey}".`,
    };
  }

  // Optional command identity fields check
  if (raw.commandType !== undefined && raw.commandType !== req.command.type) {
    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: false,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: `Command response commandType mismatch: expected "${req.command.type}", received "${String(
        raw.commandType
      )}".`,
    };
  }

  if (raw.projectId !== undefined && raw.projectId !== req.command.projectId) {
    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: false,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: `Command response projectId mismatch: expected "${req.command.projectId}", received "${String(
        raw.projectId
      )}".`,
    };
  }

  // Contradiction check: non-2xx HTTP status must NEVER be treated as ok: true
  if (!httpOk && raw.ok === true) {
    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: false,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: `Contradictory command response: HTTP ${httpStatus} error status returned ok:true payload.`,
    };
  }

  if (httpOk && raw.ok === false) {
    // Backend returned 200 with ok:false; still treat as failure, validating errorCode
  }

  if (
    raw.commandAccepted !== undefined &&
    typeof raw.commandAccepted !== 'boolean'
  ) {
    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: false,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: 'Command response commandAccepted must be a boolean when provided.',
    };
  }

  if (
    raw.deduplicatedReplay !== undefined &&
    typeof raw.deduplicatedReplay !== 'boolean'
  ) {
    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: false,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: 'Command response deduplicatedReplay must be a boolean when provided.',
    };
  }

  if (
    raw.newRevision !== undefined &&
    (typeof raw.newRevision !== 'number' ||
      !Number.isInteger(raw.newRevision) ||
      raw.newRevision < 1)
  ) {
    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: false,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: 'Command response newRevision must be a positive integer when provided.',
    };
  }

  if (raw.acknowledgedAt !== undefined && !isValidIsoString(raw.acknowledgedAt)) {
    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: false,
      errorCode: 'VALIDATION_ERROR',
      errorMessage: 'Command response acknowledgedAt must be a valid ISO timestamp when provided.',
    };
  }

  // Validate deliveryAck when present (or required on send_reminder success)
  let validatedDeliveryAck: OperatorCommandResponse['deliveryAck'] | undefined;
  if (raw.deliveryAck !== undefined) {
    if (!isRecord(raw.deliveryAck)) {
      return {
        ok: false,
        idempotencyKey: req.idempotencyKey,
        commandAccepted: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'Command response deliveryAck must be an object.',
      };
    }

    const ack = raw.deliveryAck;
    if (typeof ack.acknowledged !== 'boolean') {
      return {
        ok: false,
        idempotencyKey: req.idempotencyKey,
        commandAccepted: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'Command response deliveryAck.acknowledged must be a boolean.',
      };
    }

    if (
      ack.outcome !== undefined &&
      !VALID_DELIVERY_OUTCOMES.has(ack.outcome as DeliveryOutcome)
    ) {
      return {
        ok: false,
        idempotencyKey: req.idempotencyKey,
        commandAccepted: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: `Unsupported deliveryAck.outcome "${String(ack.outcome)}".`,
      };
    }

    if (ack.ackId !== null && !isNonEmptyString(ack.ackId)) {
      return {
        ok: false,
        idempotencyKey: req.idempotencyKey,
        commandAccepted: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: 'Command response deliveryAck.ackId must be null or a non-empty string.',
      };
    }

    if (!isNonEmptyString(ack.channel) || !isNonEmptyString(ack.recipient)) {
      return {
        ok: false,
        idempotencyKey: req.idempotencyKey,
        commandAccepted: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage:
          'Command response deliveryAck.channel and recipient must be non-empty strings.',
      };
    }

    const outcome: DeliveryOutcome =
      (ack.outcome as DeliveryOutcome | undefined) ??
      (ack.acknowledged ? 'delivered_acknowledged' : 'failed_delivery');

    // Enforce semantic consistency between outcome, acknowledged, ackId, and top-level ok
    if (outcome === 'delivered_acknowledged') {
      if (!ack.acknowledged || !isNonEmptyString(ack.ackId)) {
        return {
          ok: false,
          idempotencyKey: req.idempotencyKey,
          commandAccepted: false,
          errorCode: 'VALIDATION_ERROR',
          errorMessage:
            'Contradictory deliveryAck: outcome "delivered_acknowledged" requires acknowledged=true and non-empty ackId.',
        };
      }
    } else if (outcome === 'accepted_pending_delivery') {
      if (ack.acknowledged) {
        return {
          ok: false,
          idempotencyKey: req.idempotencyKey,
          commandAccepted: false,
          errorCode: 'VALIDATION_ERROR',
          errorMessage:
            'Contradictory deliveryAck: outcome "accepted_pending_delivery" cannot have acknowledged=true.',
        };
      }
    } else if (outcome === 'failed_delivery' || outcome === 'uncertain_timeout') {
      if (ack.acknowledged || raw.ok === true) {
        return {
          ok: false,
          idempotencyKey: req.idempotencyKey,
          commandAccepted: false,
          errorCode: 'VALIDATION_ERROR',
          errorMessage: `Contradictory deliveryAck: outcome "${outcome}" cannot claim ok=true or acknowledged=true.`,
        };
      }
    }

    validatedDeliveryAck = {
      acknowledged: ack.acknowledged,
      outcome,
      ackId: ack.ackId as string | null,
      channel: ack.channel,
      recipient: ack.recipient,
      error: typeof ack.error === 'string' ? ack.error : undefined,
    };
  } else if (httpOk && raw.ok === true && req.command.type === 'send_reminder') {
    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: false,
      errorCode: 'VALIDATION_ERROR',
      errorMessage:
        'send_reminder response with ok:true must include a valid deliveryAck object.',
    };
  }

  if (!httpOk || raw.ok === false) {
    const rawErrCode = raw.errorCode;
    const validErrorCode: CommandErrorCode =
      typeof rawErrCode === 'string' &&
      VALID_COMMAND_ERROR_CODES.has(rawErrCode as CommandErrorCode)
        ? (rawErrCode as CommandErrorCode)
        : validatedDeliveryAck?.outcome === 'failed_delivery'
        ? 'DELIVERY_FAILED'
        : validatedDeliveryAck?.outcome === 'uncertain_timeout'
        ? 'UNCERTAIN_WRITE_TIMEOUT'
        : 'VALIDATION_ERROR';

    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: typeof raw.commandAccepted === 'boolean' ? raw.commandAccepted : false,
      newRevision: raw.newRevision as number | undefined,
      deliveryAck: validatedDeliveryAck,
      errorCode: validErrorCode,
      errorMessage: isNonEmptyString(raw.errorMessage)
        ? raw.errorMessage
        : `Command rejected by backend (HTTP ${httpStatus}, ${validErrorCode}).`,
    };
  }

  return {
    ok: true,
    idempotencyKey: req.idempotencyKey,
    commandType: req.command.type,
    projectId: req.command.projectId,
    commandAccepted: raw.commandAccepted ?? true,
    deduplicatedReplay: raw.deduplicatedReplay as boolean | undefined,
    newRevision: raw.newRevision as number | undefined,
    acknowledgedAt: raw.acknowledgedAt as string | undefined,
    deliveryAck: validatedDeliveryAck,
  };
}
