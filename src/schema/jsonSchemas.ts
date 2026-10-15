/**
 * @file src/schema/jsonSchemas.ts
 * @description Formal JSON Schema definitions and example payloads for Snapshot and Future Command APIs.
 * Note: These are proposed integration contracts for the existing local Mission Control / projectBoard
 * backend, not claims of already-deployed live endpoints or IPC sockets.
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
    sequence: {
      type: 'integer',
      minimum: 0,
      description: 'Optional monotonic sequence number per source emitter for out-of-order rejection.',
    },
    generatedAt: { type: 'string', format: 'date-time' },
    evaluationThresholds: {
      type: 'object',
      required: ['heartbeatExpirySeconds', 'stalledProgressSeconds'],
      properties: {
        heartbeatExpirySeconds: { type: 'integer', minimum: 10 },
        stalledProgressSeconds: { type: 'integer', minimum: 30 },
        staleFeedWarningSeconds: { type: 'integer', minimum: 10 },
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
        commandEndpointVerified: { type: 'boolean' },
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
        sequence: { type: 'integer', minimum: 0 },
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
      required: [
        'evidenceId',
        'projectId',
        'kind',
        'label',
        'uriOrRef',
        'verified',
        'createdAt',
        'source',
      ],
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
      description:
        'Client-generated key preventing duplicate mutations. If a write times out, the client must refresh the snapshot before deciding whether to replay this key.',
    },
    expectedRevision: {
      type: 'integer',
      minimum: 1,
      description:
        'Project revision expected by operator UI. Rejects with 409 REVISION_CONFLICT if stale.',
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
      status: 'Proposed Read Adapter Endpoint',
      description:
        'Returns a point-in-time MissionControlSnapshot validated at runtime (`validateSnapshotPayload`). Supports bounded polling with AbortSignal timeout, exponential backoff, and background-tab throttling.',
      headers: {
        Accept: 'application/json',
        'X-Mission-Control-Schema': CONTRACT_SCHEMA_VERSION,
      },
    },
    {
      method: 'POST',
      path: '/api/mission-control/v1/commands',
      status: 'Proposed Future Write Contract (Disabled in Live Mode Until Verified)',
      description:
        'Executes an operator mutation with idempotency key and expectedRevision. Distinguishes commandAccepted (persisted in projectBoard) from deliveryAck (whether downstream owner notification actually succeeded).',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': 'cmd-2026-10-14-98f1a2',
      },
    },
  ],
  errorResponses: {
    revisionConflict409: {
      ok: false,
      idempotencyKey: 'cmd-2026-10-14-98f1a2',
      commandAccepted: false,
      errorCode: 'REVISION_CONFLICT',
      errorMessage:
        'Project prj-auth-token-broker was updated to revision 8 by another process. Refresh snapshot before applying priority change.',
    },
    acceptedButDeliveryPending202: {
      ok: true,
      idempotencyKey: 'cmd-2026-10-14-44a8c1',
      commandAccepted: true,
      newRevision: 13,
      deliveryAck: {
        acknowledged: false,
        outcome: 'accepted_pending_delivery',
        ackId: null,
        channel: 'projectBoard-outbox',
        recipient: 'dot',
      },
    },
    reminderDeliveryFailed502: {
      ok: false,
      idempotencyKey: 'cmd-2026-10-14-77c3b0',
      commandAccepted: true,
      newRevision: 5,
      deliveryAck: {
        acknowledged: false,
        outcome: 'failed_delivery',
        ackId: null,
        channel: 'local-notifier-adapter',
        recipient: 'dot/macos-automation',
        error: 'Target owner queue rejected message (EAGAIN).',
      },
      errorCode: 'DELIVERY_FAILED',
      errorMessage:
        'Command was recorded, but reminder was NOT delivered to dot/macos-automation.',
    },
    uncertainWriteTimeout: {
      ok: false,
      idempotencyKey: 'cmd-2026-10-14-timeout-01',
      commandAccepted: false,
      deliveryAck: {
        acknowledged: false,
        outcome: 'uncertain_timeout',
        ackId: null,
        channel: 'live-http-command',
        recipient: 'dot',
        error: 'HTTP request timed out after 8000ms. Outcome is UNCERTAIN; do not blindly retry.',
      },
      errorCode: 'UNCERTAIN_WRITE_TIMEOUT',
      errorMessage:
        'Command request timed out. Refresh snapshot before retrying to prevent duplicate writes.',
    },
  },
};
