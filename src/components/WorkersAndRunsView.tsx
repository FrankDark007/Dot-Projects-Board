/**
 * @file src/components/WorkersAndRunsView.tsx
 * @description Dedicated Workers & Runs table view separating process heartbeats from
 * meaningful task progress and surfacing crashed, failed, idle, queued, stale, and unknown states.
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
    <div className="space-y-8">
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 mb-5 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Worker Execution & Liveness Telemetry ({evaluatedWorkers.length} registered)
            </h2>
            <p className="text-xs text-slate-600">
              Heartbeats prove process liveness only. A worker is only counted as Active Running
              when both heartbeat (&le;{snapshot.evaluationThresholds.heartbeatExpirySeconds}s) and
              meaningful progress (&le;{Math.floor(snapshot.evaluationThresholds.stalledProgressSeconds / 60)}m) are fresh.
            </p>
          </div>
        </div>

        <div className="border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-2.5 px-3 font-medium">Worker ID & Role</th>
                <th className="py-2.5 px-3 font-medium">Project</th>
                <th className="py-2.5 px-3 font-medium">Evaluated State</th>
                <th className="py-2.5 px-3 font-medium text-right">Heartbeat Age</th>
                <th className="py-2.5 px-3 font-medium text-right">Meaningful Progress Age</th>
                <th className="py-2.5 px-3 font-medium">Diagnostic / Latest Output</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {evaluatedWorkers.map((w) => {
                const project = snapshot.projects.find((p) => p.projectId === w.projectId);
                return (
                  <tr key={w.workerId} className="hover:bg-slate-50/80">
                    <td className="py-3 px-3">
                      <div className="font-mono font-semibold text-slate-900">{w.name}</div>
                      <div className="text-slate-500">
                        {w.role} · {w.hostLabel}
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      {project ? (
                        <button
                          type="button"
                          onClick={() => onSelectProject(project.projectId)}
                          className="font-medium text-slate-900 hover:underline underline-offset-4 text-left cursor-pointer"
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
                            ? 'text-emerald-800'
                            : w.evaluatedState === 'crashed' || w.evaluatedState === 'failed'
                            ? 'text-red-700'
                            : w.evaluatedState === 'stalled_progress' ||
                              w.evaluatedState === 'stale_heartbeat'
                            ? 'text-amber-800'
                            : 'text-slate-700'
                        }`}
                      >
                        {w.evaluatedState}
                      </span>
                      <div className="text-[11px] text-slate-500">raw: {w.rawStatus}</div>
                    </td>
                    <td className="py-3 px-3 font-mono text-right tabular-nums text-slate-700">
                      {formatRelativeAge(w.lastHeartbeatAt, referenceNowIso)}
                    </td>
                    <td className="py-3 px-3 font-mono text-right tabular-nums text-slate-700">
                      {formatRelativeAge(w.lastMeaningfulProgressAt, referenceNowIso)}
                    </td>
                    <td className="py-3 px-3 text-slate-700 max-w-md">
                      <div className="font-medium text-slate-900">{w.statusExplanation}</div>
                      {w.lastProgressSummary && (
                        <div className="text-slate-500 mt-0.5">{w.lastProgressSummary}</div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Projects with Unknown Worker Coverage */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <h3 className="text-base font-semibold text-slate-900 mb-2">
          Projects with Unknown Worker Telemetry Coverage
        </h3>
        <p className="text-xs text-slate-600 mb-4">
          When worker execution coverage is unavailable, the dashboard reports{' '}
          <code className="font-mono text-slate-900">Unknown</code> rather than fabricating 0
          active workers.
        </p>
        <div className="divide-y divide-slate-200">
          {snapshot.projects
            .filter((p) => !p.workerCoverageKnown)
            .map((p) => (
              <div
                key={p.projectId}
                className="py-3 first:pt-0 last:pb-0 flex items-center justify-between gap-4 text-xs"
              >
                <div>
                  <span className="font-semibold text-slate-900">{p.name}</span>
                  <span aria-hidden="true" className="mx-2 text-slate-300">
                    ·
                  </span>
                  <span className="text-slate-600">Owner: {p.owner}</span>
                  <span aria-hidden="true" className="mx-2 text-slate-300">
                    ·
                  </span>
                  <span className="font-mono text-amber-800">
                    Active worker coverage: UNKNOWN
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectProject(p.projectId)}
                  className="font-medium text-slate-800 hover:underline underline-offset-4 cursor-pointer"
                >
                  Inspect Project
                </button>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
};
