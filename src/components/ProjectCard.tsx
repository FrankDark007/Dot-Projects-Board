/**
 * @file src/components/ProjectCard.tsx
 * @description Project card component displaying truthful status, owner, current milestone,
 * next action, remaining steps, latest useful result, blocker, active worker count,
 * cost coverage, last verified update, and expandable workflow diagram.
 */

import React, { useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  ExternalLink,
  HelpCircle,
  PauseCircle,
  XCircle,
} from 'lucide-react';
import { EvaluatedProject } from '../engine/stateEvaluator';
import { BackendCapabilities, PriorityLevel } from '../schema/contract';
import { formatRelativeAge } from '../utils/timeFormat';
import { WorkflowDiagram } from './WorkflowDiagram';

interface ProjectCardProps {
  evaluated: EvaluatedProject;
  referenceNowIso: string;
  capabilities: BackendCapabilities;
  onSelectProject: (projectId: string) => void;
  onChangePriority: (projectId: string, priority: PriorityLevel) => void;
  onToggleArchive: (projectId: string, archive: boolean) => void;
  onSendReminder: (projectId: string, targetOwner: string, message: string) => void;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  evaluated,
  referenceNowIso,
  capabilities,
  onSelectProject,
  onChangePriority,
  onToggleArchive,
  onSendReminder,
}) => {
  const [workflowExpanded, setWorkflowExpanded] = useState(false);

  const {
    project,
    primaryStatusLabel,
    primaryStatusTone,
    workerSummary,
    openDecisionsForMe,
    remainingMilestoneCount,
    totalMilestoneCount,
    remainingStepCount,
    passedGateCount,
    failedGateCount,
    pendingGateCount,
    lastVerifiedUpdateAt,
    executionFinishedButAcceptanceFailed,
  } = evaluated;

  const currentMilestone = project.milestones.find(
    (m) => m.milestoneId === project.currentMilestoneId
  );

  const getStatusIcon = () => {
    switch (primaryStatusTone) {
      case 'active':
        return <Activity className="w-4 h-4 text-emerald-700 shrink-0" />;
      case 'verified':
        return <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />;
      case 'danger':
        return <XCircle className="w-4 h-4 text-red-700 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />;
      default:
        return <PauseCircle className="w-4 h-4 text-slate-500 shrink-0" />;
    }
  };

  const getStatusTextClass = () => {
    switch (primaryStatusTone) {
      case 'active':
      case 'verified':
        return 'text-emerald-800 font-semibold';
      case 'danger':
        return 'text-red-700 font-semibold';
      case 'warning':
        return 'text-amber-800 font-semibold';
      default:
        return 'text-slate-700 font-medium';
    }
  };

  // Format cost truthfully without inventing numbers
  const renderCostSummary = () => {
    const { cost } = project;
    if (cost.coverage === 'unavailable' || cost.knownUsd === null) {
      return 'Cost: Unavailable (unmetered)';
    }
    const amount = `$${cost.knownUsd.toFixed(2)}`;
    if (cost.coverage === 'partial' || cost.isEstimate) {
      return `Cost: ${amount} known (Partial · Estimate)`;
    }
    return `Cost: ${amount} (Verified)`;
  };

  // Format worker count truthfully
  const renderWorkerSummaryText = () => {
    if (!workerSummary.coverageKnown || workerSummary.activeRunningCount === null) {
      return 'Active workers: Unknown (coverage unavailable)';
    }
    const parts: string[] = [`${workerSummary.activeRunningCount} running`];
    if (workerSummary.stalledProgressCount > 0) {
      parts.push(`${workerSummary.stalledProgressCount} stalled (heartbeat only)`);
    }
    if (workerSummary.staleHeartbeatCount > 0) {
      parts.push(`${workerSummary.staleHeartbeatCount} stale heartbeat`);
    }
    if (workerSummary.crashedOrFailedCount > 0) {
      parts.push(`${workerSummary.crashedOrFailedCount} crashed/failed`);
    }
    if (workerSummary.idleOrQueuedCount > 0) {
      parts.push(`${workerSummary.idleOrQueuedCount} idle`);
    }
    return `Workers: ${parts.join(' · ')}`;
  };

  return (
    <article
      aria-label={`Project: ${project.name}`}
      className="bg-white border border-slate-200 rounded-xl p-6 transition-colors hover:border-slate-300"
    >
      {/* Top Row: Status + Metadata + Priority & Detail Actions */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-4">
        <div className="min-w-0 flex-1">
          {/* Unboxed status + metadata line (Zero-Pill Discipline) */}
          <div className="flex flex-wrap items-center gap-2 text-xs mb-1.5">
            <span className={`inline-flex items-center gap-1.5 ${getStatusTextClass()}`}>
              {getStatusIcon()}
              <span>{primaryStatusLabel}</span>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="text-slate-600">
              Owner: <strong className="font-medium text-slate-900">{project.owner}</strong>
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="font-mono text-slate-500 tabular-nums">
              Last verified update: {formatRelativeAge(lastVerifiedUpdateAt, referenceNowIso)}
            </span>
            {project.archived && (
              <>
                <span aria-hidden="true" className="text-slate-300">
                  ·
                </span>
                <span className="font-semibold text-slate-700">Archived</span>
              </>
            )}
          </div>

          <h3 className="text-lg font-semibold text-slate-900 tracking-tight">
            <button
              type="button"
              onClick={() => onSelectProject(project.projectId)}
              className="text-left hover:underline underline-offset-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 rounded cursor-pointer"
            >
              {project.name}
            </button>
          </h3>
          <p className="text-xs text-slate-600 mt-1">{project.currentScope}</p>
        </div>

        {/* Right Controls: Priority selector + Inspect Detail */}
        <div className="flex items-center gap-2.5 shrink-0">
          <div className="flex items-center gap-1.5">
            <label
              htmlFor={`prio-${project.projectId}`}
              className="text-xs text-slate-500 whitespace-nowrap"
            >
              Priority:
            </label>
            <select
              id={`prio-${project.projectId}`}
              value={project.priority}
              disabled={!capabilities.canChangePriority}
              title={
                !capabilities.canChangePriority
                  ? capabilities.reasonIfDisabled || 'Priority changes disabled'
                  : 'Change project priority'
              }
              onChange={(e) =>
                onChangePriority(project.projectId, e.target.value as PriorityLevel)
              }
              className="text-xs font-medium bg-slate-50 border border-slate-300 rounded-md px-2 py-1 text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50 cursor-pointer"
            >
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low</option>
            </select>
          </div>

          <button
            type="button"
            onClick={() => onSelectProject(project.projectId)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Inspect Detail</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Explicit Warning if Agent Turn Finished but Acceptance Gate Failed */}
      {executionFinishedButAcceptanceFailed && (
        <div className="bg-red-50/70 border border-red-200 rounded-lg p-3 mb-4 text-xs text-red-900">
          <span className="font-semibold">
            Execution turn finished, but project is NOT complete:{' '}
          </span>
          <span>
            Worker completed its coding session, yet {failedGateCount} required acceptance gate
            failed verification.
          </span>
        </div>
      )}

      {/* Blocker / Waiting For Me Callout (Single hairline border, no thick left bar) */}
      {(project.blocker || openDecisionsForMe.length > 0) && (
        <div className="bg-amber-50/60 border border-amber-200/90 rounded-lg p-3.5 mb-4">
          {project.blocker && (
            <div className="text-xs text-slate-900 mb-1.5 last:mb-0">
              <span className="font-semibold text-amber-900">Blocker: </span>
              <span>{project.blocker.summary}</span>
              <span className="text-slate-500 font-mono tabular-nums ml-2">
                (since {formatRelativeAge(project.blocker.since, referenceNowIso)} · owner:{' '}
                {project.blocker.owner})
              </span>
            </div>
          )}
          {openDecisionsForMe.map((dec) => (
            <div
              key={dec.decisionId}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs pt-1.5 first:pt-0 border-t first:border-t-0 border-amber-200/60"
            >
              <div>
                <span className="font-semibold text-amber-900">Needs You: </span>
                <span className="text-slate-900">{dec.exactPromptOrFailure}</span>
              </div>
              <button
                type="button"
                onClick={() => onSelectProject(project.projectId)}
                className="text-xs font-semibold text-amber-900 underline underline-offset-4 hover:text-slate-900 whitespace-nowrap shrink-0 cursor-pointer"
              >
                Answer in Detail
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Core 4-Column Operational Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 py-4 border-t border-b border-slate-200 text-xs">
        {/* Col 1: Current Milestone & Remaining Work */}
        <div>
          <div className="text-slate-500 mb-1">Current Milestone & Scope</div>
          <div className="font-semibold text-slate-900">
            {currentMilestone ? currentMilestone.title : 'All Milestones Complete'}
          </div>
          <div className="text-slate-600 font-mono tabular-nums mt-1">
            {remainingMilestoneCount} of {totalMilestoneCount} milestones remaining ·{' '}
            {remainingStepCount} steps left
          </div>
        </div>

        {/* Col 2: Next Action */}
        <div>
          <div className="text-slate-500 mb-1">Next Action</div>
          <div className="text-slate-900 leading-snug">{project.nextAction}</div>
        </div>

        {/* Col 3: Latest Useful Result */}
        <div>
          <div className="text-slate-500 mb-1">Latest Verified Useful Result</div>
          {project.latestUsefulResult ? (
            <>
              <div className="text-slate-900 leading-snug">
                {project.latestUsefulResult.summary}
              </div>
              <div className="text-slate-500 font-mono tabular-nums mt-1">
                Observed {formatRelativeAge(project.latestUsefulResult.observedAt, referenceNowIso)}
              </div>
            </>
          ) : (
            <div className="text-slate-500">No verified output recorded yet.</div>
          )}
        </div>

        {/* Col 4: Execution & Acceptance Telemetry */}
        <div>
          <div className="text-slate-500 mb-1">Workers, Gates & Cost Coverage</div>
          <div className="font-mono tabular-nums text-slate-900">
            {renderWorkerSummaryText()}
          </div>
          <div className="text-slate-600 font-mono tabular-nums mt-1">
            Gates: {passedGateCount} passed · {failedGateCount} failed · {pendingGateCount}{' '}
            pending
          </div>
          <div className="text-slate-500 font-mono tabular-nums mt-1">
            {renderCostSummary()}
          </div>
        </div>
      </div>

      {/* Bottom Action Bar: Expandable Workflow Diagram + Operator Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3.5 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setWorkflowExpanded((prev) => !prev)}
            aria-expanded={workflowExpanded}
            className="inline-flex items-center gap-1.5 font-medium text-slate-700 hover:text-slate-900 cursor-pointer whitespace-nowrap shrink-0"
          >
            {workflowExpanded ? (
              <>
                <ChevronUp className="w-4 h-4" />
                <span>Hide Workflow & Acceptance Gates</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" />
                <span>
                  Expand Workflow & Acceptance Gates ({project.milestones.length} milestones)
                </span>
              </>
            )}
          </button>

          {project.deployedRevision && (
            <>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="font-mono text-slate-600 tabular-nums">
                Deployed: {project.deployedRevision.versionOrSha} (
                {project.deployedRevision.environment})
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!capabilities.canSendReminder}
            title={
              !capabilities.canSendReminder
                ? capabilities.reasonIfDisabled || 'Reminders unavailable'
                : `Send status check reminder to ${project.owner} (requires delivery ack)`
            }
            onClick={() =>
              onSendReminder(
                project.projectId,
                project.owner,
                `Status check requested on ${project.name}: ${project.nextAction}`
              )
            }
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Bell className="w-3.5 h-3.5 text-slate-500" />
            <span>Remind {project.owner}</span>
          </button>

          <button
            type="button"
            disabled={!capabilities.canArchive}
            title={
              !capabilities.canArchive
                ? capabilities.reasonIfDisabled || 'Archiving disabled'
                : project.archived
                ? 'Restore project to active list'
                : 'Archive project (does not delete files or cancel running jobs)'
            }
            onClick={() => onToggleArchive(project.projectId, !project.archived)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
          >
            {project.archived ? (
              <>
                <ArchiveRestore className="w-3.5 h-3.5 text-slate-500" />
                <span>Unarchive</span>
              </>
            ) : (
              <>
                <Archive className="w-3.5 h-3.5 text-slate-500" />
                <span>Archive</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Expandable Workflow Diagram */}
      {workflowExpanded && (
        <div className="mt-4">
          <WorkflowDiagram
            milestones={project.milestones}
            currentMilestoneId={project.currentMilestoneId}
            referenceNowIso={referenceNowIso}
          />
        </div>
      )}
    </article>
  );
};
