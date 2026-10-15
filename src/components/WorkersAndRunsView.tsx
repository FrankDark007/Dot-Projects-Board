/**
 * @file src/components/WorkersAndRunsView.tsx
 * @description Dedicated Workers & Runs table view separating process liveness,
 * meaningful task progress, and unknown coverage.
 */

import React from 'react';
import { evaluateWorker } from '../engine/stateEvaluator';
import { MissionControlSnapshot } from '../schema/contract';
import { formatRelativeAge } from '../utils/timeFormat';

interface WorkersAndRunsViewProps {
  snapshot: MissionControlSnapshot;
  referenceNowIso: string;
  onSelectProject: (projectId: string) => void;
}

export const WorkersAndRunsView: React.FC<WorkersAndRunsViewProps> = ({
  snapshot,
  referenceNowIso,
  onSelectProject,
}) => {
  const evaluatedWorkers = snapshot.workers.map((w) =>
    evaluateWorker(w, referenceNowIso, snapshot.evaluationThresholds)
  );

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3.5 mb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Worker Execution, Liveness & Progress Telemetry ({evaluatedWorkers.length} registered)
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              A worker with a fresh heartbeat (&le;
              {snapshot.evaluationThresholds.heartbeatExpirySeconds}s) is confirmed alive, even if
              progress is stalled (&gt;
              {Math.floor(snapshot.evaluationThresholds.stalledProgressSeconds / 60)}m). An expired
              heartbeat without authoritative stop proof makes execution state UNKNOWN.
            </p>
          </div>
        </div>

        <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400">
                <th className="py-2.5 px-3 font-medium">Worker ID & Role</th>
                <th className="py-2.5 px-3 font-medium">Project</th>
                <th className="py-2.5 px-3 font-medium">Evaluated State</th>
                <th className="py-2.5 px-3 font-medium text-right">Heartbeat Age</th>
                <th className="py-2.5 px-3 font-medium text-right">Meaningful Progress Age</th>
                <th className="py-2.5 px-3 font-medium">Diagnostic / Latest Output</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {evaluatedWorkers.map((w) => {
                const project = snapshot.projects.find((p) => p.projectId === w.projectId);
                return (
                  <tr
                    key={w.workerId}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-900/40"
                  >
                    <td className="py-3 px-3">
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {w.name}
                      </div>
                      <div className="text-slate-500 dark:text-slate-400">
                        {w.role} · {w.hostLabel}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {project ? (
                        <button
                          type="button"
                          onClick={() => onSelectProject(project.projectId)}
                          className="font-medium text-sky-700 dark:text-sky-400 hover:underline text-left cursor-pointer"
                        >
                          {project.name}
                        </button>
                      ) : (
                        <span className="text-slate-400">Unassigned</span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`font-mono font-semibold ${
                          w.evaluatedState === 'active_running'
                            ? 'text-teal-700 dark:text-teal-400'
                            : w.evaluatedState === 'crashed' || w.evaluatedState === 'failed'
                            ? 'text-red-700 dark:text-red-400'
                            : w.evaluatedState === 'stalled_progress' ||
                              w.evaluatedState === 'unknown_expired_heartbeat'
                            ? 'text-amber-800 dark:text-amber-400'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {w.evaluatedState}
                      </span>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        raw: {w.rawStatus}
                      </div>
                    </td>
                    <td className="py-3 px-3 font-mono text-right tabular-nums text-slate-700 dark:text-slate-300">
                      {formatRelativeAge(w.lastHeartbeatAt, referenceNowIso)}
                    </td>
                    <td className="py-3 px-3 font-mono text-right tabular-nums text-slate-700 dark:text-slate-300">
                      {formatRelativeAge(w.lastMeaningfulProgressAt, referenceNowIso)}
                    </td>
                    <td className="py-3 px-3 text-slate-700 dark:text-slate-300 max-w-md">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {w.statusExplanation}
                      </div>
                      {w.lastProgressSummary && (
                        <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                          {w.lastProgressSummary}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
          Projects with Unknown Worker Telemetry Coverage
        </h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
          When worker execution coverage is unavailable, the dashboard reports{' '}
          <code className="font-mono text-slate-900 dark:text-slate-100">Unknown</code> rather
          than fabricating 0 active workers. Missing telemetry alone never marks a project
          stalled.
        </p>
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {snapshot.projects
            .filter((p) => !p.workerCoverageKnown)
            .map((p) => (
              <div
                key={p.projectId}
                className="py-2.5 first:pt-0 last:pb-0 flex items-center justify-between gap-4 text-xs"
              >
                <div>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {p.name}
                  </span>
                  <span aria-hidden="true" className="mx-2 text-slate-300 dark:text-slate-700">
                    ·
                  </span>
                  <span className="text-slate-600 dark:text-slate-400">Owner: {p.owner}</span>
                  <span aria-hidden="true" className="mx-2 text-slate-300 dark:text-slate-700">
                    ·
                  </span>
                  <span className="font-mono text-amber-800 dark:text-amber-400">
                    Active worker coverage: UNKNOWN
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectProject(p.projectId)}
                  className="font-medium text-sky-700 dark:text-sky-400 hover:underline cursor-pointer"
                >
                  Open Side Panel
                </button>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
};
