/**
 * @file src/components/ProjectDetailModal.tsx
 * @description Accessible, keyboard-navigable Project Detail panel with evidence links,
 * activity timeline, worker runs, deployment revision, test/review acceptance gates,
 * unresolved decisions, notes, and reminder delivery receipts.
 */

import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Bell,
  CheckCircle2,
  Clock,
  FileCode2,
  GitCommit,
  MessageSquarePlus,
  ShieldAlert,
  Terminal,
  X,
  XCircle,
} from 'lucide-react';
import { EvaluatedProject } from '../engine/stateEvaluator';
import {
  ActivityEvent,
  BackendCapabilities,
  EvidenceLink,
  PriorityLevel,
  TaskItem,
  WorkerRunRecord,
} from '../schema/contract';
import { formatRelativeAge, formatUtcShort } from '../utils/timeFormat';
import { WorkflowDiagram } from './WorkflowDiagram';

interface ProjectDetailModalProps {
  evaluated: EvaluatedProject;
  tasks: TaskItem[];
  runs: WorkerRunRecord[];
  evidence: EvidenceLink[];
  events: ActivityEvent[];
  referenceNowIso: string;
  capabilities: BackendCapabilities;
  onClose: () => void;
  onChangePriority: (projectId: string, priority: PriorityLevel) => void;
  onToggleArchive: (projectId: string, archive: boolean) => void;
  onAddNote: (projectId: string, body: string) => void;
  onSendReminder: (projectId: string, targetOwner: string, message: string) => void;
  onResolveDecision: (
    projectId: string,
    decisionId: string,
    selectedOption: string | undefined,
    resolutionNote: string
  ) => void;
}

type DetailTab = 'overview_gates' | 'workers_runs' | 'evidence_timeline' | 'decisions_notes';

