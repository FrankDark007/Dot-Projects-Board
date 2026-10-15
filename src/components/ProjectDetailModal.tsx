/**
 * @file src/components/ProjectDetailModal.tsx
 * @description Slide-over Side Panel for Project Details so the operator keeps their place
 * in the project list while inspecting the milestone timeline, dependencies,
 * completed/current/remaining steps, workers, evidence, and decisions.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  Bell,
  FileCode2,
  MessageSquarePlus,
  Terminal,
  X,
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

type DetailTab =
  | 'overview_gates'
  | 'workers_runs'
  | 'evidence_timeline'
  | 'decisions_notes';

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
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const { project, workerSummary, allOpenDecisions } = evaluated;

  useEffect(() => {
    closeButtonRef.current?.focus();
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
    <aside
      role="dialog"
      aria-modal="false"
      aria-labelledby="project-detail-title"
      className="fixed inset-y-0 right-0 z-40 w-full max-w-2xl bg-white dark:bg-[#111827] border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col overflow-hidden"
    >
      {/* Side Panel Header */}
      <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/80">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400 mb-1">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              {evaluated.primaryStatusLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-500 dark:text-slate-400">
              {project.projectId}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
              rev v{project.revision}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Owner:{' '}
              <strong className="text-slate-900 dark:text-slate-100">{project.owner}</strong>
            </span>
          </div>
          <h2
            id="project-detail-title"
            className="text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight"
          >
            {project.name}
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {project.currentScope}
          </p>
        </div>

        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          aria-label="Close project detail side panel"
          className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 rounded-md transition-colors cursor-pointer shrink-0"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Sub-Toolbar: Segmented Tabs + Quick Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827]">
        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-md">
          <button
            type="button"
            onClick={() => setActiveTab('overview_gates')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'overview_gates'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Timeline & Gates ({project.milestones.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('workers_runs')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'workers_runs'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Workers ({workerSummary.workers.length}) & Runs
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('evidence_timeline')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'evidence_timeline'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Evidence ({evidence.length}) & Activity
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('decisions_notes')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'decisions_notes'
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            Decisions ({allOpenDecisions.length}) & Controls
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
            className="text-xs font-medium bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-slate-800 dark:text-slate-200 disabled:opacity-50 cursor-pointer"
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
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
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
      <div className="p-5 overflow-y-auto space-y-6 flex-1">
        {!capabilities.canChangePriority && capabilities.reasonIfDisabled && (
          <div className="bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-md p-2.5 text-xs text-amber-900 dark:text-amber-200">
            <strong>Read-Only Controls:</strong> {capabilities.reasonIfDisabled}
          </div>
        )}

        {/* TAB 1: MILESTONE TIMELINE, DEPLOYMENT REVISION, COST COVERAGE & GATES */}
        {activeTab === 'overview_gates' && (
          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Deployment Revision
                </div>
                {project.deployedRevision ? (
                  <>
                    <div className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100">
                      {project.deployedRevision.versionOrSha}
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                      {project.deployedRevision.environment} ·{' '}
                      {project.deployedRevision.verifiedHealthy
                        ? 'Verified Healthy'
                        : 'Health Unverified'}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400 tabular-nums mt-0.5">
                      Deployed {formatRelativeAge(project.deployedRevision.deployedAt, referenceNowIso)}
                    </div>
                  </>
                ) : (
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Not deployed — no revision recorded.
                  </div>
                )}
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Cost Coverage & Metering
                </div>
                <div className="text-xs font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                  {project.cost.knownUsd !== null
                    ? `$${project.cost.knownUsd.toFixed(2)} USD`
                    : 'Unavailable (No Meter)'}
                </div>
                <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                  Coverage: <strong>{project.cost.coverage}</strong>
                  {project.cost.isEstimate ? ' · Estimate' : ''}
                </div>
                {project.cost.untrackedSources.length > 0 && (
                  <div className="text-[10px] text-amber-800 dark:text-amber-400 mt-0.5">
                    Untracked: {project.cost.untrackedSources.join(', ')}
                  </div>
                )}
              </div>

              <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3">
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                  Source Attribution
                </div>
                <div className="text-xs font-mono text-slate-900 dark:text-slate-100 truncate">
                  {project.source.emitterName}
                </div>
                <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums mt-0.5 truncate">
                  {project.source.sourceId}
                </div>
                <div className="text-[10px] font-mono text-slate-400 tabular-nums mt-0.5">
                  {formatUtcShort(project.source.observedAt)}
                </div>
              </div>
            </div>

            <WorkflowDiagram
              milestones={project.milestones}
              currentMilestoneId={project.currentMilestoneId}
              referenceNowIso={referenceNowIso}
            />

            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Tracked Tasks ({tasks.length})
              </h3>
              {tasks.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No granular task items emitted for this project.
                </p>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400">
                        <th className="py-2 px-3 font-medium">Task</th>
                        <th className="py-2 px-3 font-medium">Owner</th>
                        <th className="py-2 px-3 font-medium">Status</th>
                        <th className="py-2 px-3 font-medium text-right">Last Progress</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {tasks.map((t) => (
                        <tr key={t.taskId}>
                          <td className="py-2 px-3">
                            <div className="font-medium text-slate-900 dark:text-slate-100">
                              {t.title}
                            </div>
                            <div className="text-slate-500 dark:text-slate-400">{t.summary}</div>
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-700 dark:text-slate-300">
                            {t.owner}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-800 dark:text-slate-200">
                            {t.status}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-400 text-right tabular-nums">
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

        {/* TAB 2: WORKERS & RUNS (Separating Liveness, Progress & Unknown Coverage) */}
        {activeTab === 'workers_runs' && (
          <div className="space-y-5">
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Worker Liveness vs. Progress vs. Unknown Coverage
                </h3>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Expired heartbeats mark execution UNKNOWN unless stop proof exists
                </span>
              </div>

              {!workerSummary.coverageKnown ? (
                <div className="border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 rounded-md p-3.5 text-xs text-amber-900 dark:text-amber-200">
                  <strong>Worker Telemetry Coverage Unknown:</strong> Active worker count is
                  explicitly reported as Unknown rather than fabricated as 0. Missing telemetry
                  alone is not treated as proof the project has stalled.
                </div>
              ) : workerSummary.workers.length === 0 ? (
                <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3.5 text-xs text-slate-600 dark:text-slate-400">
                  0 workers assigned to this project.
                </div>
              ) : (
                <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400">
                        <th className="py-2 px-3 font-medium">Worker / Source</th>
                        <th className="py-2 px-3 font-medium">Evaluated State</th>
                        <th className="py-2 px-3 font-medium text-right">Heartbeat Age</th>
                        <th className="py-2 px-3 font-medium text-right">Progress Age</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {workerSummary.workers.map((w) => (
                        <tr key={w.workerId}>
                          <td className="py-2.5 px-3">
                            <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                              {w.name}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {w.role} · {w.source.emitterName}
                            </div>
                          </td>
                          <td className="py-2.5 px-3">
                            <div
                              className={`font-mono font-semibold ${
                                w.evaluatedState === 'active_running'
                                  ? 'text-teal-700 dark:text-teal-400'
                                  : w.evaluatedState === 'crashed' ||
                                    w.evaluatedState === 'failed'
                                  ? 'text-red-700 dark:text-red-400'
                                  : w.evaluatedState === 'stalled_progress' ||
                                    w.evaluatedState === 'unknown_expired_heartbeat'
                                  ? 'text-amber-800 dark:text-amber-400'
                                  : 'text-slate-700 dark:text-slate-300'
                              }`}
                            >
                              {w.evaluatedState}
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                              {w.statusExplanation}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-right tabular-nums text-slate-700 dark:text-slate-300">
                            {formatRelativeAge(w.lastHeartbeatAt, referenceNowIso)}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-right tabular-nums text-slate-700 dark:text-slate-300">
                            <div>
                              {formatRelativeAge(w.lastMeaningfulProgressAt, referenceNowIso)}
                            </div>
                            {w.lastProgressSummary && (
                              <div className="text-[10px] font-sans text-slate-500 dark:text-slate-400">
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

            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Worker Execution Runs ({runs.length})
              </h3>
              {runs.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No worker runs recorded for this project.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {runs.map((run) => (
                    <div
                      key={run.runId}
                      className="border border-slate-200 dark:border-slate-800 rounded-md p-3 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-2 font-mono">
                          <Terminal className="w-3.5 h-3.5 text-slate-500" />
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {run.runId}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-600 dark:text-slate-400">
                            {run.workerId}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="text-slate-600 dark:text-slate-400 tabular-nums">
                            {run.turnCount} turns
                          </span>
                        </div>
                        <span
                          className={`font-mono font-semibold ${
                            run.status === 'running'
                              ? 'text-teal-700 dark:text-teal-400'
                              : run.status === 'crashed' || run.status === 'failed'
                              ? 'text-red-700 dark:text-red-400'
                              : run.status === 'stalled'
                              ? 'text-amber-800 dark:text-amber-400'
                              : 'text-slate-800 dark:text-slate-200'
                          }`}
                        >
                          {run.status === 'succeeded_turn'
                            ? 'SUCCEEDED TURN (Not Project Completion)'
                            : run.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-slate-800 dark:text-slate-200 mb-1">{run.summary}</p>
                      {run.failureDiagnostic && (
                        <p className="font-mono text-[11px] text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded p-2 mt-1">
                          {run.failureDiagnostic}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: EVIDENCE LINKS & DEDUPLICATED TIMELINE */}
        {activeTab === 'evidence_timeline' && (
          <div className="space-y-5">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Verified Evidence & Artifacts ({evidence.length})
              </h3>
              {evidence.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No evidence artifacts linked yet.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {evidence.map((ev) => (
                    <div
                      key={ev.evidenceId}
                      className="border border-slate-200 dark:border-slate-800 rounded-md p-3 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                          <FileCode2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span>{ev.label}</span>
                        </div>
                        <span
                          className={`font-mono text-[11px] shrink-0 ${
                            ev.verified
                              ? 'text-teal-700 dark:text-teal-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {ev.verified ? 'Verified' : 'Unverified'}
                        </span>
                      </div>
                      <p className="text-slate-700 dark:text-slate-300 mb-1">{ev.summary}</p>
                      {ev.metricsSummary && (
                        <div className="font-mono text-[11px] text-slate-800 dark:text-slate-200 mb-1 tabular-nums">
                          Metrics: {ev.metricsSummary}
                        </div>
                      )}
                      <div className="font-mono text-[11px] text-slate-500 dark:text-slate-400 break-all bg-slate-50 dark:bg-slate-900 px-2 py-1 rounded border border-slate-200/80 dark:border-slate-800">
                        {ev.uriOrRef}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Deduplicated Activity Timeline ({events.length})
              </h3>
              {events.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No events recorded for this project.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {events.map((ev) => (
                    <div
                      key={ev.eventId}
                      className="border border-slate-200 dark:border-slate-800 rounded-md p-3 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-slate-500 dark:text-slate-400 mb-1">
                        <span className="font-mono font-medium text-slate-800 dark:text-slate-200">
                          {ev.actor} · {ev.category}
                        </span>
                        <span className="font-mono tabular-nums">
                          {formatRelativeAge(ev.timestamp, referenceNowIso)}
                        </span>
                      </div>
                      <div className="font-semibold text-slate-900 dark:text-slate-100 mb-0.5">
                        {ev.title}
                      </div>
                      <p className="text-slate-600 dark:text-slate-400">{ev.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 4: DECISIONS, NOTES & REMINDER RECEIPTS */}
        {activeTab === 'decisions_notes' && (
          <div className="space-y-5">
            <div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Unresolved Decisions ({allOpenDecisions.length})
              </h3>
              {allOpenDecisions.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
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
                        className="border border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 rounded-md p-3.5 text-xs"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-400 mb-1">
                          <span className="font-semibold text-amber-900 dark:text-amber-300">
                            Owner: {dec.owner}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono tabular-nums">
                            {formatRelativeAge(dec.createdAt, referenceNowIso)}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono">{dec.decisionId}</span>
                        </div>
                        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1">
                          {dec.exactPromptOrFailure}
                        </p>
                        <p className="text-slate-600 dark:text-slate-400 mb-2.5">
                          {dec.contextSummary}
                        </p>

                        <div className="grid grid-cols-1 gap-2 mb-2.5">
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
                              className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
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
                            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100"
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
                              noteVal || 'Resolved in Side Panel'
                            )
                          }
                          className="px-3 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded disabled:opacity-40 cursor-pointer"
                        >
                          Record Decision Resolution
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-5">
              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
                  Operator Notes ({project.notes.length})
                </h3>
                <form onSubmit={handleNoteSubmit} className="flex gap-2 mb-3">
                  <input
                    type="text"
                    placeholder="Add a persistent operator note..."
                    value={noteInput}
                    disabled={!capabilities.canAddNote}
                    onChange={(e) => setNoteInput(e.target.value)}
                    className="flex-1 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-3 py-1.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-600 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!capabilities.canAddNote || !noteInput.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <MessageSquarePlus className="w-3.5 h-3.5" />
                    <span>Add Note</span>
                  </button>
                </form>

                {project.notes.length > 0 && (
                  <div className="space-y-2">
                    {project.notes.map((n) => (
                      <div
                        key={n.noteId}
                        className="border border-slate-200 dark:border-slate-800 rounded p-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {n.author}
                          </span>
                          <span className="font-mono tabular-nums">
                            {formatRelativeAge(n.createdAt, referenceNowIso)}
                          </span>
                        </div>
                        <p className="text-slate-800 dark:text-slate-200">{n.body}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100 mb-1">
                  Owner Reminders & Delivery Receipts ({project.reminders.length})
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                  Distinguishes command acceptance from actual recipient delivery acknowledgment.
                </p>

                <form onSubmit={handleReminderSubmit} className="flex gap-2 mb-3">
                  <input
                    type="text"
                    placeholder={`Message to ${project.owner}...`}
                    value={reminderMessage}
                    disabled={!capabilities.canSendReminder}
                    onChange={(e) => setReminderMessage(e.target.value)}
                    className="flex-1 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-3 py-1.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-600 disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!capabilities.canSendReminder}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-40 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <Bell className="w-3.5 h-3.5" />
                    <span>Remind {project.owner}</span>
                  </button>
                </form>

                {project.reminders.length > 0 && (
                  <div className="space-y-2">
                    {project.reminders.map((rem) => (
                      <div
                        key={rem.reminderId}
                        className={`border rounded p-2.5 text-xs ${
                          rem.status === 'acknowledged'
                            ? 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40'
                            : rem.status === 'accepted_pending_delivery'
                            ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20'
                            : 'border-red-200 dark:border-red-900/60 bg-red-50/40 dark:bg-red-950/20'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 mb-0.5">
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            To: {rem.targetOwner} ({rem.deliveryChannel})
                          </span>
                          <span
                            className={`font-mono text-[11px] font-semibold ${
                              rem.status === 'acknowledged'
                                ? 'text-teal-700 dark:text-teal-400'
                                : rem.status === 'accepted_pending_delivery'
                                ? 'text-amber-800 dark:text-amber-400'
                                : 'text-red-700 dark:text-red-400'
                            }`}
                          >
                            {rem.status === 'acknowledged'
                              ? `DELIVERED & ACKED (${rem.ackId})`
                              : rem.status === 'accepted_pending_delivery'
                              ? 'ACCEPTED · DELIVERY PENDING'
                              : 'DELIVERY FAILED (NOT NOTIFIED)'}
                          </span>
                        </div>
                        {rem.errorMessage && (
                          <p className="text-red-800 dark:text-red-300 font-mono text-[11px]">
                            {rem.errorMessage}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
