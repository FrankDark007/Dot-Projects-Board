/**
 * @file src/schema/validator.ts
 * @description Strict runtime validation and ordering check for incoming MissionControlSnapshot payloads.
 * Validates schemaVersion, required fields, unique primary IDs, cross-entity references,
 * enum domains, timestamps (including rejecting implausibly future snapshot generation times),
 * numeric values, and source sequence/timestamp ordering.
 */

import { evaluateTimestamp } from '../utils/timeFormat';
import { CONTRACT_SCHEMA_VERSION, MissionControlSnapshot } from './contract';

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
const VALID_RUN_STATUS = new Set([
  'running',
  'succeeded_turn',
  'failed',
  'crashed',
  'stalled',
  'cancelled',
]);
const VALID_DECISION_STATUS = new Set(['open', 'resolved', 'superseded']);

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

function isValidIsoString(val: unknown): val is string {
  if (typeof val !== 'string' || val.trim().length === 0) return false;
  return !Number.isNaN(Date.parse(val));
}

function validateSourceAttribution(source: unknown, path: string, errors: string[]): boolean {
  if (!isRecord(source)) {
    errors.push(`${path}.source must be an object.`);
    return false;
  }
  if (!isNonEmptyString(source.sourceId)) {
    errors.push(`${path}.source.sourceId must be a non-empty string.`);
  }
  if (!isNonEmptyString(source.emitterName)) {
    errors.push(`${path}.source.emitterName must be a non-empty string.`);
  }
  if (!isValidIsoString(source.observedAt)) {
    errors.push(`${path}.source.observedAt must be a valid ISO-8601 timestamp.`);
  }
  if (
    source.sequence !== undefined &&
    (typeof source.sequence !== 'number' || !Number.isInteger(source.sequence) || source.sequence < 0)
  ) {
    errors.push(`${path}.source.sequence must be a non-negative integer when present.`);
  }
  return errors.length === 0;
}

/**
 * Validates an untrusted JSON payload at runtime before accepting it as a `MissionControlSnapshot`.
 * Also enforces monotonic ordering when `previousValidSnapshot` is supplied.
 */
