/**
 * @file src/components/ContractAndTestsView.tsx
 * @description Truthful Verification & Integration Contract inspector.
 * Dynamically derives every verification badge from actual completed test results for each scope:
 * - Fixture & Evaluator Suite (`fixture_evaluator`)
 * - Transport & Validator Suite (`transport_validator`)
 * - Mounted UI & Isolation Suite (`ui_behavior`)
 * - Real Local Integration (explicitly `UNVERIFIED IN SANDBOX`)
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Code2,
  FileJson,
  Play,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  COMMAND_REQUEST_JSON_SCHEMA,
  CONTRACT_DOCUMENTATION_EXAMPLES,
  SNAPSHOT_JSON_SCHEMA,
} from '../schema/jsonSchemas';
import {
  runAllContractAndStateTests,
  TestCaseResult,
  TestSuiteScope,
} from '../tests/contractAndState.test';
import {
  getBundledRecordedAsyncVerificationReport,
  loadRecordedAsyncVerificationReport,
  RecordedAsyncVerificationReport,
} from '../tests/recordedVerificationReport';

export interface ContractAndTestsViewProps {
  overrideSyncResults?: TestCaseResult[];
  overrideAsyncResults?: TestCaseResult[];
  overrideRunningAsync?: boolean;
  loadAsyncReportImpl?: () => Promise<RecordedAsyncVerificationReport>;
}

interface ScopeVerificationSummary {
  status: 'VERIFIED' | 'PENDING' | 'FAILED' | 'UNEXECUTED';
  badgeLabel: string;
  tone: 'verified' | 'warning' | 'danger';
  passed: number;
  total: number;
  assertions: number;
}

export function deriveScopeVerificationSummary(
  scope: TestSuiteScope,
  results: TestCaseResult[],
  isAsyncScopeRunning: boolean
): ScopeVerificationSummary {
  const scopeResults = results.filter((r) => r.scope === scope);
  const total = scopeResults.length;
  const passed = scopeResults.filter((r) => r.passed).length;
  const failed = total - passed;
  const assertions = scopeResults.reduce((acc, r) => acc + r.assertionsRun, 0);

  if (failed > 0) {
    return {
      status: 'FAILED',
      badgeLabel: isAsyncScopeRunning
        ? `FAILED (${passed}/${total} passed · running...)`
        : `FAILED (${passed}/${total} passed · ${failed} failed)`,
      tone: 'danger',
      passed,
      total,
      assertions,
    };
  }

  if (isAsyncScopeRunning) {
    return {
      status: 'PENDING',
      badgeLabel: `PENDING / RUNNING (${total} completed so far)`,
      tone: 'warning',
      passed,
      total,
      assertions,
    };
  }

  if (total === 0) {
    return {
      status: 'UNEXECUTED',
      badgeLabel: 'UNEXECUTED (0 tests run)',
      tone: 'warning',
      passed: 0,
      total: 0,
      assertions: 0,
    };
  }

  return {
    status: 'VERIFIED',
    badgeLabel: `VERIFIED (${passed}/${total} passed · ${assertions} assertions)`,
    tone: 'verified',
    passed,
    total,
    assertions,
  };
}

export const ContractAndTestsView: React.FC<ContractAndTestsViewProps> = ({
  overrideSyncResults,
  overrideAsyncResults,
  overrideRunningAsync,
  loadAsyncReportImpl,
}) => {
  const initialBundledReport = useMemo(
    () => getBundledRecordedAsyncVerificationReport(),
    []
  );
  // Separate synchronous in-memory check execution from reloading recorded async runner results
  const [syncRunCounter, setSyncRunCounter] = useState(0);
  const [asyncReloadCounter, setAsyncReloadCounter] = useState(0);
  const [recordedReportMeta, setRecordedReportMeta] = useState<{
    schemaVersion: string;
    runnerCommand: string;
    recordedAt: string;
    executionIsolation: string;
  }>({
    schemaVersion: initialBundledReport.schemaVersion,
    runnerCommand: initialBundledReport.runnerCommand,
    recordedAt: initialBundledReport.recordedAt,
    executionIsolation: initialBundledReport.executionIsolation,
  });
  const [asyncResults, setAsyncResults] = useState<TestCaseResult[]>(() =>
    loadAsyncReportImpl ? [] : initialBundledReport.results
  );
  const [runningAsync, setRunningAsync] = useState<boolean>(() =>
    Boolean(loadAsyncReportImpl)
  );
  const [asyncLoadError, setAsyncLoadError] = useState<string | null>(null);
  const [schemaExpanded, setSchemaExpanded] = useState(false);
  const [schemaView, setSchemaView] = useState<'snapshot' | 'command' | 'errors'>('snapshot');

  const syncSummary = useMemo(() => {
    if (overrideSyncResults !== undefined) {
      const passedTests = overrideSyncResults.filter((r) => r.passed).length;
      return {
        allPassed:
          overrideSyncResults.length > 0 && passedTests === overrideSyncResults.length,
        totalTests: overrideSyncResults.length,
        passedTests,
        totalAssertions: overrideSyncResults.reduce((s, r) => s + r.assertionsRun, 0),
        results: overrideSyncResults,
      };
    }
    void syncRunCounter;
    return runAllContractAndStateTests();
  }, [syncRunCounter, overrideSyncResults]);

  useEffect(() => {
    if (overrideAsyncResults !== undefined || overrideRunningAsync !== undefined) {
      return;
    }
    // On initial mount with default bundled report and no custom loader, results are already loaded synchronously without touching global timers
    if (asyncReloadCounter === 0 && !loadAsyncReportImpl) {
      return;
    }

    let cancelled = false;
    setRunningAsync(true);
    setAsyncLoadError(null);

    const loader = loadAsyncReportImpl ?? loadRecordedAsyncVerificationReport;
    void (async () => {
      try {
        const report = await loader();
        if (!cancelled) {
          setAsyncResults(report.results);
          setRecordedReportMeta({
            schemaVersion: report.schemaVersion,
            runnerCommand: report.runnerCommand,
            recordedAt: report.recordedAt,
            executionIsolation: report.executionIsolation,
          });
          setAsyncLoadError(null);
        }
      } catch (err) {
        if (!cancelled) {
          const errMsg =
            err instanceof Error ? err.message : 'Failed to load recorded async verification report';
          setAsyncLoadError(errMsg);
          setAsyncResults([
            {
              id: 'async-report-load-failure-transport',
              scope: 'transport_validator',
              name: 'Recorded Async Transport Suite Loader',
              scenarioCategory: 'Verification report reload',
              passed: false,
              assertionsRun: 0,
              details: 'Failed to reload recorded dev/test runner verification results.',
              error: errMsg,
            },
            {
              id: 'async-report-load-failure-ui',
              scope: 'ui_behavior',
              name: 'Recorded Async Mounted UI Suite Loader',
              scenarioCategory: 'Verification report reload',
              passed: false,
              assertionsRun: 0,
              details: 'Failed to reload recorded dev/test runner verification results.',
              error: errMsg,
            },
          ]);
        }
      } finally {
        if (!cancelled) {
          setRunningAsync(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [asyncReloadCounter, overrideAsyncResults, overrideRunningAsync, loadAsyncReportImpl]);

  const effectiveAsyncResults =
    overrideAsyncResults !== undefined ? overrideAsyncResults : asyncResults;
  const effectiveRunningAsync =
    overrideRunningAsync !== undefined ? overrideRunningAsync : runningAsync;

  const allResults = useMemo(
    () => [...syncSummary.results, ...effectiveAsyncResults],
    [syncSummary.results, effectiveAsyncResults]
  );

  const passedCount = allResults.filter((r) => r.passed).length;
  const failedCount = allResults.length - passedCount;
  const totalAssertions = allResults.reduce((acc, r) => acc + r.assertionsRun, 0);

  const fixtureScopeSummary = useMemo(
    () => deriveScopeVerificationSummary('fixture_evaluator', allResults, false),
    [allResults]
  );
  const transportScopeSummary = useMemo(
    () =>
      deriveScopeVerificationSummary(
        'transport_validator',
        allResults,
        effectiveRunningAsync
      ),
    [allResults, effectiveRunningAsync]
  );
  const uiScopeSummary = useMemo(
    () =>
      deriveScopeVerificationSummary('ui_behavior', allResults, effectiveRunningAsync),
    [allResults, effectiveRunningAsync]
  );

  const overallBannerTone =
    failedCount > 0
      ? 'text-red-700 dark:text-red-400'
      : effectiveRunningAsync || allResults.length === 0
      ? 'text-amber-700 dark:text-amber-400'
      : 'text-teal-700 dark:text-teal-400';

  const renderScopeCard = (
    title: string,
    summary: ScopeVerificationSummary,
    description: string
  ) => {
    const toneClass =
      summary.tone === 'verified'
        ? 'text-teal-700 dark:text-teal-400'
        : summary.tone === 'danger'
        ? 'text-red-700 dark:text-red-400'
        : 'text-amber-800 dark:text-amber-400';

    const borderClass =
      summary.tone === 'danger'
        ? 'border-red-300 dark:border-red-800/80 bg-red-50/30 dark:bg-red-950/20'
        : summary.tone === 'warning'
        ? 'border-amber-300 dark:border-amber-800/80 bg-amber-50/30 dark:bg-amber-950/20'
        : 'border-slate-200 dark:border-slate-800';

    return (
      <div className={`border rounded-md p-3 ${borderClass}`}>
        <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
          {title}
        </div>
        <div className={`font-mono font-semibold mb-1 flex items-center gap-1 ${toneClass}`}>
          {summary.status === 'VERIFIED' ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          ) : summary.status === 'FAILED' ? (
            <XCircle className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <Clock className="w-3.5 h-3.5 shrink-0" />
          )}
          <span>{summary.badgeLabel}</span>
        </div>
        <p className="text-[11px] text-slate-600 dark:text-slate-400">{description}</p>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* 1. Scope & Truthful Verification Status Banner */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-4 mb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs mb-1">
              <span className={`inline-flex items-center gap-1 font-semibold ${overallBannerTone}`}>
                {failedCount > 0 ? (
                  <XCircle className="w-4 h-4" />
                ) : effectiveRunningAsync || allResults.length === 0 ? (
                  <Clock className="w-4 h-4" />
                ) : (
                  <ShieldCheck className="w-4 h-4" />
                )}
                <span>
                  {failedCount > 0
                    ? `Automated Sandbox Suites: FAILED (${passedCount}/${allResults.length} Passed)`
                    : effectiveRunningAsync
                    ? `Automated Sandbox Suites: RUNNING (${passedCount}/${allResults.length} Completed)`
                    : allResults.length === 0
                    ? 'Automated Sandbox Suites: UNEXECUTED (0/0 Run)'
                    : `Automated Sandbox Suites: VERIFIED (${passedCount}/${allResults.length} Passed)`}
                </span>
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                ·
              </span>
              <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                {totalAssertions} assertions executed
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                ·
              </span>
              <span className="inline-flex items-center gap-1 font-semibold text-amber-800 dark:text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Real Local Integration: UNVERIFIED</span>
              </span>
            </div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Test Scope Separation: Fixture Logic, Mocked Transport, Mounted UI Interaction &amp; Local Integration
            </h2>
            <div
              data-testid="verification-provenance-summary"
              className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1.5 space-y-1"
            >
              <div>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Synchronous Checks ({syncSummary.passedTests}/{syncSummary.totalTests} passed · run #{syncRunCounter + 1}):
                </span>{' '}
                Executed live in-memory without touching page timers, clock, or fetch.
              </div>
              <div>
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  Recorded Async Runner Provenance:
                </span>{' '}
                Command <code data-testid="recorded-report-command">{recordedReportMeta.runnerCommand}</code>{' '}
                · Recorded at{' '}
                <code data-testid="recorded-report-timestamp">{recordedReportMeta.recordedAt}</code>{' '}
                · Provenance{' '}
                <code data-testid="recorded-report-isolation">{recordedReportMeta.executionIsolation}</code>{' '}
                (Schema: <code>{recordedReportMeta.schemaVersion}</code>). Async fake-timer &amp; mounted
                UI suites never execute in the live page, preserving active timers and queued polling.
                {asyncLoadError ? ` Reload error: ${asyncLoadError}` : ''}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              data-testid="rerun-sync-checks-btn"
              onClick={() => setSyncRunCounter((c) => c + 1)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Re-Run Sync Checks</span>
            </button>

            <button
              type="button"
              data-testid="reload-recorded-async-btn"
              disabled={effectiveRunningAsync}
              onClick={() => setAsyncReloadCounter((c) => c + 1)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${effectiveRunningAsync ? 'animate-spin' : ''}`} />
              <span>
                {effectiveRunningAsync
                  ? 'Reloading Recorded Async Results...'
                  : 'Reload Recorded Async Results'}
              </span>
            </button>
          </div>
        </div>

        {/* 4-Column Scope Matrix — Dynamically Derived from Executed Test Results */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs mb-5">
          {renderScopeCard(
            '1. Fixture & Evaluator Suite',
            fixtureScopeSummary,
            'Tests heartbeat expiry without new snapshots, future timestamp skew, strict Verified Complete evidence & milestone gates, and liveness vs. stalled progress.'
          )}

          {renderScopeCard(
            '2. Transport & Validator Suite',
            transportScopeSummary,
            'Tests complete runtime field/reference validation, per-source sequence ordering, transport contact vs. data freshness, and live command response validation.'
          )}

          {renderScopeCard(
            '3. Mounted UI & Isolation Suite',
            uiScopeSummary,
            'Tests mounted App continuous polling (5+ cycles, failures & recovery), endpoint isolation (A→B, A→B→A while pending), enabled/disabled controls, and repeated actions.'
          )}

          <div className="border border-amber-300 dark:border-amber-800/80 bg-amber-50/40 dark:bg-amber-950/20 rounded-md p-3">
            <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
              4. Real Local Integration
            </div>
            <div className="font-mono font-semibold text-amber-800 dark:text-amber-400 mb-1 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>UNVERIFIED IN SANDBOX</span>
            </div>
            <p className="text-[11px] text-slate-700 dark:text-slate-300">
              Requires wiring into your local Mission Control / projectBoard backend and running
              end-to-end local acceptance checks.
            </p>
          </div>
        </div>

        {/* Detailed Test Results Table */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-md overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400">
                <th className="py-2 px-3 font-medium">Result</th>
                <th className="py-2 px-3 font-medium">Suite Scope</th>
                <th className="py-2 px-3 font-medium">Scenario &amp; Verification Details</th>
                <th className="py-2 px-3 font-medium text-right">Assertions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {allResults.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="py-6 px-4 text-center font-mono text-amber-800 dark:text-amber-400"
                  >
                    UNEXECUTED — No test results have completed yet.
                  </td>
                </tr>
              ) : (
                allResults.map((res) => (
                  <tr key={res.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-900/40">
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      {res.passed ? (
                        <span className="inline-flex items-center gap-1 font-mono font-semibold text-teal-700 dark:text-teal-400">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>PASS</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-mono font-semibold text-red-700 dark:text-red-400">
                          <XCircle className="w-3.5 h-3.5" />
                          <span>FAIL</span>
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {res.scope}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700 dark:text-slate-300">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {res.name}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {res.details}
                      </div>
                      {res.error && (
                        <div className="text-[11px] font-mono text-red-700 dark:text-red-400 mt-1">
                          {res.error}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-right tabular-nums text-slate-700 dark:text-slate-300">
                      {res.assertionsRun}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Expandable Technical Diagnostics & Proposed Schemas */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <FileJson className="w-4 h-4 text-slate-600 dark:text-slate-400" />
            <div>
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Proposed Snapshot &amp; Future Command Contract Schemas (dot.mission-control.v1)
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Technical JSON schemas, idempotency rules, and commandAccepted vs. deliveryAck
                examples.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setSchemaExpanded((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded cursor-pointer whitespace-nowrap shrink-0"
          >
            {schemaExpanded ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Hide Technical Schemas</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Expand Technical Schemas</span>
              </>
            )}
          </button>
        </div>

        {schemaExpanded && (
          <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 rounded-md w-fit">
              <button
                type="button"
                onClick={() => setSchemaView('snapshot')}
                className={`px-3 py-1 text-xs font-medium rounded cursor-pointer ${
                  schemaView === 'snapshot'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Snapshot Schema
              </button>
              <button
                type="button"
                onClick={() => setSchemaView('command')}
                className={`px-3 py-1 text-xs font-medium rounded cursor-pointer ${
                  schemaView === 'command'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Future Command Schema
              </button>
              <button
                type="button"
                onClick={() => setSchemaView('errors')}
                className={`px-3 py-1 text-xs font-medium rounded cursor-pointer ${
                  schemaView === 'errors'
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                Endpoints &amp; Outcome Examples
              </button>
            </div>

            {schemaView === 'snapshot' && (
              <pre className="bg-slate-900 text-slate-100 font-mono text-xs p-4 rounded-md overflow-x-auto max-h-96">
                {JSON.stringify(SNAPSHOT_JSON_SCHEMA, null, 2)}
              </pre>
            )}

            {schemaView === 'command' && (
              <pre className="bg-slate-900 text-slate-100 font-mono text-xs p-4 rounded-md overflow-x-auto max-h-96">
                {JSON.stringify(COMMAND_REQUEST_JSON_SCHEMA, null, 2)}
              </pre>
            )}

            {schemaView === 'errors' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {CONTRACT_DOCUMENTATION_EXAMPLES.endpoints.map((ep) => (
                    <div
                      key={ep.path}
                      className="border border-slate-200 dark:border-slate-800 rounded-md p-3 text-xs"
                    >
                      <div className="font-mono font-semibold text-slate-900 dark:text-slate-100 mb-0.5">
                        {ep.method} {ep.path}
                      </div>
                      <div className="text-[11px] font-medium text-sky-700 dark:text-sky-400 mb-1">
                        {ep.status}
                      </div>
                      <p className="text-slate-600 dark:text-slate-400">{ep.description}</p>
                    </div>
                  ))}
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 mb-2">
                    <Code2 className="w-4 h-4 text-slate-500" />
                    <span>
                      Command Accepted vs. Delivery Acknowledged vs. Uncertain Timeout Examples
                    </span>
                  </div>
                  <pre className="bg-slate-900 text-slate-100 font-mono text-xs p-4 rounded-md overflow-x-auto max-h-80">
                    {JSON.stringify(CONTRACT_DOCUMENTATION_EXAMPLES.errorResponses, null, 2)}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
};
