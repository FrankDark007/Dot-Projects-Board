/**
 * @file src/components/WorkflowDiagram.tsx
 * @description Milestone dependency and acceptance gate workflow diagram.
 * Clearly separates code execution progress from acceptance gate verification.
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
        return <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />;
      case 'failed_acceptance':
        return <XCircle className="w-4 h-4 text-red-700 shrink-0" />;
      case 'blocked':
        return <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />;
      case 'in_progress':
        return <CircleDot className="w-4 h-4 text-slate-900 shrink-0" />;
      default:
        return <Clock className="w-4 h-4 text-slate-400 shrink-0" />;
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
    <div className="pt-4 border-t border-slate-200">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-slate-800">
          Milestone Workflow, Dependencies & Acceptance Gates
        </span>
        <span className="text-xs text-slate-500">
          A milestone only completes when all required acceptance gates pass
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {sorted.map((ms, idx) => {
          const isCurrent = ms.milestoneId === currentMilestoneId;
          const depNames = ms.dependsOnMilestoneIds
            .map((depId) => sorted.find((m) => m.milestoneId === depId)?.order)
            .filter(Boolean);

          return (
            <div
              key={ms.milestoneId}
              className={`relative rounded-lg border p-3.5 transition-colors ${
                isCurrent
                  ? 'bg-slate-50/90 border-slate-400'
                  : 'bg-white border-slate-200'
              }`}
            >
              {/* Header row */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  {getMilestoneStatusIcon(ms.status)}
                  <span className="text-xs font-mono font-semibold text-slate-600 tabular-nums">
                    0{ms.order}.
                  </span>
                  <h4 className="text-xs font-semibold text-slate-900 leading-snug">
                    {ms.title}
                  </h4>
                </div>
              </div>

              {/* Clean metadata line */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 mb-3">
                <span
                  className={
                    ms.status === 'completed_verified'
                      ? 'font-medium text-emerald-800'
                      : ms.status === 'failed_acceptance'
                      ? 'font-semibold text-red-700'
                      : ms.status === 'blocked'
                      ? 'font-medium text-amber-800'
                      : 'font-medium text-slate-700'
                  }
                >
                  {getMilestoneStatusText(ms.status)}
                </span>
                {depNames.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-1 font-mono">
                      Depends on 0{depNames.join(', 0')}
                    </span>
                  </>
                )}
                {idx < sorted.length - 1 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="inline-flex items-center gap-0.5 text-slate-400">
                      <span>Feeds 0{sorted[idx + 1].order}</span>
                      <ArrowRight className="w-3 h-3" />
                    </span>
                  </>
                )}
              </div>

              {/* Remaining Steps */}
              {ms.remainingSteps.length > 0 ? (
                <div className="mb-3">
                  <div className="text-[11px] font-medium text-slate-700 mb-1">
                    Remaining steps ({ms.remainingSteps.length}):
                  </div>
                  <ul className="space-y-1 text-xs text-slate-600 pl-3.5 list-disc">
                    {ms.remainingSteps.map((step, sIdx) => (
                      <li key={sIdx} className="leading-snug">
                        {step}
                      </li>
                    ))}
                  </ul>
                  {ms.estimateLabel && (
                    <p className="mt-1.5 text-[11px] italic text-slate-500">
                      {ms.estimateLabel}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-500 mb-3">
                  0 remaining implementation steps.
                </p>
              )}

              {/* Acceptance Gates */}
              <div className="pt-2.5 border-t border-slate-200/80">
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-700 mb-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-500" />
                  <span>Acceptance Gates ({ms.acceptanceGates.length})</span>
                </div>
                <div className="space-y-2">
                  {ms.acceptanceGates.map((gate) => (
                    <div key={gate.gateId} className="text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-slate-800">{gate.label}</span>
                        <span
                          className={`font-mono text-[11px] shrink-0 ${
                            gate.status === 'passed'
                              ? 'text-emerald-800 font-medium'
                              : gate.status === 'failed'
                              ? 'text-red-700 font-semibold'
                              : 'text-slate-500'
                          }`}
                        >
                          {gate.status === 'passed'
                            ? 'PASSED'
                            : gate.status === 'failed'
                            ? 'FAILED'
                            : 'PENDING'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                        {gate.details}
                      </p>
                      {gate.verifiedAt && (
                        <p className="text-[10px] font-mono text-slate-400 tabular-nums mt-0.5">
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