export const ProjectDetailModal: React.FC<ProjectDetailModalProps> = ({
  evaluated,
  tasks,
  runs,
  evidence,
  events,
  referenceNowIso,
  capabilities,
  onClose,
  onChangePriority,
  onToggleArchive,
  onAddNote,
  onSendReminder,
  onResolveDecision,
}) => {
  const [activeTab, setActiveTab] = useState<DetailTab>('overview_gates');
  const [noteInput, setNoteInput] = useState('');
  const [reminderMessage, setReminderMessage] = useState('');
  const [decisionOptionMap, setDecisionOptionMap] = useState<Record<string, string>>({});
  const [decisionNoteMap, setDecisionNoteMap] = useState<Record<string, string>>({});

  const { project, workerSummary, allOpenDecisions } = evaluated;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleNoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteInput.trim()) return;
    onAddNote(project.projectId, noteInput.trim());
    setNoteInput('');
  };

  const handleReminderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const msg =
      reminderMessage.trim() ||
      `Status check requested on ${project.name}: ${project.nextAction}`;
    onSendReminder(project.projectId, project.owner, msg);
    setReminderMessage('');
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-detail-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 sm:p-6 overflow-y-auto"
    >
      <div className="bg-white border border-slate-300 rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden shadow-lg">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-slate-200 bg-slate-50/70">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 mb-1">
              <span className="font-semibold text-slate-900">
                {evaluated.primaryStatusLabel}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-500">ID: {project.projectId}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-500 tabular-nums">
                Revision v{project.revision}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                Owner: <strong className="text-slate-900">{project.owner}</strong>
              </span>
            </div>
            <h2
              id="project-detail-title"
              className="text-xl font-bold text-slate-900 tracking-tight"
            >
              {project.name}
            </h2>
            <p className="text-xs text-slate-600 mt-1">{project.currentScope}</p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close project detail"
            className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 rounded-lg transition-colors cursor-pointer shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub-Toolbar: Segmented Tabs + Quick Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 border-b border-slate-200 bg-white">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setActiveTab('overview_gates')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'overview_gates'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Workflow & Gates ({project.milestones.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('workers_runs')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'workers_runs'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Workers ({workerSummary.workers.length}) & Runs ({runs.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('evidence_timeline')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'evidence_timeline'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Evidence ({evidence.length}) & Timeline ({events.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('decisions_notes')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'decisions_notes'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Decisions ({allOpenDecisions.length}) · Notes & Reminders
            </button>
          </div>

          <div className="flex items-center gap-2">
            <select
              aria-label="Project priority"
              value={project.priority}
              disabled={!capabilities.canChangePriority}
              onChange={(e) =>
                onChangePriority(project.projectId, e.target.value as PriorityLevel)
              }
              className="text-xs font-medium bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-800 disabled:opacity-50 cursor-pointer"
            >
              <option value="critical">Priority: Critical</option>
              <option value="high">Priority: High</option>
              <option value="normal">Priority: Normal</option>
              <option value="low">Priority: Low</option>
            </select>

            <button
              type="button"
              disabled={!capabilities.canArchive}
              onClick={() => onToggleArchive(project.projectId, !project.archived)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
            >
              {project.archived ? (
                <>
                  <ArchiveRestore className="w-3.5 h-3.5" />
                  <span>Unarchive</span>
                </>
              ) : (
                <>
                  <Archive className="w-3.5 h-3.5" />
                  <span>Archive</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* TAB 1: OVERVIEW, DEPLOYMENT REVISION, COST COVERAGE & WORKFLOW GATES */}
          {activeTab === 'overview_gates' && (
            <div className="space-y-6">
              {/* Top 3-Column Telemetry Strip */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="border border-slate-200 rounded-lg p-4">
                  <div className="text-xs text-slate-500 mb-1">Deployment Revision</div>
                  {project.deployedRevision ? (
                    <>
                      <div className="text-sm font-mono font-semibold text-slate-900">
                        {project.deployedRevision.versionOrSha}
                      </div>
                      <div className="text-xs text-slate-600 mt-1">
                        Environment: {project.deployedRevision.environment} ·{' '}
                        {project.deployedRevision.verifiedHealthy
                          ? 'Verified Healthy'
                          : 'Health Unverified'}
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 tabular-nums mt-1">
                        Deployed {formatRelativeAge(project.deployedRevision.deployedAt, referenceNowIso)}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-slate-600">
                      Not deployed — no revision recorded.
                    </div>
                  )}
                </div>

                <div className="border border-slate-200 rounded-lg p-4">
                  <div className="text-xs text-slate-500 mb-1">
                    Cost Coverage & Metering Truthfulness
                  </div>
                  <div className="text-sm font-mono font-semibold text-slate-900 tabular-nums">
                    {project.cost.knownUsd !== null
                      ? `$${project.cost.knownUsd.toFixed(2)} USD`
                      : 'Unavailable (No Meter)'}
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    Coverage: <strong className="font-medium">{project.cost.coverage}</strong>
                    {project.cost.isEstimate ? ' · Explicitly labeled Estimate' : ''}
                  </div>
                  {project.cost.untrackedSources.length > 0 && (
                    <div className="text-[11px] text-amber-800 mt-1">
                      Untracked: {project.cost.untrackedSources.join(', ')}
                    </div>
                  )}
                </div>

                <div className="border border-slate-200 rounded-lg p-4">
                  <div className="text-xs text-slate-500 mb-1">
                    Source & Observation Attribution
                  </div>
                  <div className="text-xs font-mono text-slate-900">
                    {project.source.emitterName} ({project.source.kind})
                  </div>
                  <div className="text-xs font-mono text-slate-500 tabular-nums mt-1">
                    Source ID: {project.source.sourceId}
                  </div>
                  <div className="text-[11px] font-mono text-slate-400 tabular-nums mt-1">
                    Observed: {formatUtcShort(project.source.observedAt)}
                  </div>
                </div>
              </div>

              {/* Workflow & Acceptance Gates */}
              <WorkflowDiagram
                milestones={project.milestones}
                currentMilestoneId={project.currentMilestoneId}
                referenceNowIso={referenceNowIso}
              />

              {/* Active Tasks Table */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 mb-2.5">
                  Tracked Tasks ({tasks.length})
                </h3>
                {tasks.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No granular task items emitted for this project.
                  </p>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                          <th className="py-2.5 px-3 font-medium">Task</th>
                          <th className="py-2.5 px-3 font-medium">Owner</th>
                          <th className="py-2.5 px-3 font-medium">Status</th>
                          <th className="py-2.5 px-3 font-medium">Worker</th>
                          <th className="py-2.5 px-3 font-medium text-right">Last Progress</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {tasks.map((t) => (
                          <tr key={t.taskId} className="hover:bg-slate-50/80">
                            <td className="py-2.5 px-3">
                              <div className="font-medium text-slate-900">{t.title}</div>
                              <div className="text-slate-500">{t.summary}</div>
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-700">{t.owner}</td>
                            <td className="py-2.5 px-3 font-mono text-slate-800">{t.status}</td>
                            <td className="py-2.5 px-3 font-mono text-slate-600">
                              {t.assignedWorkerId || 'None'}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-slate-600 text-right tabular-nums">
                              {formatRelativeAge(t.lastMeaningfulProgressAt, referenceNowIso)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: WORKERS & RUNS (Heartbeats vs Meaningful Progress) */}
          {activeTab === 'workers_runs' && (
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-900">
                    Assigned Worker Telemetry (Liveness vs Progress)
                  </h3>
                  <span className="text-xs text-slate-500">
                    Heartbeats prove process liveness only — never task progress
                  </span>
                </div>

                {!workerSummary.coverageKnown ? (
                  <div className="border border-amber-200 bg-amber-50/60 rounded-lg p-4 text-xs text-amber-900">
                    <strong>Worker Coverage Unknown:</strong> Local worker telemetry is not
                    instrumented or unavailable for this project. Active worker count is
                    explicitly reported as Unknown rather than 0.
                  </div>
                ) : workerSummary.workers.length === 0 ? (
                  <div className="border border-slate-200 rounded-lg p-4 text-xs text-slate-600">
                    0 workers assigned to this project.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                          <th className="py-2.5 px-3 font-medium">Worker / Host</th>
                          <th className="py-2.5 px-3 font-medium">Raw State</th>
                          <th className="py-2.5 px-3 font-medium">Truthful Evaluated State</th>
                          <th className="py-2.5 px-3 font-medium text-right">Last Heartbeat</th>
                          <th className="py-2.5 px-3 font-medium text-right">
                            Last Meaningful Progress
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {workerSummary.workers.map((w) => (
                          <tr key={w.workerId} className="hover:bg-slate-50/80">
                            <td className="py-3 px-3">
                              <div className="font-mono font-semibold text-slate-900">
                                {w.name}
                              </div>
                              <div className="text-slate-500">
                                {w.role} · {w.hostLabel}
                              </div>
                            </td>
                            <td className="py-3 px-3 font-mono text-slate-600">{w.rawStatus}</td>
                            <td className="py-3 px-3">
                              <div
                                className={`font-mono font-semibold ${
                                  w.evaluatedState === 'active_running'
                                    ? 'text-emerald-800'
                                    : w.evaluatedState === 'crashed' ||
                                      w.evaluatedState === 'failed'
                                    ? 'text-red-700'
                                    : w.evaluatedState === 'stalled_progress' ||
                                      w.evaluatedState === 'stale_heartbeat'
                                    ? 'text-amber-800'
                                    : 'text-slate-700'
                                }`}
                              >
                                {w.evaluatedState}
                              </div>
                              <div className="text-[11px] text-slate-600 mt-0.5">
                                {w.statusExplanation}
                              </div>
                            </td>
                            <td className="py-3 px-3 font-mono text-right tabular-nums text-slate-700">
                              {formatRelativeAge(w.lastHeartbeatAt, referenceNowIso)}
                            </td>
                            <td className="py-3 px-3 font-mono text-right tabular-nums text-slate-700">
                              <div>
                                {formatRelativeAge(w.lastMeaningfulProgressAt, referenceNowIso)}
                              </div>
                              {w.lastProgressSummary && (
                                <div className="text-[11px] font-sans text-slate-500">
                                  {w.lastProgressSummary}
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Historical & Active Worker Runs */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 mb-2.5">
                  Worker Execution Runs ({runs.length})
                </h3>
                {runs.length === 0 ? (
                  <p className="text-xs text-slate-500">No worker runs recorded for this project.</p>
                ) : (
                  <div className="space-y-3">
                    {runs.map((run) => (
                      <div
                        key={run.runId}
                        className="border border-slate-200 rounded-lg p-3.5 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                          <div className="flex items-center gap-2 font-mono">
                            <Terminal className="w-3.5 h-3.5 text-slate-500" />
                            <span className="font-semibold text-slate-900">{run.runId}</span>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-600">Worker: {run.workerId}</span>
                            <span aria-hidden="true">·</span>
                            <span className="text-slate-600 tabular-nums">
                              {run.turnCount} turns
                            </span>
                          </div>
                          <span
                            className={`font-mono font-semibold ${
                              run.status === 'running'
                                ? 'text-emerald-800'
                                : run.status === 'crashed' || run.status === 'failed'
                                ? 'text-red-700'
                                : run.status === 'stalled'
                                ? 'text-amber-800'
                                : 'text-slate-800'
                            }`}
                          >
                            {run.status === 'succeeded_turn'
                              ? 'SUCCEEDED TURN (Does Not Imply Project Complete)'
                              : run.status.toUpperCase()}
                          </span>
                        </div>
                        <p className="text-slate-800 mb-1">{run.summary}</p>
                        {run.failureDiagnostic && (
                          <p className="font-mono text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-2 mt-1.5">
                            {run.failureDiagnostic}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-500 tabular-nums mt-2">
                          <span>Started {formatRelativeAge(run.startedAt, referenceNowIso)}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Last heartbeat {formatRelativeAge(run.lastHeartbeatAt, referenceNowIso)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Last progress{' '}
                            {formatRelativeAge(run.lastMeaningfulProgressAt, referenceNowIso)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: EVIDENCE LINKS & DEDUPLICATED ACTIVITY TIMELINE */}
          {activeTab === 'evidence_timeline' && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Evidence Links */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 mb-2.5">
                  Verified Evidence & Artifacts ({evidence.length})
                </h3>
                {evidence.length === 0 ? (
                  <p className="text-xs text-slate-500">No evidence artifacts linked yet.</p>
                ) : (
                  <div className="space-y-3">
                    {evidence.map((ev) => (
                      <div
                        key={ev.evidenceId}
                        className="border border-slate-200 rounded-lg p-3.5 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-900">
                            <FileCode2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                            <span>{ev.label}</span>
                          </div>
                          <span className="font-mono text-[11px] text-emerald-800 shrink-0">
                            {ev.verified ? 'Verified' : 'Unverified'}
                          </span>
                        </div>
                        <p className="text-slate-700 mb-1.5">{ev.summary}</p>
                        {ev.metricsSummary && (
                          <div className="font-mono text-[11px] text-slate-800 mb-1.5 tabular-nums">
                            Metrics: {ev.metricsSummary}
                          </div>
                        )}
                        <div className="font-mono text-[11px] text-slate-500 break-all bg-slate-50 px-2 py-1 rounded border border-slate-200/80">
                          {ev.uriOrRef}
                        </div>
                        <div className="text-[10px] font-mono text-slate-400 tabular-nums mt-1.5">
                          Source: {ev.source.emitterName} ·{' '}
                          {formatRelativeAge(ev.createdAt, referenceNowIso)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Activity Timeline */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 mb-2.5">
                  Deduplicated Activity Timeline ({events.length})
                </h3>
                {events.length === 0 ? (
                  <p className="text-xs text-slate-500">No events recorded for this project.</p>
                ) : (
                  <div className="space-y-3">
                    {events.map((ev) => (
                      <div
                        key={ev.eventId}
                        className="border border-slate-200 rounded-lg p-3.5 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-500 mb-1">
                          <span className="font-mono font-medium text-slate-800">
                            {ev.actor} · {ev.category}
                          </span>
                          <span className="font-mono tabular-nums">
                            {formatRelativeAge(ev.timestamp, referenceNowIso)}
                          </span>
                        </div>
                        <div className="font-semibold text-slate-900 mb-1">{ev.title}</div>
                        <p className="text-slate-600">{ev.detail}</p>
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mt-2">
                          <span>
                            {ev.isMeaningfulProgress
                              ? 'Meaningful progress event'
                              : 'Liveness / administrative event (non-progress)'}
                          </span>
                          <span>ID: {ev.eventId}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: UNRESOLVED DECISIONS, OPERATOR NOTES & REMINDER RECEIPTS */}
          {activeTab === 'decisions_notes' && (
            <div className="space-y-6">
              {/* Unresolved Decisions */}
              <div>
                <h3 className="text-sm font-semibold text-slate-900 mb-2.5">
                  Unresolved Decisions ({allOpenDecisions.length})
                </h3>
                {allOpenDecisions.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No open decisions or interventions required on this project.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {allOpenDecisions.map((dec) => {
                      const selectedOpt =
                        decisionOptionMap[dec.decisionId] ??
                        (dec.options ? dec.options[0] : '');
                      const noteVal = decisionNoteMap[dec.decisionId] ?? '';

                      return (
                        <div
                          key={dec.decisionId}
                          className="border border-amber-300 bg-amber-50/40 rounded-lg p-4 text-xs"
                        >
                          <div className="flex flex-wrap items-center gap-2 text-slate-600 mb-1.5">
                            <span className="font-semibold text-amber-900">
                              Owner: {dec.owner}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              Age: {formatRelativeAge(dec.createdAt, referenceNowIso)}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">{dec.decisionId}</span>
                          </div>
                          <p className="text-sm font-semibold text-slate-900 mb-1">
                            {dec.exactPromptOrFailure}
                          </p>
                          <p className="text-slate-600 mb-3">{dec.contextSummary}</p>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
                            {dec.options && dec.options.length > 0 && (
                              <select
                                aria-label="Select decision option"
                                value={selectedOpt}
                                disabled={!capabilities.canResolveDecision}
                                onChange={(e) =>
                                  setDecisionOptionMap((prev) => ({
                                    ...prev,
                                    [dec.decisionId]: e.target.value,
                                  }))
                                }
                                className="bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-xs text-slate-900"
                              >
                                {dec.options.map((opt) => (
                                  <option key={opt} value={opt}>
                                    {opt}
                                  </option>
                                ))}
                              </select>
                            )}
                            <input
                              type="text"
                              placeholder="Resolution note..."
                              value={noteVal}
                              disabled={!capabilities.canResolveDecision}
                              onChange={(e) =>
                                setDecisionNoteMap((prev) => ({
                                  ...prev,
                                  [dec.decisionId]: e.target.value,
                                }))
                              }
                              className="bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-xs text-slate-900"
                            />
                          </div>

                          <button
                            type="button"
                            disabled={!capabilities.canResolveDecision}
                            onClick={() =>
                              onResolveDecision(
                                project.projectId,
                                dec.decisionId,
                                selectedOpt || undefined,
                                noteVal || 'Resolved in Project Detail'
                              )
                            }
                            className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
                          >
                            Record Decision Resolution
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Two-column Notes & Owner Reminders */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-4 border-t border-slate-200">
                {/* Operator Notes */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-2.5">
                    Operator Notes ({project.notes.length})
                  </h3>
                  <form onSubmit={handleNoteSubmit} className="flex gap-2 mb-4">
                    <input
                      type="text"
                      placeholder="Add a persistent operator note..."
                      value={noteInput}
                      disabled={!capabilities.canAddNote}
                      onChange={(e) => setNoteInput(e.target.value)}
                      className="flex-1 text-xs bg-white border border-slate-300 rounded-md px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={!capabilities.canAddNote || !noteInput.trim()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <MessageSquarePlus className="w-3.5 h-3.5" />
                      <span>Add Note</span>
                    </button>
                  </form>

                  {project.notes.length === 0 ? (
                    <p className="text-xs text-slate-500">No operator notes recorded.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {project.notes.map((n) => (
                        <div
                          key={n.noteId}
                          className="border border-slate-200 rounded-lg p-3 text-xs"
                        >
                          <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1">
                            <span className="font-semibold text-slate-800">{n.author}</span>
                            <span className="font-mono tabular-nums">
                              {formatRelativeAge(n.createdAt, referenceNowIso)}
                            </span>
                          </div>
                          <p className="text-slate-800">{n.body}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Owner Reminders & Verified Delivery Receipts */}
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 mb-1">
                    Owner Reminders & Delivery Receipts ({project.reminders.length})
                  </h3>
                  <p className="text-[11px] text-slate-500 mb-2.5">
                    Never displays &ldquo;notified&rdquo; unless the target subsystem returns a
                    verified delivery acknowledgment ID.
                  </p>

                  <form onSubmit={handleReminderSubmit} className="flex gap-2 mb-4">
                    <input
                      type="text"
                      placeholder={`Message to ${project.owner}...`}
                      value={reminderMessage}
                      disabled={!capabilities.canSendReminder}
                      onChange={(e) => setReminderMessage(e.target.value)}
                      className="flex-1 text-xs bg-white border border-slate-300 rounded-md px-3 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50"
                    />
                    <button
                      type="submit"
                      disabled={!capabilities.canSendReminder}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 bg-slate-100 border border-slate-300 rounded-md hover:bg-slate-200 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Bell className="w-3.5 h-3.5" />
                      <span>Remind {project.owner}</span>
                    </button>
                  </form>

                  {project.reminders.length === 0 ? (
                    <p className="text-xs text-slate-500">No reminders sent yet.</p>
                  ) : (
                    <div className="space-y-2.5">
                      {project.reminders.map((rem) => (
                        <div
                          key={rem.reminderId}
                          className={`border rounded-lg p-3 text-xs ${
                            rem.status === 'acknowledged'
                              ? 'border-slate-200 bg-white'
                              : 'border-red-200 bg-red-50/50'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="font-semibold text-slate-900">
                              To: {rem.targetOwner} ({rem.deliveryChannel})
                            </span>
                            <span
                              className={`font-mono text-[11px] font-semibold ${
                                rem.status === 'acknowledged'
                                  ? 'text-emerald-800'
                                  : 'text-red-700'
                              }`}
                            >
                              {rem.status === 'acknowledged'
                                ? `ACKNOWLEDGED (${rem.ackId})`
                                : 'DELIVERY FAILED (NOT NOTIFIED)'}
                            </span>
                          </div>
                          {rem.errorMessage && (
                            <p className="text-red-800 font-mono text-[11px]">
                              {rem.errorMessage}
                            </p>
                          )}
                          <div className="text-[10px] font-mono text-slate-400 tabular-nums mt-1">
                            Sent {formatRelativeAge(rem.sentAt, referenceNowIso)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
