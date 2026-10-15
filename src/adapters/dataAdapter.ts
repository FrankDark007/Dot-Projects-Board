/**
 * @file src/adapters/dataAdapter.ts
 * @description Clean adapter layer separating Demo Mode (synthetic fixtures) and
 * Live Mode (configurable authenticated local Mission Control adapter).
 *
 * CRITICAL INVARIANTS:
 * 1. Live mode NEVER silently substitutes demo data when disconnected or failing.
 * 2. Until a live connection succeeds, Live mode reports `not_connected`.
 * 3. If a live connection drops after receiving data, it transitions to `degraded_stale`
 *    and preserves the last-known snapshot with an explicit stale warning.
 * 4. All operator writes enforce idempotency keys, revision conflict checks,
 *    backend capability checks, and explicit delivery acknowledgments for reminders.
 */

import { deduplicateSnapshot } from '../engine/stateEvaluator';
import { createSyntheticSnapshot, REFERENCE_NOW_ISO } from '../fixtures/syntheticFixtures';
import {
  ActivityEvent,
  ConnectionHealthState,
  CONTRACT_SCHEMA_VERSION,
  MissionControlSnapshot,
  OperatorCommandRequest,
  OperatorCommandResponse,
  ReminderReceipt,
} from '../schema/contract';

export type DashboardMode = 'demo' | 'live';

export interface LiveAdapterConfig {
  endpointBaseUrl: string; // e.g., "http://127.0.0.1:43110/api/mission-control/v1"
  transport: 'bounded_polling' | 'sse_stream';
  basePollIntervalMs: number; // e.g., 10000 (10s)
  maxBackoffMs: number; // e.g., 60000 (60s)
  backgroundTabMultiplier: number; // e.g., 4x slower when document.hidden
  withCredentialsCookie: boolean; // Uses HttpOnly same-origin / local session cookie
}

export const DEFAULT_LIVE_CONFIG: LiveAdapterConfig = {
  endpointBaseUrl: 'http://127.0.0.1:43110/api/mission-control/v1',
  transport: 'bounded_polling',
  basePollIntervalMs: 10000,
  maxBackoffMs: 60000,
  backgroundTabMultiplier: 4,
  withCredentialsCookie: true,
};

export interface AdapterState {
  mode: DashboardMode;
  connectionHealth: ConnectionHealthState;
  snapshot: MissionControlSnapshot | null;
  referenceNowIso: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  currentBackoffMs: number;
  isBackgroundThrottled: boolean;
  deduplicatedCount: number;
}

/**
 * Stateful in-memory controller for Demo fixtures & command verification.
 * Also used by the automated test suite to verify all 11 required scenarios.
 */
