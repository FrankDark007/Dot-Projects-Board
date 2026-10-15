/**
 * @file src/adapters/dataAdapter.ts
 * @description Clean adapter layer separating Demo Mode (synthetic fixtures) and
 * Live Mode (configurable authenticated local Mission Control adapter).
 *
 * CRITICAL INVARIANTS:
 * 1. Live mode NEVER silently substitutes demo data or invokes the demo controller.
 * 2. Until a valid real response passes `validateSnapshotPayload`, Live mode reports `never_connected`.
 * 3. Malformed or out-of-order responses are rejected while preserving the last valid snapshot with a warning.
 * 4. Overlapping polls are prevented, requests use bounded AbortSignal timeouts, and late responses
 *    from previous endpoints or modes are deterministically ignored.
 * 5. Transport contact health (`lastSuccessfulContactAt`) is tracked separately from snapshot data
 *    freshness (`snapshot.generatedAt`). Repeated HTTP 200 responses serving an old snapshot
 *    never make stale data appear fresh.
 * 6. Live commands recheck connection health and specific backend capability at dispatch, validate
 *    HTTP status, response shape, exact idempotencyKey, and deliveryAck semantics, and never auto-retry timeouts.
 */

import { deduplicateSnapshot } from '../engine/stateEvaluator';
import { createSyntheticSnapshot, REFERENCE_NOW_ISO } from '../fixtures/syntheticFixtures';
import {
  ActivityEvent,
  BackendCapabilities,
  CommandPayload,
  ConnectionHealthState,
  CONTRACT_SCHEMA_VERSION,
  MissionControlSnapshot,
  OperatorCommandRequest,
  OperatorCommandResponse,
  ReminderReceipt,
} from '../schema/contract';
import {
  validateCommandResponsePayload,
  validateSnapshotPayload,
} from '../schema/validator';
import { evaluateTimestamp } from '../utils/timeFormat';

export type DashboardMode = 'demo' | 'live';

export interface LiveAdapterConfig {
  endpointBaseUrl: string; // e.g., "http://127.0.0.1:43110/api/mission-control/v1"
  basePollIntervalMs: number; // e.g., 10000 (10s)
  requestTimeoutMs: number; // e.g., 8000 (8s bounded fetch timeout)
  maxBackoffMs: number; // e.g., 60000 (60s)
  backgroundTabMultiplier: number; // e.g., 4x slower when document.hidden
  withCredentialsCookie: boolean; // Uses HttpOnly same-origin / local session cookie
  enableLiveCommandRoute: boolean; // False by default until local backend command route is verified
}

export const DEFAULT_LIVE_CONFIG: LiveAdapterConfig = {
  endpointBaseUrl: 'http://127.0.0.1:43110/api/mission-control/v1',
  basePollIntervalMs: 10000,
  requestTimeoutMs: 8000,
  maxBackoffMs: 60000,
  backgroundTabMultiplier: 4,
  withCredentialsCookie: true,
  enableLiveCommandRoute: false,
};

export class SnapshotValidationError extends Error {
  public readonly errorCode: string;
  public readonly validationErrors: string[];

