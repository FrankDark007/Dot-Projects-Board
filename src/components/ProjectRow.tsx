/**
 * @file src/components/ProjectRow.tsx
 * @description Linear-inspired compact project row (default view) showing project name,
 * owner, current milestone, next action, truthful activity status (separating confirmed
 * running from unknown), and blocker without excessive clutter.
 */

import React from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  ArchiveRestore,
  Bell,
  CheckCircle2,
  PanelRightOpen,
  PauseCircle,
  XCircle,
} from 'lucide-react';
import { EvaluatedProject } from '../engine/stateEvaluator';
import { BackendCapabilities, PriorityLevel } from '../schema/contract';
import { formatRelativeAge } from '../utils/timeFormat';

interface ProjectRowProps {
  evaluated: EvaluatedProject;
  referenceNowIso: string;
  capabilities: BackendCapabilities;
  isSelected: boolean;
  onSelectProject: (projectId: string) => void;
  onChangePriority: (projectId: string, priority: PriorityLevel) => void;
  onToggleArchive: (projectId: string, archive: boolean) => void;
  onSendReminder: (projectId: string, targetOwner: string, message: string) => void;
}

export const ProjectRow: React.FC<ProjectRowProps> = ({
  evaluated,
  referenceNowIso,
  capabilities,
  isSelected,
  onSelectProject,
  onChangePriority,
  onToggleArchive,
  onSendReminder,
}) => {
  const {
    project,
    primaryStatusLabel,
    primaryStatusTone,
    workerSummary,
    remainingMilestoneCount,
    totalMilestoneCount,
    remainingStepCount,
    lastVerifiedUpdateAt,
  } = evaluated;

  const currentMilestone = project.milestones.find(
    (m) => m.milestoneId === project.currentMilestoneId
  );

  const renderStatusIcon = () => {
    switch (primaryStatusTone) {
      case 'active':
        return <Activity className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />;
      case 'verified':
        return <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400 shrink-0" />;
      case 'danger':
        return <XCircle className="w-3.5 h-3.5 text-red-700 dark:text-red-400 shrink-0" />;
      case 'warning':
        return <AlertTriangle className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 shrink-0" />;
      default:
        return <PauseCircle className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />;
    }
  };

  const getStatusTextColor = () => {
    switch (primaryStatusTone) {
      case 'active':
      case 'verified':
        return 'text-teal-800 dark:text-teal-300 font-semibold';
      case 'danger':
        return 'text-red-700 dark:text-red-400 font-semibold';
      case 'warning':
        return 'text-amber-800 dark:text-amber-300 font-semibold';
      default:
        return 'text-slate-600 dark:text-slate-400 font-medium';
    }
  };

  const renderCompactWorkerActivity = () => {
    if (!workerSummary.coverageKnown && workerSummary.confirmedRunningCount === null) {
      return 'Coverage unknown';
    }
    const segments: string[] = [];
    const confirmed = workerSummary.confirmedRunningCount ?? 0;
    const progressing = workerSummary.confirmedProgressingCount ?? 0;
    const stalled = workerSummary.stalledProgressCount;

    if (progressing > 0) {
      segments.push(`${progressing} running`);
    }
    if (stalled > 0) {
      segments.push(`${stalled} alive (stalled)`);
    }
    if (confirmed === 0 && workerSummary.unknownExecutionCount === 0 && workerSummary.crashedOrFailedCount === 0) {
      segments.push('0 running');
    }
    if (workerSummary.crashedOrFailedCount > 0) {
      segments.push(`${workerSummary.crashedOrFailedCount} crashed`);
    }
    if (workerSummary.unknownExecutionCount > 0) {
      segments.push(`${workerSummary.unknownExecutionCount} unknown (hb expired)`);
    }
    return segments.join(' · ');
  };

  return (
    <div
      data-testid={`project-row-${project.projectId}`}
      className={`group border-b last:border-b-0 border-slate-200 dark:border-slate-800 px-4 py-3.5 transition-colors ${
        isSelected
          ? 'bg-sky-50/70 dark:bg-sky-950/30'
          : 'bg-white dark:bg-[#111827] hover:bg-slate-50/80 dark:hover:bg-slate-900/50'
      }`}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start lg:items-center">
        {/* Col 1-4: Project Name, Status, Owner & Last Update */}
        <div className="lg:col-span-4 min-w-0">
          <div className="flex items-center gap-2 text-xs mb-1">
            <span className={`inline-flex items-center gap-1.5 ${getStatusTextColor()}`}>
              {renderStatusIcon()}
              <span className="truncate">{primaryStatusLabel}</span>
            </span>
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
              ·
            </span>
            <span className="text-slate-500 dark:text-slate-400 truncate">
              {project.owner}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onSelectProject(project.projectId)}
            title={project.name}
            className="text-sm font-semibold text-slate-900 dark:text-slate-100 hover:text-sky-600 dark:hover:text-sky-400 text-left truncate block w-full cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-600 rounded"
          >
            {project.name}
          </button>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
            <span>{renderCompactWorkerActivity()}</span>
            <span aria-hidden="true">·</span>
            <span>Updated {formatRelativeAge(lastVerifiedUpdateAt, referenceNowIso)}</span>
          </div>
        </div>

        {/* Col 5-7: Current Milestone & Remaining Work */}
        <div className="lg:col-span-3 min-w-0 text-xs">
          <div
            className="font-medium text-slate-800 dark:text-slate-200 truncate"
            title={currentMilestone ? currentMilestone.title : 'All Milestones Complete'}
          >
            {currentMilestone ? currentMilestone.title : 'All Milestones Complete'}
          </div>
          <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums mt-0.5">
            {remainingMilestoneCount}/{totalMilestoneCount} milestones left · {remainingStepCount}{' '}
            steps
          </div>
        </div>

        {/* Col 8-10: Next Action or Blocker */}
        <div className="lg:col-span-3 min-w-0 text-xs">
          {project.blocker ? (
            <div
              className={
                project.blocker.isConfirmedFailure
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-amber-800 dark:text-amber-300'
              }
            >
              <span className="font-semibold">
                {project.blocker.isConfirmedFailure ? 'Blocker (Failure): ' : 'Blocker: '}
              </span>
              <span className="line-clamp-2">{project.blocker.summary}</span>
            </div>
          ) : (
            <div className="text-slate-600 dark:text-slate-300 line-clamp-2">
              <span className="font-medium text-slate-800 dark:text-slate-200">Next: </span>
              {project.nextAction}
            </div>
          )}
        </div>

        {/* Col 11-12: Priority & Compact Controls */}
        <div className="lg:col-span-2 flex items-center justify-end gap-1.5 shrink-0">
          <select
            aria-label={`Priority for ${project.name}`}
            value={project.priority}
            disabled={!capabilities.canChangePriority}
            title={
              !capabilities.canChangePriority
                ? capabilities.reasonIfDisabled || 'Priority changes disabled in read-only mode'
                : 'Change priority'
            }
            onChange={(e) =>
              onChangePriority(project.projectId, e.target.value as PriorityLevel)
            }
            className="text-xs font-medium bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2 py-1 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-sky-600 disabled:opacity-50 cursor-pointer"
          >
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>

          <button
            type="button"
            disabled={!capabilities.canSendReminder}
            title={
              !capabilities.canSendReminder
                ? capabilities.reasonIfDisabled || 'Reminders disabled'
                : `Remind ${project.owner}`
            }
            onClick={() =>
              onSendReminder(
                project.projectId,
                project.owner,
                `Status check on ${project.name}: ${project.nextAction}`
              )
            }
            aria-label={`Remind ${project.owner} on ${project.name}`}
            className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Bell className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            disabled={!capabilities.canArchive}
            title={
              !capabilities.canArchive
                ? capabilities.reasonIfDisabled || 'Archive disabled'
                : project.archived
                ? 'Unarchive project'
                : 'Archive project'
            }
            onClick={() => onToggleArchive(project.projectId, !project.archived)}
            aria-label={
              project.archived ? `Unarchive ${project.name}` : `Archive ${project.name}`
            }
            className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            {project.archived ? (
              <ArchiveRestore className="w-3.5 h-3.5" />
            ) : (
              <Archive className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={() => onSelectProject(project.projectId)}
            aria-label={`Open side panel for ${project.name}`}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <PanelRightOpen className="w-3.5 h-3.5" />
            <span>Details</span>
          </button>
        </div>
      </div>
    </div>
  );
};