export class MissionControlDataController {
  private snapshot: MissionControlSnapshot;
  private processedCommands = new Map<string, OperatorCommandResponse>();
  private simulateReminderFailureForOwners = new Set<string>(['dot/macos-automation']);
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
      this.simulateReminderFailureForOwners.add(owner);
    } else {
      this.simulateReminderFailureForOwners.delete(owner);
    }
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
   * Executes an operator command with strict idempotency, capability validation,
   * optimistic concurrency (revision conflict check), and truthful reminder ack.
   */
  public executeCommand(req: OperatorCommandRequest): OperatorCommandResponse {
    // 1. Idempotency replay check
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
      const err: OperatorCommandResponse = {
        ok: false,
        idempotencyKey: req.idempotencyKey,
        errorCode: 'VALIDATION_ERROR',
        errorMessage: `Unknown project ID: ${command.projectId}`,
      };
      this.processedCommands.set(req.idempotencyKey, err);
      return err;
    }

    const project = this.snapshot.projects[projectIndex];

    // 2. Capability check
    const caps = this.snapshot.capabilities;
    if (command.type === 'archive_project' && !caps.canArchive) {
      return this.recordError(
        req.idempotencyKey,
        'CAPABILITY_UNSUPPORTED',
        caps.reasonIfDisabled ?? 'Archive capability is disabled by the backend adapter.'
      );
    }
    if (command.type === 'set_priority' && !caps.canChangePriority) {
      return this.recordError(
        req.idempotencyKey,
        'CAPABILITY_UNSUPPORTED',
        caps.reasonIfDisabled ?? 'Priority mutation is disabled by the backend adapter.'
      );
    }
    if (command.type === 'add_note' && !caps.canAddNote) {
      return this.recordError(
        req.idempotencyKey,
        'CAPABILITY_UNSUPPORTED',
        caps.reasonIfDisabled ?? 'Operator notes are disabled by the backend adapter.'
      );
    }
    if (command.type === 'send_reminder' && !caps.canSendReminder) {
      return this.recordError(
        req.idempotencyKey,
        'CAPABILITY_UNSUPPORTED',
        caps.reasonIfDisabled ?? 'Owner reminders are disabled by the backend adapter.'
      );
    }
    if (command.type === 'resolve_decision' && !caps.canResolveDecision) {
      return this.recordError(
        req.idempotencyKey,
        'CAPABILITY_UNSUPPORTED',
        caps.reasonIfDisabled ?? 'Decision resolution is disabled by the backend adapter.'
      );
    }

    // 3. Optimistic concurrency / revision conflict check
    if (req.expectedRevision !== project.revision) {
      return this.recordError(
        req.idempotencyKey,
        'REVISION_CONFLICT',
        `Conflict on ${project.name}: expected revision ${req.expectedRevision}, but current revision is ${project.revision}. Refresh before retrying.`
      );
    }

    const nowIso = req.issuedAt || REFERENCE_NOW_ISO;
    const nextRevision = project.revision + 1;

    // 4. Handle specific command types
    if (command.type === 'archive_project') {
      // Archiving must NEVER delete files or cancel running jobs!
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
        actor: 'you',
        title: command.archive
          ? `Archived project (files & running workers untouched)`
          : `Restored project from archive (Undo)`,
        detail:
          command.reason ||
          'State visibility updated; zero files deleted and zero jobs cancelled.',
        isMeaningfulProgress: false,
        source: {
          sourceId: `src-cmd-${req.idempotencyKey}`,
          kind: 'human_operator',
          emitterName: 'mission-control-ui',
          observedAt: nowIso,
        },
      });

      const res: OperatorCommandResponse = {
        ok: true,
        idempotencyKey: req.idempotencyKey,
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
        actor: 'you',
        title: `Changed project priority from ${project.priority} to ${command.priority}`,
        detail: `Updated scheduling priority metadata to ${command.priority}.`,
        isMeaningfulProgress: false,
        source: {
          sourceId: `src-cmd-${req.idempotencyKey}`,
          kind: 'human_operator',
          emitterName: 'mission-control-ui',
          observedAt: nowIso,
        },
      });

      const res: OperatorCommandResponse = {
        ok: true,
        idempotencyKey: req.idempotencyKey,
        newRevision: nextRevision,
        acknowledgedAt: nowIso,
      };
      this.processedCommands.set(req.idempotencyKey, res);
      return res;
    }

    if (command.type === 'add_note') {
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
          kind: 'human_operator',
          emitterName: 'mission-control-ui',
          observedAt: nowIso,
        },
      });

      const res: OperatorCommandResponse = {
        ok: true,
        idempotencyKey: req.idempotencyKey,
        newRevision: nextRevision,
        acknowledgedAt: nowIso,
      };
      this.processedCommands.set(req.idempotencyKey, res);
      return res;
    }

    if (command.type === 'send_reminder') {
      // Never display "dot notified" without a verified delivery acknowledgment!
      const shouldFail = this.simulateReminderFailureForOwners.has(command.targetOwner);
      if (shouldFail) {
        const failedReceipt: ReminderReceipt = {
          reminderId: `rem-${req.idempotencyKey}`,
          projectId: project.projectId,
          targetOwner: command.targetOwner,
          sentAt: nowIso,
          status: 'failed_delivery',
          deliveryChannel: 'macos-automation-bridge',
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
          actor: 'you',
          title: `Reminder delivery FAILED for ${command.targetOwner}`,
          detail: failedReceipt.errorMessage!,
          isMeaningfulProgress: false,
          source: {
            sourceId: `src-cmd-${req.idempotencyKey}`,
            kind: 'human_operator',
            emitterName: 'mission-control-ui',
            observedAt: nowIso,
          },
        });

        const failRes: OperatorCommandResponse = {
          ok: false,
          idempotencyKey: req.idempotencyKey,
          newRevision: nextRevision,
          deliveryAck: {
            acknowledged: false,
            ackId: null,
            channel: 'macos-automation-bridge',
            recipient: command.targetOwner,
            error: failedReceipt.errorMessage,
          },
          errorCode: 'DELIVERY_FAILED',
          errorMessage: `Reminder was NOT acknowledged by ${command.targetOwner}. Do not assume owner was notified.`,
        };
        this.processedCommands.set(req.idempotencyKey, failRes);
        return failRes;
      }

      const ackId = `ack-${req.idempotencyKey.slice(-6)}`;
      const ackReceipt: ReminderReceipt = {
        reminderId: `rem-${req.idempotencyKey}`,
        projectId: project.projectId,
        targetOwner: command.targetOwner,
        sentAt: nowIso,
        status: 'acknowledged',
        deliveryChannel: 'dot-supervisor-ipc',
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
        actor: 'you',
        title: `Reminder delivered & acknowledged by ${command.targetOwner} (${ackId})`,
        detail: command.message,
        isMeaningfulProgress: false,
        source: {
          sourceId: `src-cmd-${req.idempotencyKey}`,
          kind: 'human_operator',
          emitterName: 'mission-control-ui',
          observedAt: nowIso,
        },
      });

      const okRes: OperatorCommandResponse = {
        ok: true,
        idempotencyKey: req.idempotencyKey,
        newRevision: nextRevision,
        acknowledgedAt: nowIso,
        deliveryAck: {
          acknowledged: true,
          ackId,
          channel: 'dot-supervisor-ipc',
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
        nextAction: `Decision "${targetDecision.decisionId}" recorded by operator; awaiting next worker run verification.`,
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
        actor: 'you',
        title: `Resolved decision: ${ command.selectedOption || command.resolutionNote }`,
        detail: `Recorded resolution for ${targetDecision.decisionId}.`,
        isMeaningfulProgress: true,
        source: {
          sourceId: `src-cmd-${req.idempotencyKey}`,
          kind: 'human_operator',
          emitterName: 'mission-control-ui',
          observedAt: nowIso,
        },
      });

      const res: OperatorCommandResponse = {
        ok: true,
        idempotencyKey: req.idempotencyKey,
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
 * Performs a bounded live fetch from the configured local Mission Control endpoint.
 * Never returns synthetic demo data on failure.
 */
export async function fetchLiveSnapshot(
  config: LiveAdapterConfig,
  signal?: AbortSignal
): Promise<MissionControlSnapshot> {
  const url = `${config.endpointBaseUrl.replace(/\/$/, '')}/snapshot`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Mission-Control-Schema': CONTRACT_SCHEMA_VERSION,
    },
    credentials: config.withCredentialsCookie ? 'include' : 'same-origin',
    signal,
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText} from ${url}`);
  }

  const body = (await response.json()) as MissionControlSnapshot;
  if (!body || body.schemaVersion !== CONTRACT_SCHEMA_VERSION) {
    throw new Error(
      `Schema version mismatch: expected "${CONTRACT_SCHEMA_VERSION}", received "${
        (body as { schemaVersion?: string })?.schemaVersion ?? 'unknown'
      }".`
    );
  }

  return deduplicateSnapshot(body).snapshot;
}