  constructor(errorCode: string, validationErrors: string[]) {
    super(`Snapshot validation failed (${errorCode}): ${validationErrors.join('; ')}`);
    this.name = 'SnapshotValidationError';
    this.errorCode = errorCode;
    this.validationErrors = validationErrors;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Checks whether a specific command type is permitted by `BackendCapabilities`.
 */
export function isCommandCapabilitySupported(
  commandType: CommandPayload['type'],
  capabilities: BackendCapabilities | null | undefined
): boolean {
  if (!capabilities) return false;
  switch (commandType) {
    case 'archive_project':
      return capabilities.canArchive === true;
    case 'set_priority':
      return capabilities.canChangePriority === true;
    case 'add_note':
      return capabilities.canAddNote === true;
    case 'send_reminder':
      return capabilities.canSendReminder === true;
    case 'resolve_decision':
      return capabilities.canResolveDecision === true;
    default:
      return false;
  }
}

/**
 * Stateful in-memory controller strictly for DEMO MODE synthetic fixtures and fixture unit tests.
 * Must NEVER be called when the dashboard is in Live Mode.
 */
export class MissionControlDataController {
  private snapshot: MissionControlSnapshot;
  private processedCommands = new Map<string, OperatorCommandResponse>();
  private simulateReminderOutcomeByOwner = new Map<
    string,
    'delivered_acknowledged' | 'accepted_pending_delivery' | 'failed_delivery' | 'uncertain_timeout'
  >([['dot/macos-automation', 'failed_delivery']]);
  private droppedDuplicatesCount = 0;

  constructor(initialSnapshot?: MissionControlSnapshot) {
    const raw = initialSnapshot ?? createSyntheticSnapshot(REFERENCE_NOW_ISO);
    const deduped = deduplicateSnapshot(raw);
    this.snapshot = deduped.snapshot;
    this.droppedDuplicatesCount = deduped.totalDropped;
  }

  public getSnapshot(): MissionControlSnapshot {
    return this.snapshot;
  }

  public getDroppedDuplicatesCount(): number {
    return this.droppedDuplicatesCount;
  }

  public setSimulateReminderFailure(owner: string, shouldFail: boolean): void {
    if (shouldFail) {
      this.simulateReminderOutcomeByOwner.set(owner, 'failed_delivery');
    } else {
      this.simulateReminderOutcomeByOwner.set(owner, 'delivered_acknowledged');
    }
  }

  public setSimulateReminderOutcome(
    owner: string,
    outcome:
      | 'delivered_acknowledged'
      | 'accepted_pending_delivery'
      | 'failed_delivery'
      | 'uncertain_timeout'
  ): void {
    this.simulateReminderOutcomeByOwner.set(owner, outcome);
  }

  public setCapabilities(
    partial: Partial<MissionControlSnapshot['capabilities']>
  ): void {
    this.snapshot = {
      ...this.snapshot,
      capabilities: {
        ...this.snapshot.capabilities,
        ...partial,
      },
    };
  }

  /**
   * Executes a synthetic demo command with idempotency, capability validation,
   * optimistic concurrency (revision conflict check), and explicit acceptance vs delivery semantics.
   */
  public executeCommand(req: OperatorCommandRequest): OperatorCommandResponse {
    const existing = this.processedCommands.get(req.idempotencyKey);
    if (existing) {
      return {
        ...existing,
        deduplicatedReplay: true,
      };
    }

    const { command } = req;
    const projectIndex = this.snapshot.projects.findIndex(
      (p) => p.projectId === command.projectId
    );
    if (projectIndex === -1) {
      return this.recordError(
        req.idempotencyKey,
        'VALIDATION_ERROR',
        `Unknown project ID: ${command.projectId}`
      );
    }

    const project = this.snapshot.projects[projectIndex];

    // Capability check
    const caps = this.snapshot.capabilities;
    if (!isCommandCapabilitySupported(command.type, caps)) {
      return this.recordError(
        req.idempotencyKey,
        'CAPABILITY_UNSUPPORTED',
        caps.reasonIfDisabled ?? `Capability for ${command.type} is disabled.`
      );
    }

    // Optimistic concurrency / revision conflict check
    if (req.expectedRevision !== project.revision) {
      return this.recordError(
        req.idempotencyKey,
        'REVISION_CONFLICT',
        `Conflict on ${project.name}: expected revision ${req.expectedRevision}, but current revision is ${project.revision}. Refresh before retrying.`
      );
    }

    const nowIso = req.issuedAt || REFERENCE_NOW_ISO;
    const nextRevision = project.revision + 1;

    if (command.type === 'archive_project') {
      const updatedProject = {
        ...project,
        revision: nextRevision,
        archived: command.archive,
        archivedAt: command.archive ? nowIso : null,
      };
      this.updateProjectAndAppendEvent(updatedProject, {
        eventId: `evt-cmd-${req.idempotencyKey}`,
        projectId: project.projectId,
        timestamp: nowIso,
        category: 'operator_command',
        actor: 'you (demo)',
        title: command.archive
          ? `Archived project in demo state (files & running workers untouched)`
          : `Restored project from archive (Undo)`,
        detail:
          command.reason ||
          'Visibility updated in synthetic fixture; zero files deleted and zero jobs cancelled.',
        isMeaningfulProgress: false,
        source: {
          sourceId: `src-cmd-${req.idempotencyKey}`,
          kind: 'synthetic_demo',
          emitterName: 'demo-controller',
          observedAt: nowIso,
        },
      });

      const res: OperatorCommandResponse = {
        ok: true,
        idempotencyKey: req.idempotencyKey,
        commandType: command.type,
        projectId: project.projectId,
        commandAccepted: true,
        newRevision: nextRevision,
        acknowledgedAt: nowIso,
      };
      this.processedCommands.set(req.idempotencyKey, res);
      return res;
    }

    if (command.type === 'set_priority') {
      const updatedProject = {
        ...project,
        revision: nextRevision,
        priority: command.priority,
      };
      this.updateProjectAndAppendEvent(updatedProject, {
        eventId: `evt-cmd-${req.idempotencyKey}`,
        projectId: project.projectId,
        timestamp: nowIso,
        category: 'operator_command',
        actor: 'you (demo)',
        title: `Changed project priority from ${project.priority} to ${command.priority}`,
        detail: `Updated scheduling priority metadata to ${command.priority}.`,
        isMeaningfulProgress: false,
        source: {
          sourceId: `src-cmd-${req.idempotencyKey}`,
          kind: 'synthetic_demo',
          emitterName: 'demo-controller',
          observedAt: nowIso,
        },
      });

      const res: OperatorCommandResponse = {
        ok: true,
        idempotencyKey: req.idempotencyKey,
        commandType: command.type,
        projectId: project.projectId,
        commandAccepted: true,
        newRevision: nextRevision,
        acknowledgedAt: nowIso,
      };
      this.processedCommands.set(req.idempotencyKey, res);
      return res;
    }

    if (command.type === 'add_note') {
      if (!command.body.trim()) {
        return this.recordError(
          req.idempotencyKey,
          'VALIDATION_ERROR',
          'Note body cannot be empty.'
        );
      }
      const newNote = {
        noteId: `note-${req.idempotencyKey}`,
        projectId: project.projectId,
        author: command.author || 'you',
        createdAt: nowIso,
        body: command.body.trim(),
      };
      const updatedProject = {
        ...project,
        revision: nextRevision,
        notes: [newNote, ...project.notes],
      };
      this.updateProjectAndAppendEvent(updatedProject, {
        eventId: `evt-cmd-${req.idempotencyKey}`,
        projectId: project.projectId,
        timestamp: nowIso,
        category: 'operator_command',
        actor: newNote.author,
        title: `Added operator note`,
        detail: newNote.body,
        isMeaningfulProgress: false,
        source: {
          sourceId: `src-cmd-${req.idempotencyKey}`,
          kind: 'synthetic_demo',
          emitterName: 'demo-controller',
          observedAt: nowIso,
        },
      });

      const res: OperatorCommandResponse = {
        ok: true,
        idempotencyKey: req.idempotencyKey,
        commandType: command.type,
        projectId: project.projectId,
        commandAccepted: true,
        newRevision: nextRevision,
        acknowledgedAt: nowIso,
      };
      this.processedCommands.set(req.idempotencyKey, res);
      return res;
    }

    if (command.type === 'send_reminder') {
      const outcome =
        this.simulateReminderOutcomeByOwner.get(command.targetOwner) ??
        'delivered_acknowledged';

      if (outcome === 'failed_delivery') {
        const failedReceipt: ReminderReceipt = {
          reminderId: `rem-${req.idempotencyKey}`,
          projectId: project.projectId,
          targetOwner: command.targetOwner,
          sentAt: nowIso,
          status: 'failed_delivery',
          deliveryChannel: 'macos-automation-bridge (demo)',
          ackId: null,
          errorMessage: `Delivery to ${command.targetOwner} failed: bridge queue unacknowledged (EAGAIN).`,
        };
        const updatedProject = {
          ...project,
          revision: nextRevision,
          reminders: [failedReceipt, ...project.reminders],
        };
        this.updateProjectAndAppendEvent(updatedProject, {
          eventId: `evt-cmd-${req.idempotencyKey}`,
          projectId: project.projectId,
          timestamp: nowIso,
          category: 'operator_command',
          actor: 'you (demo)',
          title: `Reminder delivery FAILED for ${command.targetOwner}`,
          detail: failedReceipt.errorMessage!,
          isMeaningfulProgress: false,
          source: {
            sourceId: `src-cmd-${req.idempotencyKey}`,
            kind: 'synthetic_demo',
            emitterName: 'demo-controller',
            observedAt: nowIso,
          },
        });

        const failRes: OperatorCommandResponse = {
          ok: false,
          idempotencyKey: req.idempotencyKey,
          commandType: command.type,
          projectId: project.projectId,
          commandAccepted: true,
          newRevision: nextRevision,
          deliveryAck: {
            acknowledged: false,
            outcome: 'failed_delivery',
            ackId: null,
            channel: 'macos-automation-bridge (demo)',
            recipient: command.targetOwner,
            error: failedReceipt.errorMessage,
          },
          errorCode: 'DELIVERY_FAILED',
          errorMessage: `Command recorded, but delivery to ${command.targetOwner} FAILED. Owner was NOT notified.`,
        };
        this.processedCommands.set(req.idempotencyKey, failRes);
        return failRes;
      }

      if (outcome === 'accepted_pending_delivery') {
        const queuedReceipt: ReminderReceipt = {
          reminderId: `rem-${req.idempotencyKey}`,
          projectId: project.projectId,
          targetOwner: command.targetOwner,
          sentAt: nowIso,
          status: 'accepted_pending_delivery',
          deliveryChannel: 'synthetic-demo-queue',
          ackId: null,
          errorMessage: 'Command accepted & queued; recipient has not acknowledged delivery yet.',
        };
        const updatedProject = {
          ...project,
          revision: nextRevision,
          reminders: [queuedReceipt, ...project.reminders],
        };
        this.updateProjectAndAppendEvent(updatedProject, {
          eventId: `evt-cmd-${req.idempotencyKey}`,
          projectId: project.projectId,
          timestamp: nowIso,
          category: 'operator_command',
          actor: 'you (demo)',
          title: `Reminder queued for ${command.targetOwner} (awaiting delivery ack)`,
          detail: command.message,
          isMeaningfulProgress: false,
          source: {
            sourceId: `src-cmd-${req.idempotencyKey}`,
            kind: 'synthetic_demo',
            emitterName: 'demo-controller',
            observedAt: nowIso,
          },
        });

        const pendingRes: OperatorCommandResponse = {
          ok: true,
          idempotencyKey: req.idempotencyKey,
          commandType: command.type,
          projectId: project.projectId,
          commandAccepted: true,
          newRevision: nextRevision,
          acknowledgedAt: nowIso,
          deliveryAck: {
            acknowledged: false,
            outcome: 'accepted_pending_delivery',
            ackId: null,
            channel: 'synthetic-demo-queue',
            recipient: command.targetOwner,
          },
        };
        this.processedCommands.set(req.idempotencyKey, pendingRes);
        return pendingRes;
      }

      if (outcome === 'uncertain_timeout') {
        const timeoutRes: OperatorCommandResponse = {
          ok: false,
          idempotencyKey: req.idempotencyKey,
          commandType: command.type,
          projectId: project.projectId,
          commandAccepted: false,
          deliveryAck: {
            acknowledged: false,
            outcome: 'uncertain_timeout',
            ackId: null,
            channel: 'synthetic-demo-notifier',
            recipient: command.targetOwner,
            error:
              'Write request timed out before response; outcome is uncertain. Do not blindly retry without refreshing snapshot.',
          },
          errorCode: 'UNCERTAIN_WRITE_TIMEOUT',
          errorMessage:
            'Write timed out with uncertain outcome. Refresh snapshot before retrying to avoid duplicate side effects.',
        };
        this.processedCommands.set(req.idempotencyKey, timeoutRes);
        return timeoutRes;
      }

      // Delivered & Acknowledged in synthetic demo
      const ackId = `ack-demo-${req.idempotencyKey.slice(-6)}`;
      const ackReceipt: ReminderReceipt = {
        reminderId: `rem-${req.idempotencyKey}`,
        projectId: project.projectId,
        targetOwner: command.targetOwner,
        sentAt: nowIso,
        status: 'acknowledged',
        deliveryChannel: 'synthetic-demo-notifier',
        ackId,
      };
      const updatedProject = {
        ...project,
        revision: nextRevision,
        reminders: [ackReceipt, ...project.reminders],
      };
      this.updateProjectAndAppendEvent(updatedProject, {
        eventId: `evt-cmd-${req.idempotencyKey}`,
        projectId: project.projectId,
        timestamp: nowIso,
        category: 'operator_command',
        actor: 'you (demo)',
        title: `[Demo Simulation] Reminder acknowledged by ${command.targetOwner} (${ackId})`,
        detail: command.message,
        isMeaningfulProgress: false,
        source: {
          sourceId: `src-cmd-${req.idempotencyKey}`,
          kind: 'synthetic_demo',
          emitterName: 'demo-controller',
          observedAt: nowIso,
        },
      });

      const okRes: OperatorCommandResponse = {
        ok: true,
        idempotencyKey: req.idempotencyKey,
        commandType: command.type,
        projectId: project.projectId,
        commandAccepted: true,
        newRevision: nextRevision,
        acknowledgedAt: nowIso,
        deliveryAck: {
          acknowledged: true,
          outcome: 'delivered_acknowledged',
          ackId,
          channel: 'synthetic-demo-notifier',
          recipient: command.targetOwner,
        },
      };
      this.processedCommands.set(req.idempotencyKey, okRes);
      return okRes;
    }

    if (command.type === 'resolve_decision') {
      const decisionIdx = this.snapshot.decisions.findIndex(
        (d) => d.decisionId === command.decisionId && d.projectId === project.projectId
      );
      if (decisionIdx === -1) {
        return this.recordError(
          req.idempotencyKey,
          'VALIDATION_ERROR',
          `Decision ${command.decisionId} not found on project ${project.projectId}.`
        );
      }

      const targetDecision = this.snapshot.decisions[decisionIdx];
      const updatedDecision = {
        ...targetDecision,
        status: 'resolved' as const,
        resolvedAt: nowIso,
        resolutionNote: command.selectedOption
          ? `${command.selectedOption} — ${command.resolutionNote}`.trim()
          : command.resolutionNote,
      };

      const nextDecisions = [...this.snapshot.decisions];
      nextDecisions[decisionIdx] = updatedDecision;

      const updatedProject = {
        ...project,
        revision: nextRevision,
        nextAction: `Decision "${targetDecision.decisionId}" recorded in demo state; awaiting next worker run verification.`,
      };

      this.snapshot = {
        ...this.snapshot,
        decisions: nextDecisions,
      };

      this.updateProjectAndAppendEvent(updatedProject, {
        eventId: `evt-cmd-${req.idempotencyKey}`,
        projectId: project.projectId,
        timestamp: nowIso,
        category: 'operator_command',
        actor: 'you (demo)',
        title: `Resolved decision: ${command.selectedOption || command.resolutionNote}`,
        detail: `Recorded resolution for ${targetDecision.decisionId}.`,
        isMeaningfulProgress: true,
        source: {
          sourceId: `src-cmd-${req.idempotencyKey}`,
          kind: 'synthetic_demo',
          emitterName: 'demo-controller',
          observedAt: nowIso,
        },
      });

      const res: OperatorCommandResponse = {
        ok: true,
        idempotencyKey: req.idempotencyKey,
        commandType: command.type,
        projectId: project.projectId,
        commandAccepted: true,
        newRevision: nextRevision,
        acknowledgedAt: nowIso,
      };
      this.processedCommands.set(req.idempotencyKey, res);
      return res;
    }

    return this.recordError(req.idempotencyKey, 'VALIDATION_ERROR', 'Unsupported command.');
  }

  private recordError(
    idempotencyKey: string,
    errorCode: NonNullable<OperatorCommandResponse['errorCode']>,
    errorMessage: string
  ): OperatorCommandResponse {
    const res: OperatorCommandResponse = {
      ok: false,
      idempotencyKey,
      errorCode,
      errorMessage,
    };
    this.processedCommands.set(idempotencyKey, res);
    return res;
  }

  private updateProjectAndAppendEvent(
    updatedProject: MissionControlSnapshot['projects'][number],
    newEvent: ActivityEvent
  ): void {
    const projects = this.snapshot.projects.map((p) =>
      p.projectId === updatedProject.projectId ? updatedProject : p
    );
    this.snapshot = {
      ...this.snapshot,
      projects,
      events: [newEvent, ...this.snapshot.events],
    };
  }
}

/**
 * Performs a bounded live fetch from the configured local Mission Control endpoint
 * with an AbortSignal timeout and strict runtime schema + ordering validation.
 * Never returns synthetic demo data on failure.
 */
export async function fetchLiveSnapshot(
  config: LiveAdapterConfig,
  options?: {
    signal?: AbortSignal;
    referenceNowIso?: string;
    previousValidSnapshot?: MissionControlSnapshot | null;
    fetchImpl?: FetchLike;
  }
): Promise<MissionControlSnapshot> {
  const fetchFn: FetchLike = options?.fetchImpl ?? ((input, init) => fetch(input, init));
  const url = `${config.endpointBaseUrl.replace(/\/$/, '')}/snapshot`;

  const timeoutController = new AbortController();
  const timeoutMs = config.requestTimeoutMs > 0 ? config.requestTimeoutMs : 8000;
  let timedOut = false;

  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  const onCallerAbort = () => {
    timeoutController.abort();
  };

  if (options?.signal) {
    if (options.signal.aborted) {
      globalThis.clearTimeout(timer);
      throw new Error('Request aborted before start.');
    }
    options.signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    const response = await fetchFn(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Mission-Control-Schema': CONTRACT_SCHEMA_VERSION,
      },
      credentials: config.withCredentialsCookie ? 'include' : 'same-origin',
      signal: timeoutController.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText} from ${url}`);
    }

    const body: unknown = await response.json();
    const validation = validateSnapshotPayload(body, {
      referenceNowIso: options?.referenceNowIso,
      previousValidSnapshot: options?.previousValidSnapshot,
    });

    if (!validation.valid || !validation.snapshot) {
      throw new SnapshotValidationError(
        validation.errorCode || 'VALIDATION_ERROR',
        validation.errors
      );
    }

    return deduplicateSnapshot(validation.snapshot).snapshot;
  } catch (err) {
    if (timedOut) {
      throw new Error(`Live snapshot request timed out after ${timeoutMs}ms (${url}).`);
    }
    throw err;
  } finally {
    globalThis.clearTimeout(timer);
    if (options?.signal) {
      options.signal.removeEventListener('abort', onCallerAbort);
    }
  }
}

/**
 * Executes a Live Command against the configured local Mission Control backend.
 * CRITICAL RULES:
 * 1. Never invokes or falls back to `MissionControlDataController` (demo state).
 * 2. Rechecks current connection health (`options.connectionHealth === 'connected'`) at dispatch.
 * 3. Refuses execution with `LIVE_COMMANDS_UNCONFIGURED` unless `config.enableLiveCommandRoute`
 *    and `capabilities.commandEndpointVerified` are both true.
 * 4. Rechecks the specific command capability (`canArchive`, `canChangePriority`, etc.) at dispatch.
 * 5. Validates HTTP status, response shape, exact matching `idempotencyKey`, command identity,
 *    and `deliveryAck` outcome semantics via `validateCommandResponsePayload`.
 * 6. Uses bounded timeout and NEVER blindly retries an uncertain timeout.
 */
export async function executeLiveCommand(
  config: LiveAdapterConfig,
  capabilities: MissionControlSnapshot['capabilities'] | null,
  req: OperatorCommandRequest,
  options?: {
    connectionHealth?: ConnectionHealthState;
    signal?: AbortSignal;
    fetchImpl?: FetchLike;
  }
): Promise<OperatorCommandResponse> {
  if (
    options?.connectionHealth !== undefined &&
    options.connectionHealth !== 'connected'
  ) {
    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: false,
      errorCode: 'NOT_CONNECTED',
      errorMessage: `Cannot dispatch live command while connection state is "${options.connectionHealth}". Reconnect to a fresh live feed first.`,
    };
  }

  if (!config.enableLiveCommandRoute || !capabilities?.commandEndpointVerified) {
    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: false,
      errorCode: 'LIVE_COMMANDS_UNCONFIGURED',
      errorMessage:
        'Live mode is read-only until a verified backend command route (/commands) is configured and advertised by Mission Control.',
    };
  }

  if (!isCommandCapabilitySupported(req.command.type, capabilities)) {
    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: false,
      errorCode: 'CAPABILITY_UNSUPPORTED',
      errorMessage:
        capabilities.reasonIfDisabled ||
        `Backend capability for "${req.command.type}" is disabled.`,
    };
  }

  const fetchFn: FetchLike = options?.fetchImpl ?? ((input, init) => fetch(input, init));
  const url = `${config.endpointBaseUrl.replace(/\/$/, '')}/commands`;

  const timeoutController = new AbortController();
  const timeoutMs = config.requestTimeoutMs > 0 ? config.requestTimeoutMs : 8000;
  let timedOut = false;
  let callerAborted = false;

  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);

  const onCallerAbort = () => {
    callerAborted = true;
    timeoutController.abort();
  };

  if (options?.signal) {
    if (options.signal.aborted) {
      globalThis.clearTimeout(timer);
      return {
        ok: false,
        idempotencyKey: req.idempotencyKey,
        commandAccepted: false,
        errorCode: 'NOT_CONNECTED',
        errorMessage: 'Command aborted because connection or mode changed before dispatch.',
      };
    }
    options.signal.addEventListener('abort', onCallerAbort, { once: true });
  }

  try {
    const response = await fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': req.idempotencyKey,
        'X-Mission-Control-Schema': CONTRACT_SCHEMA_VERSION,
      },
      credentials: config.withCredentialsCookie ? 'include' : 'same-origin',
      body: JSON.stringify(req),
      signal: timeoutController.signal,
    });

    if (callerAborted) {
      return {
        ok: false,
        idempotencyKey: req.idempotencyKey,
        commandAccepted: false,
        errorCode: 'NOT_CONNECTED',
        errorMessage: 'Command response ignored because connection or mode changed.',
      };
    }

    let parsedBody: unknown = null;
    try {
      parsedBody = await response.json();
    } catch {
      return {
        ok: false,
        idempotencyKey: req.idempotencyKey,
        commandAccepted: false,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: `Non-JSON command response from live backend (HTTP ${response.status}).`,
      };
    }

    return validateCommandResponsePayload(
      parsedBody,
      req,
      response.status,
      response.ok
    );
  } catch (err) {
    if (callerAborted) {
      return {
        ok: false,
        idempotencyKey: req.idempotencyKey,
        commandAccepted: false,
        errorCode: 'NOT_CONNECTED',
        errorMessage: 'Command aborted due to endpoint or mode change.',
      };
    }

    if (timedOut) {
      return {
        ok: false,
        idempotencyKey: req.idempotencyKey,
        commandAccepted: false,
        deliveryAck: {
          acknowledged: false,
          outcome: 'uncertain_timeout',
          ackId: null,
          channel: 'live-http-command',
          recipient:
            req.command.type === 'send_reminder' ? req.command.targetOwner : 'backend',
          error: `Command HTTP request timed out after ${timeoutMs}ms. Outcome is UNCERTAIN; do not blindly retry without refreshing snapshot.`,
        },
        errorCode: 'UNCERTAIN_WRITE_TIMEOUT',
        errorMessage: `Command request timed out after ${timeoutMs}ms (idempotencyKey: ${req.idempotencyKey}). Outcome is uncertain — refresh snapshot before retrying.`,
      };
    }

    return {
      ok: false,
      idempotencyKey: req.idempotencyKey,
      commandAccepted: false,
      errorCode: 'NOT_CONNECTED',
      errorMessage:
        err instanceof Error
          ? `Live command failed: ${err.message}`
          : 'Live command network failure.',
    };
  } finally {
    globalThis.clearTimeout(timer);
    if (options?.signal) {
      options.signal.removeEventListener('abort', onCallerAbort);
    }
  }
}

export interface PollCycleOutcome {
  status:
    | 'updated'
    | 'rejected_validation_preserved_last'
    | 'network_error'
    | 'ignored_stale_generation'
    | 'skipped_in_flight';
  connectionHealth: ConnectionHealthState;
  snapshot: MissionControlSnapshot | null;
  lastSuccessfulContactAt: string | null;
  snapshotGeneratedAt: string | null;
  warningOrError: string | null;
}

/**
 * Evaluates whether a snapshot's own generation timestamp (`snapshot.generatedAt`) is fresh
 * relative to `referenceNowIso` and the configured `staleFeedWarningSeconds`.
 * Repeated HTTP 200 responses returning an old `generatedAt` will evaluate as stale!
 */
export function evaluateSnapshotDataFreshness(
  snapshot: MissionControlSnapshot,
  referenceNowIso: string,
  config: LiveAdapterConfig
): {
  isDataFresh: boolean;
  ageSeconds: number | null;
  staleLimitSeconds: number;
  reason: string | null;
} {
  const staleLimitSeconds =
    snapshot.evaluationThresholds.staleFeedWarningSeconds ??
    Math.max(25, Math.ceil((config.basePollIntervalMs * 2.5) / 1000));

  const genEval = evaluateTimestamp(snapshot.generatedAt, referenceNowIso);
  if (!genEval.valid || genEval.ageSeconds === null) {
    return {
      isDataFresh: false,
      ageSeconds: null,
      staleLimitSeconds,
      reason: `Snapshot generatedAt timestamp is invalid or in the future (${genEval.reason || 'invalid'}).`,
    };
  }

  if (genEval.ageSeconds > staleLimitSeconds) {
    return {
      isDataFresh: false,
      ageSeconds: genEval.ageSeconds,
      staleLimitSeconds,
      reason: `Transport reachable, but snapshot data is stale (generated ${genEval.ageSeconds}s ago > ${staleLimitSeconds}s freshness threshold).`,
    };
  }

  return {
    isDataFresh: true,
    ageSeconds: genEval.ageSeconds,
    staleLimitSeconds,
    reason: null,
  };
}

/**
 * Stateful coordinator for Live Mode polling that prevents overlapping polls,
 * cancels in-flight requests on endpoint/mode switch, ignores late responses
 * from old generations, and separates transport contact time from snapshot data freshness.
 */
export class LivePollCoordinator {
  private generationId = 0;
  private inFlightAbort: AbortController | null = null;
  private isPolling = false;
  private lastValidSnapshot: MissionControlSnapshot | null = null;
  private lastSuccessfulContactAt: string | null = null;
  private connectionHealth: ConnectionHealthState = 'never_connected';
  private lastErrorOrWarning: string | null = null;

  public getGenerationId(): number {
    return this.generationId;
  }

  public isInFlight(): boolean {
    return this.isPolling;
  }

  public getLastValidSnapshot(): MissionControlSnapshot | null {
    return this.lastValidSnapshot;
  }

  public getLastSuccessfulContactAt(): string | null {
    return this.lastSuccessfulContactAt;
  }

  public getConnectionHealth(): ConnectionHealthState {
    return this.connectionHealth;
  }

  /**
   * Invalidates any in-flight poll (e.g., when switching modes or changing endpoint URL).
   */
  public invalidateAndReset(clearLastSnapshot = true): void {
    this.generationId += 1;
    if (this.inFlightAbort) {
      this.inFlightAbort.abort();
      this.inFlightAbort = null;
    }
    this.isPolling = false;
    if (clearLastSnapshot) {
      this.lastValidSnapshot = null;
      this.lastSuccessfulContactAt = null;
      this.connectionHealth = 'never_connected';
      this.lastErrorOrWarning = null;
    }
  }

  public async pollOnce(
    config: LiveAdapterConfig,
    options?: {
      referenceNowIso?: string;
      fetchImpl?: FetchLike;
    }
  ): Promise<PollCycleOutcome> {
    if (this.isPolling) {
      return {
        status: 'skipped_in_flight',
        connectionHealth: this.connectionHealth,
        snapshot: this.lastValidSnapshot,
        lastSuccessfulContactAt: this.lastSuccessfulContactAt,
        snapshotGeneratedAt: this.lastValidSnapshot?.generatedAt ?? null,
        warningOrError: this.lastErrorOrWarning,
      };
    }

    const myGeneration = this.generationId;
    const abortCtrl = new AbortController();
    this.inFlightAbort = abortCtrl;
    this.isPolling = true;
    const contactIso = options?.referenceNowIso ?? new Date().toISOString();

    try {
      const nextSnap = await fetchLiveSnapshot(config, {
        signal: abortCtrl.signal,
        referenceNowIso: contactIso,
        previousValidSnapshot: this.lastValidSnapshot,
        fetchImpl: options?.fetchImpl,
      });

      // If mode or endpoint changed while this request was in flight, ignore late response!
      if (myGeneration !== this.generationId) {
        return {
          status: 'ignored_stale_generation',
          connectionHealth: this.connectionHealth,
          snapshot: this.lastValidSnapshot,
          lastSuccessfulContactAt: this.lastSuccessfulContactAt,
          snapshotGeneratedAt: this.lastValidSnapshot?.generatedAt ?? null,
          warningOrError: null,
        };
      }

      this.lastValidSnapshot = nextSnap;
      this.lastSuccessfulContactAt = contactIso;

      // Separate HTTP transport success from snapshot data freshness!
      const freshness = evaluateSnapshotDataFreshness(nextSnap, contactIso, config);
      if (!freshness.isDataFresh) {
        this.connectionHealth = 'stale';
        this.lastErrorOrWarning = freshness.reason;
      } else {
        this.connectionHealth = 'connected';
        this.lastErrorOrWarning = null;
      }

      return {
        status: 'updated',
        connectionHealth: this.connectionHealth,
        snapshot: nextSnap,
        lastSuccessfulContactAt: this.lastSuccessfulContactAt,
        snapshotGeneratedAt: nextSnap.generatedAt,
        warningOrError: this.lastErrorOrWarning,
      };
    } catch (err) {
      if (myGeneration !== this.generationId) {
        return {
          status: 'ignored_stale_generation',
          connectionHealth: this.connectionHealth,
          snapshot: this.lastValidSnapshot,
          lastSuccessfulContactAt: this.lastSuccessfulContactAt,
          snapshotGeneratedAt: this.lastValidSnapshot?.generatedAt ?? null,
          warningOrError: null,
        };
      }

      const msg = err instanceof Error ? err.message : String(err);
      this.lastErrorOrWarning = msg;

      if (err instanceof SnapshotValidationError) {
        // Reject malformed or out-of-order snapshot, preserve lastValidSnapshot with warning
        this.connectionHealth = this.lastValidSnapshot ? 'stale' : 'never_connected';
        return {
          status: 'rejected_validation_preserved_last',
          connectionHealth: this.connectionHealth,
          snapshot: this.lastValidSnapshot,
          lastSuccessfulContactAt: this.lastSuccessfulContactAt,
          snapshotGeneratedAt: this.lastValidSnapshot?.generatedAt ?? null,
          warningOrError: msg,
        };
      }

      this.connectionHealth = this.lastValidSnapshot ? 'disconnected' : 'never_connected';
      return {
        status: 'network_error',
        connectionHealth: this.connectionHealth,
        snapshot: this.lastValidSnapshot,
        lastSuccessfulContactAt: this.lastSuccessfulContactAt,
        snapshotGeneratedAt: this.lastValidSnapshot?.generatedAt ?? null,
        warningOrError: msg,
      };
    } finally {
      if (myGeneration === this.generationId) {
        this.isPolling = false;
        this.inFlightAbort = null;
      }
    }
  }
}
