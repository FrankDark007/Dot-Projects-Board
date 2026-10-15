/**
 * @file src/components/WorkflowDiagram.tsx
 * @description Milestone dependency, completed/current/remaining steps, and acceptance gate diagram.
 * Distinguishes required acceptance gates from optional gates.
 */

import React from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  CircleDot,
  Clock,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { MilestoneNode } from '../schema/contract';
import { formatRelativeAge } from '../utils/timeFormat';

interface WorkflowDiagramProps {
  milestones: MilestoneNode[];
  currentMilestoneId: string | null;
  referenceNowIso: string;
}

export const WorkflowDiagram: React.FC<WorkflowDiagramProps> = ({
  milestones,
  currentMilestoneId,
  referenceNowIso,
}) => {
  const sorted = [...milestones].sort((a, b) => a.order - b.order);

  const getMilestoneStatusIcon = (status: MilestoneNode['status']) => {
    switch (status) {
      case 'completed_verified':
        return <CheckCircle2 className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0" />;
      case 'failed_acceptance':
        return <XCircle className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" />;
      case 'blocked':
        return <AlertCircle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />;
      case 'in_progress':
        return <CircleDot className="w-4 h-4 text-sky-600 dark:text-sky-400 shrink-0" />;
      default:
        return <Clock className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />;
    }
  };

  const getMilestoneStatusText = (status: MilestoneNode['status']) => {
    switch (status) {
      case 'completed_verified':
        return 'Verified Complete';
      case 'failed_acceptance':
        return 'Failed Acceptance Gate';
      case 'blocked':
        return 'Blocked';
      case 'in_progress':
        return 'In Progress';
      default:
        return 'Pending';
    }
  };

  return (
    <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
          Milestone Timeline, Dependencies & Acceptance Gates
        </span>
        <span className="text-[11px] text-slate-500 dark:text-slate-400">
          All required gates and steps must finish with verified evidence before completion
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3.5">
        {sorted.map((ms, idx) => {
          const isCurrent = ms.milestoneId === currentMilestoneId;
          const depNames = ms.dependsOnMilestoneIds
            .map((depId) => sorted.find((m) => m.milestoneId === depId)?.order)
            .filter(Boolean);

          return (
            <div
              key={ms.milestoneId}
              className={`rounded-lg border p-3.5 transition-colors ${
                isCurrent
                  ? 'bg-slate-50 dark:bg-slate-900/90 border-sky-500/60 dark:border-sky-500/50'
                  : 'bg-white dark:bg-slate-950/60 border-slate-200 dark:border-slate-800'
              }`}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  {getMilestoneStatusIcon(ms.status)}
                  <span className="text-xs font-mono font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                    0{ms.order}.
                  </span>
                  <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-snug">
                    {ms.title}
                  </h4>
                </div>
                {ms.required === false && (
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 shrink-0">
                    Optional
                  </span>
                )}
              </div>

              {/* Clean metadata line */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 mb-3">
                <span
                  className={
                    ms.status === 'completed_verified'
                      ? 'font-medium text-teal-700 dark:text-teal-400'
                      : ms.status === 'failed_acceptance'
                      ? 'font-semibold text-red-700 dark:text-red-400'
                      : ms.status === 'blocked'
                      ? 'font-medium text-amber-800 dark:text-amber-400'
                      : 'font-medium text-slate-700 dark:text-slate-300'
                  }
                >
                  {getMilestoneStatusText(ms.status)}
                </span>
                {depNames.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono">Depends on 0{depNames.join(', 0')}</span>
                  </>
                )}
                {idx < sorted.length - 1 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-0.5 text-slate-400 dark:text-slate-500">
                      <span>Feeds 0{sorted[idx + 1].order}</span>
                      <ArrowRight className="w-3 h-3" />
                    </span>
                  </>
                )}
              </div>

              {/* Completed, Current, and Remaining Steps */}
              <div className="space-y-2 mb-3 text-xs">
                {ms.completedSteps && ms.completedSteps.length > 0 && (
                  <div>
                    <div className="text-[11px] font-medium text-teal-800 dark:text-teal-400 mb-0.5">
                      Completed steps ({ms.completedSteps.length}):
                    </div>
                    <ul className="space-y-0.5 text-[11px] text-slate-500 dark:text-slate-400 pl-3.5 list-disc">
                      {ms.completedSteps.map((cs, cIdx) => (
                        <li key={cIdx} className="leading-snug">
                          {cs}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {ms.currentStep && (
                  <div className="bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900/60 rounded p-2 text-[11px] text-slate-900 dark:text-slate-100">
                    <span className="font-semibold text-sky-800 dark:text-sky-300">
                      Current step:{' '}
                    </span>
                    {ms.currentStep}
                  </div>
                )}

                {ms.remainingSteps.length > 0 ? (
                  <div>
                    <div className="text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-0.5">
                      Remaining steps ({ms.remainingSteps.length}):
                    </div>
                    <ul className="space-y-1 text-xs text-slate-600 dark:text-slate-300 pl-3.5 list-disc">
                      {ms.remainingSteps.map((step, sIdx) => (
                        <li key={sIdx} className="leading-snug">
                          {step}
                        </li>
                      ))}
                    </ul>
                    {ms.estimateLabel && (
                      <p className="mt-1 text-[11px] italic text-slate-500 dark:text-slate-400">
                        {ms.estimateLabel}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    0 remaining steps.
                  </p>
                )}
              </div>

              {/* Acceptance Gates */}
              <div className="pt-2.5 border-t border-slate-200/80 dark:border-slate-800">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                  <span>Acceptance Gates ({ms.acceptanceGates.length})</span>
                </div>
                <div className="space-y-2">
                  {ms.acceptanceGates.map((gate) => (
                    <div key={gate.gateId} className="text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-800 dark:text-slate-200">
                          {gate.label}
                          {!gate.required && (
                            <span className="ml-1.5 text-[10px] font-mono text-slate-400">
                              (optional)
                            </span>
                          )}
                        </span>
                        <span
                          className={`font-mono text-[11px] shrink-0 ${
                            gate.status === 'passed'
                              ? 'text-teal-700 dark:text-teal-400 font-medium'
                              : gate.status === 'failed'
                              ? gate.required
                                ? 'text-red-700 dark:text-red-400 font-semibold'
                                : 'text-amber-700 dark:text-amber-400 font-medium'
                              : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          {gate.status.toUpperCase()}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 leading-snug">
                        {gate.details}
                      </p>
                      {gate.verifiedAt && (
                        <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 tabular-nums mt-0.5">
                          Verified {formatRelativeAge(gate.verifiedAt, referenceNowIso)} via{' '}
                          {gate.verifierSource || 'verifier'}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
