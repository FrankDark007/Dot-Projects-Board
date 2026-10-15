/**
 * @file src/schema/jsonSchemas.ts
 * @description Formal JSON Schema definitions and example payloads for Snapshot, Event Stream, and Command APIs.
 */

import { CONTRACT_SCHEMA_VERSION } from './contract';

export const SNAPSHOT_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://mission-control.local/schemas/dot.mission-control.v1.snapshot.json',
  title: 'MissionControlSnapshot',
  type: 'object',
  required: [
    'schemaVersion',
    'snapshotId',
    'generatedAt',
    'evaluationThresholds',
    'capabilities',
    'projects',
    'tasks',
    'workers',
    'runs',
    'decisions',
    'evidence',
    'events',
  ],
  properties: {
    schemaVersion: { const: CONTRACT_SCHEMA_VERSION },
    snapshotId: { type: 'string', minLength: 1 },
    generatedAt: { type: 'string', format: 'date-time' },
    evaluationThresholds: {
      type: 'object',
      required: ['heartbeatExpirySeconds', 'stalledProgressSeconds'],
      properties: {
        heartbeatExpirySeconds: { type: 'integer', minimum: 10 },
        stalledProgressSeconds: { type: 'integer', minimum: 30 },
      },
    },
    capabilities: {
      type: 'object',
      required: [
        'canArchive',
        'canChangePriority',
        'canAddNote',
        'canSendReminder',
        'canResolveDecision',
      ],
      properties: {
        canArchive: { type: 'boolean' },
        canChangePriority: { type: 'boolean' },
        canAddNote: { type: 'boolean' },
        canSendReminder: { type: 'boolean' },
        canResolveDecision: { type: 'boolean' },
        reasonIfDisabled: { type: 'string' },
      },
    },
    projects: { type: 'array', items: { $ref: '#/$defs/ProjectRecord' } },
    tasks: { type: 'array', items: { $ref: '#/$defs/TaskItem' } },
    workers: { type: 'array', items: { $ref: '#/$defs/WorkerRecord' } },
    runs: { type: 'array', items: { $ref: '#/$defs/WorkerRunRecord' } },
    decisions: { type: 'array', items: { $ref: '#/$defs/DecisionRequest' } },
    evidence: { type: 'array', items: { $ref: '#/$defs/EvidenceLink' } },
    events: { type: 'array', items: { $ref: '#/$defs/ActivityEvent' } },
  },
  $defs: {
    SourceAttribution: {
      type: 'object',
      required: ['sourceId', 'kind', 'emitterName', 'observedAt'],
      properties: {
        sourceId: { type: 'string' },
        kind: {
          enum: [
            'local_orchestrator',
            'md_worker_daemon',
            'ci_verifier',
            'git_observer',
            'human_operator',
            'synthetic_demo',
          ],
        },
        emitterName: { type: 'string' },
        observedAt: { type: 'string', format: 'date-time' },
      },
    },
    ProjectRecord: {
      type: 'object',
      required: [
        'projectId',
        'revision',
        'name',
        'owner',
        'priority',
        'archived',
        'currentScope',
        'nextAction',
        'acceptanceStatus',
        'workerCoverageKnown',
        'cost',
        'milestones',
        'source',
      ],
    },
    TaskItem: {
      type: 'object',
      required: ['taskId', 'projectId', 'milestoneId', 'title', 'owner', 'status', 'source'],
    },
    WorkerRecord: {
      type: 'object',
      required: [
        'workerId',
        'name',
        'rawStatus',
        'lastHeartbeatAt',
        'lastMeaningfulProgressAt',
        'coverageAvailable',
        'source',
      ],
    },
    WorkerRunRecord: {
      type: 'object',
      required: ['runId', 'workerId', 'projectId', 'startedAt', 'status', 'turnCount', 'source'],
    },
    DecisionRequest: {
      type: 'object',
      required: [
        'decisionId',
        'projectId',
        'kind',
        'status',
        'exactPromptOrFailure',
        'createdAt',
        'owner',
        'recommendedNextStep',
        'source',
      ],
    },
    EvidenceLink: {
      type: 'object',
      required: ['evidenceId', 'projectId', 'kind', 'label', 'uriOrRef', 'verified', 'createdAt', 'source'],
    },
    ActivityEvent: {
      type: 'object',
      required: [
        'eventId',
        'projectId',
        'timestamp',
        'category',
        'actor',
        'title',
        'isMeaningfulProgress',
        'source',
      ],
    },
  },
} as const;

export const COMMAND_REQUEST_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://mission-control.local/schemas/dot.mission-control.v1.command-request.json',
  title: 'OperatorCommandRequest',
  type: 'object',
  required: ['schemaVersion', 'idempotencyKey', 'expectedRevision', 'issuedAt', 'command'],
  properties: {
    schemaVersion: { const: CONTRACT_SCHEMA_VERSION },
    idempotencyKey: {
      type: 'string',
      description: 'UUID or deterministic client key preventing duplicate writes on retry.',
    },
    expectedRevision: {
      type: 'integer',
      minimum: 1,
      description: 'Project revision expected by operator UI. Rejects with 409 REVISION_CONFLICT if stale.',
    },
    issuedAt: { type: 'string', format: 'date-time' },
    command: {
      type: 'object',
      required: ['type', 'projectId'],
      properties: {
        type: {
          enum: [
            'archive_project',
            'set_priority',
            'add_note',
            'send_reminder',
            'resolve_decision',
          ],
        },
        projectId: { type: 'string' },
      },
    },
  },
} as const;

export const CONTRACT_DOCUMENTATION_EXAMPLES = {
  endpoints: [
    {
      method: 'GET',
      path: '/api/mission-control/v1/snapshot',
      description:
        'Returns a point-in-time MissionControlSnapshot. Supports If-None-Match (ETag) and bounded polling with exponential backoff and background-tab throttling.',
      headers: {
        Authorization: 'Bearer <local-session-token>',
        Accept: 'application/json',
      },
    },
    {
      method: 'GET (SSE)',
      path: '/api/mission-control/v1/events?sinceEventId=<last_event_id>',
      description:
        'Optional single Server-Sent Events stream emitting deduplicated ActivityEvent and WorkerRecord deltas. Reconnects with Last-Event-ID.',
      headers: {
        Authorization: 'Bearer <local-session-token>',
        Accept: 'text/event-stream',
      },
    },
    {
      method: 'POST',
      path: '/api/mission-control/v1/commands',
      description:
        'Executes an operator control action (archive/undo, priority change, note, owner reminder, decision resolution) with idempotency and revision conflict checks.',
      headers: {
        Authorization: 'Bearer <local-session-token>',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'cmd-2026-10-14-98f1a2',
      },
    },
  ],
  errorResponses: {
    revisionConflict409: {
      ok: false,
      idempotencyKey: 'cmd-2026-10-14-98f1a2',
      errorCode: 'REVISION_CONFLICT',
      errorMessage:
        'Project prj-dot-router was updated to revision 14 by dot-supervisor. Refresh snapshot before applying priority change.',
    },
    reminderDeliveryFailed502: {
      ok: false,
      idempotencyKey: 'cmd-2026-10-14-77c3b0',
      deliveryAck: {
        acknowledged: false,
        ackId: null,
        channel: 'local-agent-ipc',
        recipient: 'dot',
        error: 'IPC socket /tmp/dot-supervisor.sock timed out after 3000ms (ENOENT).',
      },
      errorCode: 'DELIVERY_FAILED',
      errorMessage: 'Reminder was NOT delivered to dot: IPC socket unavailable.',
    },
  },
};
