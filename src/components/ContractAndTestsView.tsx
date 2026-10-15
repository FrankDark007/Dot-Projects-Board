/**
 * @file src/components/ContractAndTestsView.tsx
 * @description Interactive Verification & Integration Contract inspector displaying:
 * - All 11 automated test suite results and assertion counts
 * - Proposed Snapshot, Event Stream (SSE), and Command interfaces & JSON Schemas
 * - Clear boundary table of what works in Demo vs what requires Local Mission Control integration
 */

import React, { useMemo, useState } from 'react';
import { CheckCircle2, Code2, FileJson, Play, ShieldCheck, XCircle } from 'lucide-react';
import {
  COMMAND_REQUEST_JSON_SCHEMA,
  CONTRACT_DOCUMENTATION_EXAMPLES,
  SNAPSHOT_JSON_SCHEMA,
} from '../schema/jsonSchemas';
import { runAllContractAndStateTests } from '../tests/contractAndState.test';

export const ContractAndTestsView: React.FC = () => {
  const [reRunCounter, setReRunCounter] = useState(0);
  const [schemaView, setSchemaView] = useState<'snapshot' | 'command' | 'errors'>('snapshot');

  const testSummary = useMemo(() => {
    void reRunCounter;
    return runAllContractAndStateTests();
  }, [reRunCounter]);

  return (
    <div className="space-y-8">
      {/* 1. Automated Verification Suite Panel */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 mb-5 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-800 mb-1">
              <ShieldCheck className="w-4 h-4 text-emerald-700" />
              <span>Automated Contract & Truthful State Test Suite</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {testSummary.passedTests}/{testSummary.totalTests} passed (
                {testSummary.totalAssertions} assertions)
              </span>
            </div>
            <h2 className="text-lg font-semibold text-slate-900">
              11 Required Edge-Case & State Separation Scenarios
            </h2>
          </div>

          <button
            type="button"
            onClick={() => setReRunCounter((c) => c + 1)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" />
            <span>Re-Run Automated Tests</span>
          </button>
        </div>

        <div className="border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-2.5 px-3 font-medium">Status</th>
                <th className="py-2.5 px-3 font-medium">Scenario</th>
                <th className="py-2.5 px-3 font-medium">Verification Assertion Details</th>
                <th className="py-2.5 px-3 font-medium text-right">Assertions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {testSummary.results.map((res) => (
                <tr key={res.id} className="hover:bg-slate-50/80">
                  <td className="py-3 px-3 whitespace-nowrap">
                    {res.passed ? (
                      <span className="inline-flex items-center gap-1 font-mono font-semibold text-emerald-800">
                        <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                        <span>PASS</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-mono font-semibold text-red-700">
                        <XCircle className="w-4 h-4 text-red-700" />
                        <span>FAIL</span>
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <div className="font-semibold text-slate-900">{res.scenarioCategory}</div>
                    <div className="font-mono text-[11px] text-slate-500">{res.id}</div>
                  </td>
                  <td className="py-3 px-3 text-slate-700">
                    <div>{res.name}</div>
                    <div className="text-slate-500 mt-0.5">{res.details}</div>
                  </td>
                  <td className="py-3 px-3 font-mono text-right tabular-nums text-slate-700">
                    {res.assertionsRun}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 2. Delivery Truthfulness: Demo vs Tested vs Local Integration Checklist */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <h2 className="text-lg font-semibold text-slate-900 mb-1">
          Delivery Boundary: What Works in Demo, What Was Tested & What Requires Local Integration
        </h2>
        <p className="text-xs text-slate-600 mb-5">
          This dashboard is built in Google AI Studio without access to your Macs, local
          repositories, task sessions, MD workers, or private network. It does not claim to be
          live until wired to your local Mission Control backend and verified against acceptance
          checks.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs">
          <div className="border border-slate-200 rounded-lg p-4">
            <h3 className="font-semibold text-slate-900 mb-2">
              1. Works Now in This Build (Demo & UI)
            </h3>
            <ul className="space-y-1.5 text-slate-700 list-disc pl-4">
              <li>
                Four-dimensional state separation (Completion vs Worker Liveness/Progress vs
                Approval vs Connection Health).
              </li>
              <li>
                Overview buckets (Working Now, Blocked, Waiting For Me, Unfinished, Verified
                Complete) and Attention Queue.
              </li>
              <li>
                Expandable milestone workflow & acceptance gate diagrams on every project card.
              </li>
              <li>
                Interactive controls: Archive with Undo, Priority mutation, Operator Notes,
                Decision resolution, and Reminders with delivery ack checks.
              </li>
              <li>
                Explicit Live Mode adapter (`fetchLiveSnapshot`) with bounded polling, backoff,
                background-tab throttling, `NOT CONNECTED` default, and `STALE` preservation.
              </li>
            </ul>
          </div>

          <div className="border border-slate-200 rounded-lg p-4">
            <h3 className="font-semibold text-slate-900 mb-2">
              2. Verified by Automated Tests (11 Scenarios)
            </h3>
            <ul className="space-y-1.5 text-slate-700 list-disc pl-4">
              <li>Normal execution (`active_running` requires fresh heartbeat + fresh progress).</li>
              <li>Worker crash (`SIGSEGV` exit 139 marks worker crashed &amp; project blocked).</li>
              <li>Heartbeat expiry (`&gt;90s` marks worker `stale_heartbeat`, 0 active count).</li>
              <li>Stalled progress (`18s` heartbeat + `48m` no progress marks `stalled_progress`).</li>
              <li>Disconnected sources & unknown worker coverage (`null` count, never fake 0).</li>
              <li>Missing/partial costs (`knownUsd: null` or explicit `Estimate` label).</li>
              <li>Duplicate event deduplication by stable `eventId` & `source.sourceId`.</li>
              <li>Completed execution turn (`succeeded_turn`) with failed acceptance gate.</li>
              <li>Idempotency replay, `REVISION_CONFLICT` (409), and failed reminder ack.</li>
            </ul>
          </div>

          <div className="border border-slate-200 rounded-lg p-4">
            <h3 className="font-semibold text-slate-900 mb-2">
              3. Requires Local Mission Control Integration
            </h3>
            <ul className="space-y-1.5 text-slate-700 list-disc pl-4">
              <li>
                Mounting `GET /api/mission-control/v1/snapshot` in your local Mission Control
                server to emit `dot.mission-control.v1` JSON from real Mac/MD worker state.
              </li>
              <li>
                Wiring `POST /api/mission-control/v1/commands` to your local SQLite/state store
                and `dot` supervisor IPC socket for real reminder delivery acks.
              </li>
              <li>
                Attaching local HttpOnly session cookie or localhost bearer middleware.
              </li>
              <li>
                Running end-to-end local acceptance gate checks before declaring the integration
                live.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 3. Proposed Integration Contract & JSON Schemas */}
      <section className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 mb-5 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-slate-600 mb-1">
              <FileJson className="w-4 h-4 text-slate-700" />
              <span>Proposed Integration Contract (dot.mission-control.v1)</span>
            </div>
            <h2 className="text-lg font-semibold text-slate-900">
              Proposed Snapshot, Event Stream & Command Interfaces
            </h2>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            <button
              type="button"
              onClick={() => setSchemaView('snapshot')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                schemaView === 'snapshot'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Snapshot Schema
            </button>
            <button
              type="button"
              onClick={() => setSchemaView('command')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                schemaView === 'command'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Command Schema
            </button>
            <button
              type="button"
              onClick={() => setSchemaView('errors')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                schemaView === 'errors'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Endpoints & Error Responses
            </button>
          </div>
        </div>

        {schemaView === 'snapshot' && (
          <div>
            <p className="text-xs text-slate-600 mb-3">
              JSON Schema (`https://json-schema.org/draft/2020-12/schema`) for{' '}
              <code className="font-mono text-slate-900">MissionControlSnapshot</code>:
            </p>
            <pre className="bg-slate-900 text-slate-100 font-mono text-xs p-4 rounded-lg overflow-x-auto max-h-96">
              {JSON.stringify(SNAPSHOT_JSON_SCHEMA, null, 2)}
            </pre>
          </div>
        )}

        {schemaView === 'command' && (
          <div>
            <p className="text-xs text-slate-600 mb-3">
              JSON Schema for <code className="font-mono text-slate-900">OperatorCommandRequest</code>{' '}
              (enforcing <code className="font-mono">idempotencyKey</code> and{' '}
              <code className="font-mono">expectedRevision</code>):
            </p>
            <pre className="bg-slate-900 text-slate-100 font-mono text-xs p-4 rounded-lg overflow-x-auto max-h-96">
              {JSON.stringify(COMMAND_REQUEST_JSON_SCHEMA, null, 2)}
            </pre>
          </div>
        )}

        {schemaView === 'errors' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {CONTRACT_DOCUMENTATION_EXAMPLES.endpoints.map((ep) => (
                <div key={ep.path} className="border border-slate-200 rounded-lg p-3.5 text-xs">
                  <div className="font-mono font-semibold text-slate-900 mb-1">
                    {ep.method} {ep.path}
                  </div>
                  <p className="text-slate-600 mb-2">{ep.description}</p>
                </div>
              ))}
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-900 mb-2">
                <Code2 className="w-4 h-4 text-slate-600" />
                <span>Example Conflict (409) & Failed Delivery (502) Responses</span>
              </div>
              <pre className="bg-slate-900 text-slate-100 font-mono text-xs p-4 rounded-lg overflow-x-auto max-h-80">
                {JSON.stringify(CONTRACT_DOCUMENTATION_EXAMPLES.errorResponses, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
