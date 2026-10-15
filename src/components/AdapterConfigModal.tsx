/**
 * @file src/components/AdapterConfigModal.tsx
 * @description Modal for configuring Demo Mode vs Live Mode adapter settings.
 * Enforces strict separation: synthetic simulations are ONLY available in Demo Mode
 * and never inject synthetic fixtures into Live Mode.
 */

import React, { useEffect, useState } from 'react';
import { Clock, RefreshCw, ShieldAlert, Sliders, X } from 'lucide-react';
import { DashboardMode, LiveAdapterConfig } from '../adapters/dataAdapter';

interface AdapterConfigModalProps {
  mode: DashboardMode;
  liveConfig: LiveAdapterConfig;
  capabilitiesReadOnlySimulated: boolean;
  demoClockOffsetSeconds: number;
  onClose: () => void;
  onSwitchMode: (mode: DashboardMode) => void;
  onUpdateLiveConfig: (config: LiveAdapterConfig) => void;
  onTriggerLivePollNow: () => void;
  onToggleCapabilitiesReadOnly: (disabled: boolean) => void;
  onAdvanceDemoClockSeconds: (deltaSeconds: number) => void;
  onResetDemoFixtures: () => void;
}

export const AdapterConfigModal: React.FC<AdapterConfigModalProps> = ({
  mode,
  liveConfig,
  capabilitiesReadOnlySimulated,
  demoClockOffsetSeconds,
  onClose,
  onSwitchMode,
  onUpdateLiveConfig,
  onTriggerLivePollNow,
  onToggleCapabilitiesReadOnly,
  onAdvanceDemoClockSeconds,
  onResetDemoFixtures,
}) => {
  const [draftConfig, setDraftConfig] = useState<LiveAdapterConfig>(liveConfig);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSaveConfig = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateLiveConfig(draftConfig);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="adapter-config-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 overflow-y-auto"
    >
      <div className="bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-800 rounded-xl w-full max-w-2xl overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-slate-700 dark:text-slate-300" />
            <h2
              id="adapter-config-title"
              className="text-sm font-semibold text-slate-900 dark:text-slate-100"
            >
              Data Adapter & Connection Mode Configuration
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close adapter configuration"
            className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white rounded-md cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6 text-xs">
          {/* Mode Selector */}
          <div>
            <label className="block font-semibold text-slate-900 dark:text-slate-100 mb-2">
              1. Operating Mode (Strict Isolation)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onSwitchMode('demo')}
                className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                  mode === 'demo'
                    ? 'border-sky-600 bg-sky-600 text-white'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="font-semibold mb-1">Demo Mode (Synthetic Fixtures)</div>
                <p
                  className={
                    mode === 'demo'
                      ? 'text-sky-100 text-[11px]'
                      : 'text-slate-500 dark:text-slate-400 text-[11px]'
                  }
                >
                  Uses sanitized synthetic fixtures with a persistent SYNTHETIC DEMO DATA banner.
                </p>
              </button>

              <button
                type="button"
                onClick={() => onSwitchMode('live')}
                className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                  mode === 'live'
                    ? 'border-sky-600 bg-sky-600 text-white'
                    : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="font-semibold mb-1">Live Mode (Local Mission Control)</div>
                <p
                  className={
                    mode === 'live'
                      ? 'text-sky-100 text-[11px]'
                      : 'text-slate-500 dark:text-slate-400 text-[11px]'
                  }
                >
                  Starts NOT CONNECTED. Evaluates against real advancing clock; never substitutes
                  demo data on failure.
                </p>
              </button>
            </div>
          </div>

          {/* Live Adapter Settings */}
          <form
            onSubmit={handleSaveConfig}
            className="space-y-4 pt-4 border-t border-slate-200 dark:border-slate-800"
          >
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                2. Bounded Polling Live Adapter Settings
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Uses AbortSignal timeout, exponential backoff &amp; tab throttling
              </span>
            </div>

            <div>
              <label
                htmlFor="endpoint-url"
                className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
              >
                Local Mission Control Base URL
              </label>
              <input
                id="endpoint-url"
                type="url"
                value={draftConfig.endpointBaseUrl}
                onChange={(e) =>
                  setDraftConfig((prev) => ({ ...prev, endpointBaseUrl: e.target.value }))
                }
                className="w-full font-mono text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-3 py-2 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="poll-interval"
                  className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Poll Interval (ms)
                </label>
                <input
                  id="poll-interval"
                  type="number"
                  min={2000}
                  step={1000}
                  value={draftConfig.basePollIntervalMs}
                  onChange={(e) =>
                    setDraftConfig((prev) => ({
                      ...prev,
                      basePollIntervalMs: Number(e.target.value) || 10000,
                    }))
                  }
                  className="w-full font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </div>

              <div>
                <label
                  htmlFor="req-timeout"
                  className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Request Timeout (ms)
                </label>
                <input
                  id="req-timeout"
                  type="number"
                  min={1000}
                  step={1000}
                  value={draftConfig.requestTimeoutMs}
                  onChange={(e) =>
                    setDraftConfig((prev) => ({
                      ...prev,
                      requestTimeoutMs: Number(e.target.value) || 8000,
                    }))
                  }
                  className="w-full font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-slate-900 dark:text-slate-100 tabular-nums"
                />
              </div>

              <div>
                <label
                  htmlFor="bg-throttle"
                  className="block font-medium text-slate-700 dark:text-slate-300 mb-1"
                >
                  Background Tab Throttle
                </label>
                <select
                  id="bg-throttle"
                  value={draftConfig.backgroundTabMultiplier}
                  onChange={(e) =>
                    setDraftConfig((prev) => ({
                      ...prev,
                      backgroundTabMultiplier: Number(e.target.value) || 4,
                    }))
                  }
                  className="w-full font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1.5 text-slate-900 dark:text-slate-100"
                >
                  <option value={2}>2x slower when tab hidden</option>
                  <option value={4}>4x slower when tab hidden</option>
                  <option value={6}>6x slower when tab hidden</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <button
                type="button"
                onClick={onTriggerLivePollNow}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Test Live Poll Now</span>
              </button>

              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded cursor-pointer"
              >
                Save Adapter Config
              </button>
            </div>
          </form>

          {/* Demo-Only Sandbox Simulations (Strictly disabled in Live Mode!) */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                <span>3. Demo-Only Sandbox Simulations</span>
              </div>
              {mode === 'live' && (
                <span className="font-mono text-[11px] text-amber-700 dark:text-amber-400">
                  Disabled in Live Mode (strict isolation)
                </span>
              )}
            </div>

            <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  Simulate Read-Only Backend Capabilities (Demo Only)
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Disables Archive, Priority, Notes, and Reminders in Demo Mode to verify
                  disabled control explanations.
                </div>
              </div>
              <input
                type="checkbox"
                disabled={mode !== 'demo'}
                checked={capabilitiesReadOnlySimulated}
                onChange={(e) => onToggleCapabilitiesReadOnly(e.target.checked)}
                aria-label="Simulate unsupported backend write capabilities"
                className="h-4 w-4 accent-sky-600 cursor-pointer disabled:opacity-40"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div>
                <div className="font-medium text-slate-900 dark:text-slate-100">
                  Advance Demo Evaluation Clock (+{demoClockOffsetSeconds}s offset)
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Advances reference clock without a new snapshot so fresh 14s/22s heartbeats
                  expire (&gt;90s) into unknown execution.
                </div>
              </div>
              <button
                type="button"
                disabled={mode !== 'demo'}
                onClick={() => onAdvanceDemoClockSeconds(120)}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" />
                <span>Advance +120s</span>
              </button>
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-500 dark:text-slate-400">
                Reset synthetic fixtures and demo clock offset:
              </span>
              <button
                type="button"
                onClick={onResetDemoFixtures}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 cursor-pointer"
              >
                Reset Demo Fixtures
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
