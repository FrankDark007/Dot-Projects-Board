/**
 * @file src/components/ContractAndTestsView.tsx
 * @description Truthful Verification & Integration Contract inspector.
 * Separates Fixture/Evaluator tests, Mocked-HTTP Transport/Validator tests,
 * UI Rendering tests, and Real Local Integration (which remains UNVERIFIED until
 * connected to the local Mission Control / projectBoard backend).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Code2,
  FileJson,
  Play,
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
  runAsyncTransportTests,
  TestCaseResult,
} from '../tests/contractAndState.test';

export const ContractAndTestsView: React.FC = () => {
  const [reRunCounter, setReRunCounter] = useState(0);
  const [asyncResults, setAsyncResults] = useState<TestCaseResult[]>([]);
  const [runningAsync, setRunningAsync] = useState(true);
  const [schemaExpanded, setSchemaExpanded] = useState(false);
  const [schemaView, setSchemaView] = useState<'snapshot' | 'command' | 'errors'>('snapshot');

  const syncSummary = useMemo(() => {
    void reRunCounter;
    return runAllContractAndStateTests();
  }, [reRunCounter]);

  useEffect(() => {
    let cancelled = false;
    setRunningAsync(true);
    void runAsyncTransportTests().then((res) => {
      if (!cancelled) {
        setAsyncResults(res.results);
        setRunningAsync(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reRunCounter]);

  const allResults = [...syncSummary.results, ...asyncResults];
  const passedCount = allResults.filter((r) => r.passed).length;
  const totalAssertions = allResults.reduce((acc, r) => acc + r.assertionsRun, 0);

  return (
    <div className="space-y-6">
      {/* 1. Scope & Truthful Verification Status Banner */}
      <section className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 mb-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-xs mb-1">
              <span className="inline-flex items-center gap-1 font-semibold text-teal-700 dark:text-teal-400">
                <ShieldCheck className="w-4 h-4" />
                <span>Automated Sandbox Suites: {passedCount}/{allResults.length} Passed</span>
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
              Test Scope Separation: Fixture Logic, Mocked Transport, UI Rendering &amp; Local Integration
            </h2>
          </div>

          <button
            type="button"
            disabled={runningAsync}
            onClick={() => setReRunCounter((c) => c + 1)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded transition-colors disabled:opacity-50 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            <span>{runningAsync ? 'Running Suites...' : 'Re-Run All Suites'}</span>
          </button>
        </div>

        {/* 4-Column Scope Matrix */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs mb-5">
          <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3">
            <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
              1. Fixture &amp; Evaluator Suite
            </div>
            <div className="font-mono text-teal-700 dark:text-teal-400 mb-1">
              VERIFIED (Deterministic Clock)
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Tests heartbeat expiry without new snapshots, future timestamp skew, strict Verified
              Complete gates, and liveness vs. stalled progress.
            </p>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3">
            <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
              2. Transport &amp; Validator Suite
            </div>
            <div className="font-mono text-teal-700 dark:text-teal-400 mb-1">
              VERIFIED (Mocked HTTP)
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Tests runtime schema validation, duplicate ID &amp; out-of-order rejection, hung
              request timeouts, overlap guards, and late response cancellation.
            </p>
          </div>

          <div className="border border-slate-200 dark:border-slate-800 rounded-md p-3">
            <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
              3. UI &amp; Isolation Suite
            </div>
            <div className="font-mono text-teal-700 dark:text-teal-400 mb-1">
              VERIFIED (Component Render)
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              Tests compact rows, card views, disabled controls in read-only Live Mode, and
              confirmed failure vs. missing info labels.
            </p>
          </div>

          <div className="border border-amber-300 dark:border-amber-800/80 bg-amber-50/40 dark:bg-amber-950/20 rounded-md p-3">
            <div className="font-semibold text-slate-900 dark:text-slate-100 mb-1">
              4. Real Local Integration
            </div>
            <div className="font-mono font-semibold text-amber-800 dark:text-amber-400 mb-1">
              UNVERIFIED IN SANDBOX
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
              {allResults.map((res) => (
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
              ))}
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
