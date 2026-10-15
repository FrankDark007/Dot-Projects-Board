/**
 * @file src/components/AttentionPanel.tsx
 * @description Prominent Attention Panel displaying exact problems, age, owner, and next useful action.
 * Explicitly separates Confirmed Failures (red) from Missing Information / Pending Decisions (amber).
 * Enforces `min-w-0`, wrapping for long project/owner/unbroken strings, and accessible control sizing.
 */

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  HelpCircle,
  PanelRightOpen,
  ShieldAlert,
} from 'lucide-react';
import { BackendCapabilities, DecisionRequest, ProjectRecord } from '../schema/contract';
import { formatRelativeAge } from '../utils/timeFormat';

interface AttentionPanelProps {
  decisions: DecisionRequest[];
  projects: ProjectRecord[];
  referenceNowIso: string;
  capabilities: BackendCapabilities;
  selectedProjectId: string | null;
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
  selectedProjectId,
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
        className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3.5 mb-6"
      >
        <div className="flex items-center gap-3 min-w-0">
          <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />
          <div className="text-xs min-w-0 break-words [overflow-wrap:anywhere]">
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              No Unresolved Attention Items
            </span>
            <span className="text-slate-500 dark:text-slate-400 ml-2">
              All confirmed failures and operator questions have been addressed.
            </span>
          </div>
        </div>
      </section>
    );
  }

  // Classify Confirmed Failures vs Missing Info / Decisions
  const isConfirmedFailure = (d: DecisionRequest) =>
    d.severity === 'confirmed_failure' || d.kind === 'failure_intervention';

  const confirmedFailureCount = openDecisions.filter(isConfirmedFailure).length;
  const missingInfoCount = openDecisions.length - confirmedFailureCount;

  // Sort: owner === 'you' first, then confirmed failures first, then oldest first
  const sortedDecisions = [...openDecisions].sort((a, b) => {
    const aIsYou = a.owner.toLowerCase() === 'you' ? 0 : 1;
    const bIsYou = b.owner.toLowerCase() === 'you' ? 0 : 1;
    if (aIsYou !== bIsYou) return aIsYou - bIsYou;
    const aFail = isConfirmedFailure(a) ? 0 : 1;
    const bFail = isConfirmedFailure(b) ? 0 : 1;
    if (aFail !== bFail) return aFail - bFail;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });

  return (
    <section
      aria-label="Attention Required"
      className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg mb-6 overflow-hidden"
    >
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60">
        <div className="flex flex-wrap items-center gap-2 text-xs min-w-0">
          <span className="font-semibold text-slate-900 dark:text-slate-100">
            Attention Needed First
          </span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
            ·
          </span>
          {confirmedFailureCount > 0 && (
            <span className="inline-flex items-center gap-1 font-medium text-red-700 dark:text-red-400">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
              <span className="font-mono tabular-nums">{confirmedFailureCount}</span>
              <span>confirmed {confirmedFailureCount === 1 ? 'failure' : 'failures'}</span>
            </span>
          )}
          {confirmedFailureCount > 0 && missingInfoCount > 0 && (
            <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
              ·
            </span>
          )}
          {missingInfoCount > 0 && (
            <span className="inline-flex items-center gap-1 font-medium text-amber-800 dark:text-amber-400">
              <HelpCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="font-mono tabular-nums">{missingInfoCount}</span>
              <span>missing info / decision needed</span>
            </span>
          )}
        </div>
        <span className="text-[11px] text-slate-500 dark:text-slate-400 min-w-0 break-words [overflow-wrap:anywhere]">
          Confirmed failures (red) are distinct from missing information or policy questions (amber)
        </span>
      </div>

      {/* Items List */}
      <div className="divide-y divide-slate-200 dark:divide-slate-800">
        {sortedDecisions.map((dec) => {
          const project = projects.find((p) => p.projectId === dec.projectId);
          const isForMe = dec.owner.toLowerCase() === 'you';
          const confirmedFail = isConfirmedFailure(dec);
          const chosenOption =
            selectedOptions[dec.decisionId] ?? (dec.options ? dec.options[0] : '');
          const noteText = customNotes[dec.decisionId] ?? '';
          const isProjectSelected = selectedProjectId === dec.projectId;

          return (
            <div
              key={dec.decisionId}
              className={`@container p-4 transition-colors ${
                isProjectSelected
                  ? 'bg-sky-50/40 dark:bg-sky-950/20'
                  : 'hover:bg-slate-50/50 dark:hover:bg-slate-900/30'
              }`}
            >
              <div className="grid grid-cols-1 @[880px]:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] gap-4 items-start">
                <div className="min-w-0">
                  {/* Unboxed Metadata Line */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs mb-1.5 min-w-0">
                    {confirmedFail ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-red-700 dark:text-red-400">
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                        <span>Confirmed Failure</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-400">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span>Missing Info / Decision</span>
                      </span>
                    )}
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                      ·
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectProject(dec.projectId)}
                      className="font-semibold text-slate-900 dark:text-slate-100 hover:underline underline-offset-4 text-left cursor-pointer min-w-0 break-words [overflow-wrap:anywhere] whitespace-normal"
                    >
                      {project ? project.name : dec.projectId}
                    </button>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                      ·
                    </span>
                    <span
                      className={`min-w-0 break-words [overflow-wrap:anywhere] ${
                        isForMe
                          ? 'font-semibold text-amber-800 dark:text-amber-300'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      Owner: {dec.owner}
                    </span>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                      ·
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      <Clock className="w-3 h-3 shrink-0" />
                      {formatRelativeAge(dec.createdAt, referenceNowIso)}
                    </span>
                  </div>

                  {/* Exact Problem */}
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug mb-1 min-w-0 break-words [overflow-wrap:anywhere]">
                    {dec.exactPromptOrFailure}
                  </p>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mb-2 min-w-0 break-words [overflow-wrap:anywhere]">
                    {dec.contextSummary}
                  </p>

                  {/* Next Useful Action */}
                  <div className="text-xs text-slate-700 dark:text-slate-300 min-w-0 break-words [overflow-wrap:anywhere]">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      Next useful action:{' '}
                    </span>
                    <span>{dec.recommendedNextStep}</span>
                  </div>
                </div>

                {/* Action Controls */}
                <div className="w-full min-w-0 flex flex-col gap-2 bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 rounded-md p-3">
                  {dec.options && dec.options.length > 0 && (
                    <div className="min-w-0">
                      <label
                        htmlFor={`attn-opt-${dec.decisionId}`}
                        className="sr-only"
                      >
                        Select decision option
                      </label>
                      <select
                        id={`attn-opt-${dec.decisionId}`}
                        value={chosenOption}
                        disabled={!capabilities.canResolveDecision}
                        onChange={(e) =>
                          setSelectedOptions((prev) => ({
                            ...prev,
                            [dec.decisionId]: e.target.value,
                          }))
                        }
                        className="w-full max-w-full min-w-0 min-h-[34px] text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-600 disabled:opacity-50"
                      >
                        {dec.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="flex items-center gap-2 min-w-0">
                    <input
                      type="text"
                      placeholder="Optional resolution note..."
                      value={noteText}
                      disabled={!capabilities.canResolveDecision}
                      onChange={(e) =>
                        setCustomNotes((prev) => ({
                          ...prev,
                          [dec.decisionId]: e.target.value,
                        }))
                      }
                      aria-label="Resolution note"
                      className="flex-1 min-w-0 min-h-[34px] text-xs bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600 disabled:opacity-50"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <button
                        type="button"
                        disabled={!capabilities.canResolveDecision}
                        title={
                          !capabilities.canResolveDecision
                            ? capabilities.reasonIfDisabled ||
                              'Disabled until backend command route is verified'
                            : 'Record decision'
                        }
                        onClick={() =>
                          onResolveDecision(
                            dec.projectId,
                            dec.decisionId,
                            chosenOption || undefined,
                            noteText || 'Resolved via Attention Panel'
                          )
                        }
                        className="min-h-[34px] px-3 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                      >
                        Resolve
                      </button>

                      {!isForMe && (
                        <button
                          type="button"
                          disabled={!capabilities.canSendReminder}
                          title={
                            !capabilities.canSendReminder
                              ? capabilities.reasonIfDisabled || 'Reminders disabled'
                              : `Send reminder to ${dec.owner}`
                          }
                          onClick={() =>
                            onSendReminder(
                              dec.projectId,
                              dec.owner,
                              `Attention needed on ${dec.decisionId}: ${dec.recommendedNextStep}`
                            )
                          }
                          className="min-h-[34px] max-w-full min-w-0 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed break-words [overflow-wrap:anywhere] text-left cursor-pointer"
                        >
                          Remind {dec.owner}
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onSelectProject(dec.projectId)}
                      className="min-h-[34px] inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                      <PanelRightOpen className="w-3.5 h-3.5 shrink-0" />
                      <span>Open Panel</span>
                    </button>
                  </div>

                  {!capabilities.canResolveDecision && (
                    <p className="text-[11px] text-amber-800 dark:text-amber-400 min-w-0 break-words [overflow-wrap:anywhere]">
                      Read-only: {capabilities.reasonIfDisabled || 'Live commands unconfigured.'}
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