export function validateSnapshotPayload(
  raw: unknown,
  options?: {
    referenceNowIso?: string;
    previousValidSnapshot?: MissionControlSnapshot | null;
  }
): SnapshotValidationResult {
  const errors: string[] = [];

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
  if (
    typeof hbSec !== 'number' ||
    !Number.isFinite(hbSec) ||
    hbSec <= 0 ||
    typeof stallSec !== 'number' ||
    !Number.isFinite(stallSec) ||
    stallSec <= 0
  ) {
    return {
      valid: false,
      errorCode: 'INVALID_THRESHOLDS',
      errors: [
        'evaluationThresholds.heartbeatExpirySeconds and stalledProgressSeconds must be positive numbers.',
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
  }

  // Check arrays exist
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
  const workerIds = new Set<string>();
  const taskIds = new Set<string>();
  const runIds = new Set<string>();
  const decisionIds = new Set<string>();
  const evidenceIds = new Set<string>();

  // Validate Projects
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

    // Check against revision regression for same project if previousValidSnapshot exists
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

    if (!isNonEmptyString(p.name)) errors.push(`${path}.name is required.`);
    if (!isNonEmptyString(p.owner)) errors.push(`${path}.owner is required.`);
    if (!VALID_PRIORITIES.has(String(p.priority))) {
      errors.push(`${path}.priority ("${String(p.priority)}") is invalid.`);
    }
    if (typeof p.archived !== 'boolean') {
      errors.push(`${path}.archived must be a boolean.`);
    }
    if (!VALID_ACCEPTANCE_STATUS.has(String(p.acceptanceStatus))) {
      errors.push(`${path}.acceptanceStatus ("${String(p.acceptanceStatus)}") is invalid.`);
    }
    if (typeof p.workerCoverageKnown !== 'boolean') {
      errors.push(`${path}.workerCoverageKnown must be a boolean.`);
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
      if (typeof p.cost.isEstimate !== 'boolean') {
        errors.push(`${path}.cost.isEstimate must be a boolean.`);
      }
      if (!Array.isArray(p.cost.untrackedSources)) {
        errors.push(`${path}.cost.untrackedSources must be an array.`);
      }
    }

    // Validate Milestones
    if (!Array.isArray(p.milestones)) {
      errors.push(`${path}.milestones must be an array.`);
    } else {
      const msIds = new Set<string>();
      for (let mIdx = 0; mIdx < p.milestones.length; mIdx++) {
        const m = p.milestones[mIdx];
        const mPath = `${path}.milestones[${mIdx}]`;
        if (!isRecord(m)) {
          errors.push(`${mPath} must be an object.`);
          continue;
        }
        if (!isNonEmptyString(m.milestoneId)) {
          errors.push(`${mPath}.milestoneId is required.`);
        } else if (msIds.has(m.milestoneId)) {
          return {
            valid: false,
            errorCode: 'DUPLICATE_ID',
            errors: [`Duplicate milestoneId "${m.milestoneId}" in project "${String(p.projectId)}".`],
          };
        } else {
          msIds.add(m.milestoneId);
        }

        if (!VALID_MILESTONE_STATUS.has(String(m.status))) {
          errors.push(`${mPath}.status ("${String(m.status)}") is invalid.`);
        }
        if (!Array.isArray(m.remainingSteps)) {
          errors.push(`${mPath}.remainingSteps must be an array.`);
        }
        if (!Array.isArray(m.acceptanceGates)) {
          errors.push(`${mPath}.acceptanceGates must be an array.`);
        } else {
          const gateIds = new Set<string>();
          for (let gIdx = 0; gIdx < m.acceptanceGates.length; gIdx++) {
            const g = m.acceptanceGates[gIdx];
            if (!isRecord(g)) {
              errors.push(`${mPath}.acceptanceGates[${gIdx}] must be an object.`);
              continue;
            }
            if (!isNonEmptyString(g.gateId)) {
              errors.push(`${mPath}.acceptanceGates[${gIdx}].gateId is required.`);
            } else if (gateIds.has(g.gateId)) {
              return {
                valid: false,
                errorCode: 'DUPLICATE_ID',
                errors: [`Duplicate gateId "${g.gateId}" in milestone "${String(m.milestoneId)}".`],
              };
            } else {
              gateIds.add(g.gateId);
            }
            if (!VALID_GATE_STATUS.has(String(g.status))) {
              errors.push(`${mPath}.acceptanceGates[${gIdx}].status is invalid.`);
            }
            if (typeof g.required !== 'boolean') {
              errors.push(`${mPath}.acceptanceGates[${gIdx}].required must be a boolean.`);
            }
          }
        }
      }

      if (p.currentMilestoneId !== null && p.currentMilestoneId !== undefined) {
        if (typeof p.currentMilestoneId !== 'string' || !msIds.has(p.currentMilestoneId)) {
          return {
            valid: false,
            errorCode: 'BROKEN_REFERENCE',
            errors: [
              `${path}.currentMilestoneId ("${String(
                p.currentMilestoneId
              )}") does not exist in project milestones.`,
            ],
          };
        }
      }
    }

    validateSourceAttribution(p.source, path, errors);
  }

  // Validate Workers
  const workers = raw.workers as unknown[];
  for (let i = 0; i < workers.length; i++) {
    const w = workers[i];
    const path = `workers[${i}]`;
    if (!isRecord(w)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(w.workerId)) {
      errors.push(`${path}.workerId is required.`);
    } else if (workerIds.has(w.workerId)) {
      return {
        valid: false,
        errorCode: 'DUPLICATE_ID',
        errors: [`Duplicate workerId "${w.workerId}" in snapshot.`],
      };
    } else {
      workerIds.add(w.workerId);
    }

    if (w.projectId !== null && (!isNonEmptyString(w.projectId) || !projectIds.has(w.projectId))) {
      return {
        valid: false,
        errorCode: 'BROKEN_REFERENCE',
        errors: [`${path}.projectId ("${String(w.projectId)}") references unknown project.`],
      };
    }
    if (!VALID_RAW_WORKER_STATUS.has(String(w.rawStatus))) {
      errors.push(`${path}.rawStatus ("${String(w.rawStatus)}") is invalid.`);
    }
    if (typeof w.coverageAvailable !== 'boolean') {
      errors.push(`${path}.coverageAvailable must be a boolean.`);
    }
    validateSourceAttribution(w.source, path, errors);
  }

  // Validate Tasks
  const tasks = raw.tasks as unknown[];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const path = `tasks[${i}]`;
    if (!isRecord(t)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(t.taskId)) {
      errors.push(`${path}.taskId is required.`);
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
      return {
        valid: false,
        errorCode: 'BROKEN_REFERENCE',
        errors: [`${path}.projectId ("${String(t.projectId)}") references unknown project.`],
      };
    }
    validateSourceAttribution(t.source, path, errors);
  }

  // Validate Runs
  const runs = raw.runs as unknown[];
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const path = `runs[${i}]`;
    if (!isRecord(r)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(r.runId)) {
      errors.push(`${path}.runId is required.`);
    } else if (runIds.has(r.runId)) {
      return {
        valid: false,
        errorCode: 'DUPLICATE_ID',
        errors: [`Duplicate runId "${r.runId}".`],
      };
    } else {
      runIds.add(r.runId);
    }
    if (!isNonEmptyString(r.projectId) || !projectIds.has(r.projectId)) {
      return {
        valid: false,
        errorCode: 'BROKEN_REFERENCE',
        errors: [`${path}.projectId ("${String(r.projectId)}") references unknown project.`],
      };
    }
    if (!VALID_RUN_STATUS.has(String(r.status))) {
      errors.push(`${path}.status ("${String(r.status)}") is invalid.`);
    }
    if (typeof r.turnCount !== 'number' || r.turnCount < 0) {
      errors.push(`${path}.turnCount must be a non-negative number.`);
    }
    validateSourceAttribution(r.source, path, errors);
  }

  // Validate Decisions
  const decisions = raw.decisions as unknown[];
  for (let i = 0; i < decisions.length; i++) {
    const d = decisions[i];
    const path = `decisions[${i}]`;
    if (!isRecord(d)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(d.decisionId)) {
      errors.push(`${path}.decisionId is required.`);
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
      return {
        valid: false,
        errorCode: 'BROKEN_REFERENCE',
        errors: [`${path}.projectId ("${String(d.projectId)}") references unknown project.`],
      };
    }
    if (!VALID_DECISION_STATUS.has(String(d.status))) {
      errors.push(`${path}.status ("${String(d.status)}") is invalid.`);
    }
    if (!isValidIsoString(d.createdAt)) {
      errors.push(`${path}.createdAt must be a valid ISO timestamp.`);
    }
    validateSourceAttribution(d.source, path, errors);
  }

  // Validate Evidence
  const evidence = raw.evidence as unknown[];
  for (let i = 0; i < evidence.length; i++) {
    const ev = evidence[i];
    const path = `evidence[${i}]`;
    if (!isRecord(ev)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(ev.evidenceId)) {
      errors.push(`${path}.evidenceId is required.`);
    } else if (evidenceIds.has(ev.evidenceId)) {
      return {
        valid: false,
        errorCode: 'DUPLICATE_ID',
        errors: [`Duplicate evidenceId "${ev.evidenceId}".`],
      };
    } else {
      evidenceIds.add(ev.evidenceId);
    }
    if (!isNonEmptyString(ev.projectId) || !projectIds.has(ev.projectId)) {
      return {
        valid: false,
        errorCode: 'BROKEN_REFERENCE',
        errors: [`${path}.projectId ("${String(ev.projectId)}") references unknown project.`],
      };
    }
    validateSourceAttribution(ev.source, path, errors);
  }

  // Validate Events
  const events = raw.events as unknown[];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const path = `events[${i}]`;
    if (!isRecord(e)) {
      errors.push(`${path} must be an object.`);
      continue;
    }
    if (!isNonEmptyString(e.eventId)) {
      errors.push(`${path}.eventId is required.`);
    }
    if (!isNonEmptyString(e.projectId) || !projectIds.has(e.projectId)) {
      return {
        valid: false,
        errorCode: 'BROKEN_REFERENCE',
        errors: [`${path}.projectId ("${String(e.projectId)}") references unknown project.`],
      };
    }
    if (!isValidIsoString(e.timestamp)) {
      errors.push(`${path}.timestamp must be a valid ISO timestamp.`);
    }
    validateSourceAttribution(e.source, path, errors);
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
