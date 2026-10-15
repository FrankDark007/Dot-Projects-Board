/**
 * @file src/components/AttentionPanel.tsx
 * @description Prominent Attention Panel displaying exact questions or failures,
 * their age, responsible owner, recommended next step, and direct resolution controls.
 */

import React, { useState } from 'react';
import { AlertTriangle, ArrowUpRight, CheckCircle2, Clock, HelpCircle, ShieldAlert } from 'lucide-react';
import { BackendCapabilities, DecisionRequest, ProjectRecord } from '../schema/contract';
import { formatRelativeAge } from '../utils/timeFormat';

interface AttentionPanelProps {
  decisions: DecisionRequest[];
  projects: ProjectRecord[];
  referenceNowIso: string;
  capabilities: BackendCapabilities;
  onSelectProject: (projectId: string) => void;
  onResolveDecision: (
    projectId: string,
    decisionId: string,
    selectedOption: string | undefined,
    resolutionNote: string
  ) => void;
  onSendReminder: (projectId: string, targetOwner: string, message: string) => void;
}

export const AttentionPanel: React.FC<AttentionPanelProps> = ({
  decisions,
  projects,
  referenceNowIso,
  capabilities,
  onSelectProject,
  onResolveDecision,
  onSendReminder,
}) => {
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [customNotes, setCustomNotes] = useState<Record<string, string>>({});

  const openDecisions = decisions.filter((d) => d.status === 'open');
  if (openDecisions.length === 0) {
    return (
      <section
        aria-label="Attention Required"
        className="bg-white border border-slate-200 rounded-xl p-5 mb-6"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                No Immediate Operator Decisions Pending
              </h2>
              <p className="text-sm text-slate-600">
                All active questions and failure interventions have been addressed.
              </p>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // Sort decisions where owner === 'you' first, then by age
  const sortedDecisions = [...openDecisions].sort((a, b) => {
    const aIsYou = a.owner.toLowerCase() === 'you' ? 0 : 1;
    const bIsYou = b.owner.toLowerCase() === 'you' ? 0 : 1;
    if (aIsYou !== bIsYou) return aIsYou - bIsYou;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });

  return (
    <section
      aria-label="Attention Required"
      className="bg-white border border-slate-300 rounded-xl p-6 mb-8"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 mb-5 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-amber-800 mb-1">
            <AlertTriangle className="w-4 h-4 text-amber-700 shrink-0" />
            <span>Attention Queue</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{sortedDecisions.length} unresolved</span>
          </div>
          <h2 className="text-lg font-semibold text-slate-900">
            Questions, Acceptance Failures & Crashed Runs Needing Action
          </h2>
        </div>
        <p className="text-xs text-slate-500">
          Exact prompts and failure diagnostics from verified subsystem sources
        </p>
      </div>

      <div className="divide-y divide-slate-200">
        {sortedDecisions.map((dec) => {
          const project = projects.find((p) => p.projectId === dec.projectId);
          const isForMe = dec.owner.toLowerCase() === 'you';
          const chosenOption =
            selectedOptions[dec.decisionId] ?? (dec.options ? dec.options[0] : '');
          const noteText = customNotes[dec.decisionId] ?? '';

          return (
            <div key={dec.decisionId} className="py-5 first:pt-0 last:pb-0">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
                <div className="flex-1 min-w-0">
                  {/* Metadata Line (Zero-Pill Discipline: clean unboxed text with separators) */}
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600 mb-2">
                    <span className="font-semibold text-slate-900">
                      {project ? project.name : dec.projectId}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        isForMe
                          ? 'font-semibold text-amber-800'
                          : 'font-medium text-slate-700'
                      }
                    >
                      Owner: {dec.owner}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums text-slate-600">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      Age: {formatRelativeAge(dec.createdAt, referenceNowIso)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-slate-500">{dec.decisionId}</span>
                  </div>

                  {/* Exact Question or Failure */}
                  <div className="flex items-start gap-2.5 mb-2">
                    {dec.kind === 'failure_intervention' ? (
                      <ShieldAlert className="w-4 h-4 text-red-700 shrink-0 mt-1" />
                    ) : (
                      <HelpCircle className="w-4 h-4 text-amber-700 shrink-0 mt-1" />
                    )}
                    <p className="text-sm font-semibold text-slate-900 leading-snug">
                      {dec.exactPromptOrFailure}
                    </p>
                  </div>

                  <p className="text-xs text-slate-600 mb-3 pl-6.5">{dec.contextSummary}</p>

                  {/* Recommended Next Step */}
                  <div className="pl-6.5 text-xs text-slate-700">
                    <span className="font-semibold text-slate-900">Next step: </span>
                    <span>{dec.recommendedNextStep}</span>
                  </div>
                </div>

                {/* Right Column: Action Controls */}
                <div className="w-full lg:w-96 shrink-0 bg-slate-50 border border-slate-200 rounded-lg p-3.5">
                  {dec.options && dec.options.length > 0 && (
                    <div className="mb-2.5">
                      <label
                        htmlFor={`select-${dec.decisionId}`}
                        className="block text-xs font-medium text-slate-700 mb-1"
                      >
                        Select decision / remediation path
                      </label>
                      <select
                        id={`select-${dec.decisionId}`}
                        value={chosenOption}
                        disabled={!capabilities.canResolveDecision}
                        onChange={(e) =>
                          setSelectedOptions((prev) => ({
                            ...prev,
                            [dec.decisionId]: e.target.value,
                          }))
                        }
                        className="w-full text-xs bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50"
                      >
                        {dec.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="mb-3">
                    <input
                      type="text"
                      placeholder="Optional operator note or instruction..."
                      value={noteText}
                      disabled={!capabilities.canResolveDecision}
                      onChange={(e) =>
                        setCustomNotes((prev) => ({
                          ...prev,
                          [dec.decisionId]: e.target.value,
                        }))
                      }
                      aria-label="Resolution note"
                      className="w-full text-xs bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!capabilities.canResolveDecision}
                        title={
                          !capabilities.canResolveDecision
                            ? capabilities.reasonIfDisabled ||
                              'Backend does not support decision resolution'
                            : 'Record decision and unblock next step'
                        }
                        onClick={() =>
                          onResolveDecision(
                            dec.projectId,
                            dec.decisionId,
                            chosenOption || undefined,
                            noteText || 'Approved via Attention Panel'
                          )
                        }
                        className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        Record Decision
                      </button>

                      {!isForMe && (
                        <button
                          type="button"
                          disabled={!capabilities.canSendReminder}
                          title={
                            !capabilities.canSendReminder
                              ? capabilities.reasonIfDisabled ||
                                'Backend does not support reminders'
                              : `Send reminder to ${dec.owner} (requires delivery ack)`
                          }
                          onClick={() =>
                            onSendReminder(
                              dec.projectId,
                              dec.owner,
                              `Attention needed on ${dec.decisionId}: ${dec.recommendedNextStep}`
                            )
                          }
                          className="px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer"
                        >
                          Remind {dec.owner}
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectProject(dec.projectId)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 underline-offset-4 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <span>Inspect Project</span>
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {!capabilities.canResolveDecision && (
                    <p className="mt-2 text-[11px] text-amber-800">
                      Disabled: {capabilities.reasonIfDisabled || 'Live adapter is not connected.'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
};
