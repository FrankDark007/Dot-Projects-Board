/**
 * @file src/components/TodayView.tsx
 * @description Focused Today view showing verified accomplishments (backed by evidence),
 * current active work, and upcoming milestones without inventing time savings or percentages.
 */

import React from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileCode2,
  PanelRightOpen,
} from 'lucide-react';
import { EvaluatedProject, evaluateWorker } from '../engine/stateEvaluator';
import { MissionControlSnapshot } from '../schema/contract';
import { formatRelativeAge } from '../utils/timeFormat';

interface TodayViewProps {
  snapshot: MissionControlSnapshot;
  evaluatedProjects: EvaluatedProject[];
  referenceNowIso: string;
  onSelectProject: (projectId: string) => void;
}

export const TodayView: React.FC<TodayViewProps> = ({
  snapshot,
  evaluatedProjects,
  referenceNowIso,
  onSelectProject,
}) => {
  const activeProjects = evaluatedProjects.filter((ep) => !ep.project.archived);

  // 1. Verified Accomplishments (verified evidence items & passed required gates)
  const verifiedEvidence = snapshot.evidence.filter((ev) => ev.verified);

  // 2. Current Work (workers that are confirmed alive: active_running or stalled_progress)
  const evaluatedWorkers = snapshot.workers.map((w) =>
    evaluateWorker(w, referenceNowIso, snapshot.evaluationThresholds)
  );
  const confirmedAliveWorkers = evaluatedWorkers.filter((w) => w.isConfirmedAlive);

  // 3. Upcoming Milestones (in_progress or pending milestones on non-archived projects)
  const upcomingMilestones = activeProjects.flatMap((ep) =>
    ep.project.milestones
      .filter((m) => m.status !== 'completed_verified')
      .map((m) => ({
        project: ep.project,
        milestone: m,
      }))
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
          Today — Operational Focus
        </h2>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
          Showing only verified accomplishments backed by evidence, confirmed running worker
          processes, and remaining milestone steps. No completion percentages or time-savings
          estimates are fabricated.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 min-w-0">
        {/* Column 1: Current Work (Confirmed Running Workers) */}
        <section
          aria-label="Current Work in Flight"
          className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col min-w-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-200 dark:border-slate-800 min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100 min-w-0">
              <Activity className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
              <span className="min-w-0 break-words">Current Work (Confirmed Alive)</span>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
              {confirmedAliveWorkers.length} workers
            </span>
          </div>

          {confirmedAliveWorkers.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              0 workers currently confirmed running with a fresh heartbeat.
            </p>
          ) : (
            <div className="space-y-3 min-w-0">
              {confirmedAliveWorkers.map((w) => {
                const proj = snapshot.projects.find((p) => p.projectId === w.projectId);
                return (
                  <div
                    key={w.workerId}
                    className="border border-slate-200 dark:border-slate-800 rounded-md p-3 text-xs min-w-0"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1 min-w-0">
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 min-w-0 break-words [overflow-wrap:anywhere]">
                        {w.name}
                      </span>
                      <span
                        className={`font-mono text-[11px] font-semibold ${
                          w.evaluatedState === 'active_running'
                            ? 'text-teal-700 dark:text-teal-400'
                            : 'text-amber-800 dark:text-amber-400'
                        }`}
                      >
                        {w.evaluatedState === 'active_running'
                          ? 'Progressing'
                          : 'Alive · Progress Stalled'}
                      </span>
                    </div>

                    {proj && (
                      <button
                        type="button"
                        onClick={() => onSelectProject(proj.projectId)}
                        className="font-medium text-sky-700 dark:text-sky-400 hover:underline text-left block mb-1 min-w-0 break-words [overflow-wrap:anywhere] cursor-pointer"
                      >
                        {proj.name}
                      </button>
                    )}

                    <p className="text-slate-700 dark:text-slate-300 mb-1.5 min-w-0 break-words [overflow-wrap:anywhere]">
                      {w.currentTaskSummary || 'Assigned to project'}
                    </p>

                    <div className="flex flex-wrap items-center gap-2 text-[11px] font-mono text-slate-500 dark:text-slate-400 tabular-nums min-w-0">
                      <span>HB: {formatRelativeAge(w.lastHeartbeatAt, referenceNowIso)}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Progress: {formatRelativeAge(w.lastMeaningfulProgressAt, referenceNowIso)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Column 2: Verified Accomplishments */}
        <section
          aria-label="Verified Accomplishments"
          className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col min-w-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-200 dark:border-slate-800 min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100 min-w-0">
              <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
              <span className="min-w-0 break-words">Verified Accomplishments &amp; Evidence</span>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
              {verifiedEvidence.length} artifacts
            </span>
          </div>

          {verifiedEvidence.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              No verified accomplishments recorded yet.
            </p>
          ) : (
            <div className="space-y-3 min-w-0">
              {verifiedEvidence.map((ev) => {
                const proj = snapshot.projects.find((p) => p.projectId === ev.projectId);
                return (
                  <div
                    key={ev.evidenceId}
                    className="border border-slate-200 dark:border-slate-800 rounded-md p-3 text-xs min-w-0"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 mb-1 min-w-0">
                      <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100 min-w-0">
                        <FileCode2 className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                        <span className="min-w-0 break-words [overflow-wrap:anywhere]">
                          {ev.label}
                        </span>
                      </div>
                      <span className="font-mono text-[10px] text-slate-400 tabular-nums shrink-0">
                        {formatRelativeAge(ev.createdAt, referenceNowIso)}
                      </span>
                    </div>
                    {proj && (
                      <button
                        type="button"
                        onClick={() => onSelectProject(proj.projectId)}
                        className="text-[11px] font-medium text-sky-700 dark:text-sky-400 hover:underline block mb-1 min-w-0 break-words [overflow-wrap:anywhere] text-left cursor-pointer"
                      >
                        {proj.name}
                      </button>
                    )}
                    <p className="text-slate-600 dark:text-slate-300 mb-1 min-w-0 break-words [overflow-wrap:anywhere]">
                      {ev.summary}
                    </p>
                    {ev.metricsSummary && (
                      <div className="font-mono text-[11px] text-slate-700 dark:text-slate-300 tabular-nums min-w-0 break-words [overflow-wrap:anywhere]">
                        {ev.metricsSummary}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Column 3: Upcoming Milestones & Remaining Steps */}
        <section
          aria-label="Upcoming Milestones"
          className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-4 flex flex-col min-w-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-3 border-b border-slate-200 dark:border-slate-800 min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-900 dark:text-slate-100 min-w-0">
              <Clock className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />
              <span className="min-w-0 break-words">
                Upcoming Milestones &amp; Remaining Steps
              </span>
            </div>
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
              {upcomingMilestones.length} active
            </span>
          </div>

          {upcomingMilestones.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              All active milestones are verified complete.
            </p>
          ) : (
            <div className="space-y-3 min-w-0">
              {upcomingMilestones.map(({ project, milestone }) => (
                <div
                  key={`${project.projectId}-${milestone.milestoneId}`}
                  className="border border-slate-200 dark:border-slate-800 rounded-md p-3 text-xs min-w-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1 min-w-0">
                    <span className="font-semibold text-slate-900 dark:text-slate-100 min-w-0 break-words [overflow-wrap:anywhere]">
                      0{milestone.order}. {milestone.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectProject(project.projectId)}
                      className="min-h-[28px] inline-flex items-center gap-1 text-[11px] font-medium text-sky-700 dark:text-sky-400 hover:underline shrink-0 cursor-pointer"
                    >
                      <PanelRightOpen className="w-3 h-3" />
                      <span>Open</span>
                    </button>
                  </div>

                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-1.5 min-w-0 break-words [overflow-wrap:anywhere]">
                    {project.name} · Owner: {project.owner}
                  </div>

                  {milestone.status === 'failed_acceptance' && (
                    <div className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-700 dark:text-red-400 mb-1.5">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>Acceptance gate failed — remediation required</span>
                    </div>
                  )}

                  {milestone.remainingSteps.length > 0 && (
                    <ul className="space-y-1 text-[11px] text-slate-600 dark:text-slate-300 pl-3.5 list-disc min-w-0">
                      {milestone.remainingSteps.map((step, idx) => (
                        <li key={idx} className="break-words [overflow-wrap:anywhere]">
                          {step}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
