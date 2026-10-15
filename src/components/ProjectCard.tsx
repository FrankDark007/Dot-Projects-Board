/**
 * @file src/components/ProjectCard.tsx
 * @description Alternate Project Card view displaying truthful status, owner, current milestone,
 * next action, remaining steps, latest useful result, blocker, separate confirmed-running vs
 * unknown worker counts, cost coverage, and expandable workflow diagram.
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
  PanelRightOpen,
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
  isSelected?: boolean;
  onSelectProject: (projectId: string) => void;
  onChangePriority: (projectId: string, priority: PriorityLevel) => void;
  onToggleArchive: (projectId: string, archive: boolean) => void;
  onSendReminder: (projectId: string, targetOwner: string, message: string) => void;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
  evaluated,
  referenceNowIso,
  capabilities,
  isSelected = false,
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
    inconsistentCompletionClaim,
    completionContradictionReason,
  } = evaluated;

  const currentMilestone = project.milestones.find(
    (m) => m.milestoneId === project.currentMilestoneId
  );

  const getStatusIcon = () => {
    switch (primaryStatusTone) {
      case 'active':
        return <Activity className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />;
      case 'verified':
        return <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />;
      case 'danger':
        return <XCircle className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />;
      default:
        return <PauseCircle className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />;
    }
  };

  const getStatusTextClass = () => {
    switch (primaryStatusTone) {
      case 'active':
      case 'verified':
        return 'text-teal-800 dark:text-teal-300 font-semibold';
      case 'danger':
        return 'text-red-700 dark:text-red-400 font-semibold';
      case 'warning':
        return 'text-amber-800 dark:text-amber-300 font-semibold';
      default:
        return 'text-slate-700 dark:text-slate-300 font-medium';
    }
  };

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

  const renderWorkerSummaryText = () => {
    if (!workerSummary.coverageKnown && workerSummary.confirmedRunningCount === null) {
      return 'Workers: Coverage unknown (never assumed 0)';
    }
    const parts: string[] = [];
    const confirmedProg = workerSummary.confirmedProgressingCount ?? 0;
    parts.push(`${confirmedProg} confirmed progressing`);
    if (workerSummary.stalledProgressCount > 0) {
      parts.push(`${workerSummary.stalledProgressCount} alive (stalled progress)`);
    }
    if (workerSummary.unknownExecutionCount > 0) {
      parts.push(`${workerSummary.unknownExecutionCount} unknown (heartbeat expired)`);
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
      className={`bg-white dark:bg-[#111827] border rounded-lg p-5 transition-colors ${
        isSelected
          ? 'border-sky-600 dark:border-sky-500'
          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
      }`}
    >
      {/* Top Row: Status + Metadata + Priority & Detail Actions */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-3.5">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 text-xs mb-1">
            <span className={`inline-flex items-center gap-1.5 ${getStatusTextClass()}`}>
              {getStatusIcon()}
              <span>{primaryStatusLabel}</span>
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
              ·
            </span>
            <span className="text-slate-600 dark:text-slate-400">
              Owner:{' '}
              <strong className="font-medium text-slate-900 dark:text-slate-100">
                {project.owner}
              </strong>
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
              ·
            </span>
            <span className="font-mono text-slate-500 dark:text-slate-400 tabular-nums">
              Last verified update: {formatRelativeAge(lastVerifiedUpdateAt, referenceNowIso)}
            </span>
            {project.archived && (
              <>
                <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                  ·
                </span>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Archived
                </span>
              </>
            )}
          </div>

          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
            <button
              type="button"
              onClick={() => onSelectProject(project.projectId)}
              className="text-left hover:text-sky-600 dark:hover:text-sky-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 rounded cursor-pointer"
            >
              {project.name}
            </button>
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {project.currentScope}
          </p>
        </div>

        {/* Right Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            <label
              htmlFor={`card-prio-${project.projectId}`}
              className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap"
            >
              Priority:
            </label>
            <select
              id={`card-prio-${project.projectId}`}
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
              className="text-xs font-medium bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-600 disabled:opacity-50 cursor-pointer"
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <PanelRightOpen className="w-3.5 h-3.5" />
            <span>Open Side Panel</span>
          </button>
        </div>
      </div>

      {/* Contradicted Completion Claim Warning */}
      {inconsistentCompletionClaim && completionContradictionReason && (
        <div className="bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 rounded-md p-3 mb-3.5 text-xs text-amber-950 dark:text-amber-200">
          <span className="font-semibold">Unverified Completion Claim: </span>
          <span>{completionContradictionReason}</span>
        </div>
      )}

      {/* Explicit Warning if Agent Turn Finished but Acceptance Gate Failed */}
      {executionFinishedButAcceptanceFailed && (
        <div className="bg-red-50/70 dark:bg-red-950/30 border border-red-200 dark:border-red-900/60 rounded-md p-3 mb-3.5 text-xs text-red-900 dark:text-red-200">
          <span className="font-semibold">
            Confirmed Failure — Execution turn finished, but project is NOT complete:{' '}
          </span>
          <span>
            Worker completed its coding session, yet {failedGateCount} required acceptance gate
            failed verification.
          </span>
        </div>
      )}

      {/* Blocker / Needs You Callout */}
      {(project.blocker || openDecisionsForMe.length > 0) && (
        <div
          className={`rounded-md p-3 mb-3.5 border text-xs ${
            project.blocker?.isConfirmedFailure
              ? 'bg-red-50/50 dark:bg-red-950/20 border-red-200 dark:border-red-900/50'
              : 'bg-amber-50/50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50'
          }`}
        >
          {project.blocker && (
            <div className="text-slate-900 dark:text-slate-100 mb-1.5 last:mb-0">
              <span
                className={`font-semibold ${
                  project.blocker.isConfirmedFailure
                    ? 'text-red-800 dark:text-red-300'
                    : 'text-amber-900 dark:text-amber-300'
                }`}
              >
                {project.blocker.isConfirmedFailure
                  ? 'Blocker (Confirmed Failure): '
                  : 'Blocker (Missing Info / Action): '}
              </span>
              <span>{project.blocker.summary}</span>
              <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums ml-2">
                (since {formatRelativeAge(project.blocker.since, referenceNowIso)} · owner:{' '}
                {project.blocker.owner})
              </span>
            </div>
          )}
          {openDecisionsForMe.map((dec) => (
            <div
              key={dec.decisionId}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1.5 first:pt-0 border-t first:border-t-0 border-slate-200/70 dark:border-slate-800"
            >
              <div>
                <span className="font-semibold text-amber-900 dark:text-amber-300">
                  Needs You:{' '}
                </span>
                <span className="text-slate-900 dark:text-slate-100">
                  {dec.exactPromptOrFailure}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onSelectProject(project.projectId)}
                className="text-xs font-semibold text-sky-700 dark:text-sky-400 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Answer in Panel
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Core 4-Column Operational Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 py-3.5 border-t border-b border-slate-200 dark:border-slate-800 text-xs">
        <div>
          <div className="text-slate-500 dark:text-slate-400 mb-1">
            Current Milestone & Scope
          </div>
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            {currentMilestone ? currentMilestone.title : 'All Milestones Complete'}
          </div>
          <div className="text-slate-600 dark:text-slate-400 font-mono tabular-nums mt-1">
            {remainingMilestoneCount} of {totalMilestoneCount} milestones remaining ·{' '}
            {remainingStepCount} steps left
          </div>
        </div>

        <div>
          <div className="text-slate-500 dark:text-slate-400 mb-1">Next Action</div>
          <div className="text-slate-900 dark:text-slate-100 leading-snug">
            {project.nextAction}
          </div>
        </div>

        <div>
          <div className="text-slate-500 dark:text-slate-400 mb-1">
            Latest Verified Useful Result
          </div>
          {project.latestUsefulResult ? (
            <>
              <div className="text-slate-900 dark:text-slate-100 leading-snug">
                {project.latestUsefulResult.summary}
              </div>
              <div className="text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-1">
                Observed {formatRelativeAge(project.latestUsefulResult.observedAt, referenceNowIso)}
              </div>
            </>
          ) : (
            <div className="text-slate-500 dark:text-slate-400">
              No verified output recorded yet.
            </div>
          )}
        </div>

        <div>
          <div className="text-slate-500 dark:text-slate-400 mb-1">
            Workers, Gates & Cost Coverage
          </div>
          <div className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {renderWorkerSummaryText()}
          </div>
          <div className="text-slate-600 dark:text-slate-400 font-mono tabular-nums mt-1">
            Gates: {passedGateCount} passed · {failedGateCount} failed · {pendingGateCount}{' '}
            pending
          </div>
          <div className="text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-1">
            {renderCostSummary()}
          </div>
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setWorkflowExpanded((prev) => !prev)}
            aria-expanded={workflowExpanded}
            className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer whitespace-nowrap shrink-0"
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
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                ·
              </span>
              <span className="font-mono text-slate-600 dark:text-slate-400 tabular-nums">
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
                : `Send status check reminder to ${project.owner}`
            }
            onClick={() =>
              onSendReminder(
                project.projectId,
                project.owner,
                `Status check requested on ${project.name}: ${project.nextAction}`
              )
            }
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Bell className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
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
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
          >
            {project.archived ? (
              <>
                <ArchiveRestore className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                <span>Unarchive</span>
              </>
            ) : (
              <>
                <Archive className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                <span>Archive</span>
              </>
            )}
          </button>
        </div>
      </div>

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
