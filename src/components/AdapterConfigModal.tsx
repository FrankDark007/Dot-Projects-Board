/**
 * @file src/components/AdapterConfigModal.tsx
 * @description Modal for configuring Demo Mode vs Live Mode adapter settings,
 * bounded polling/backoff parameters, and diagnostic fault simulations.
 */

import React, { useEffect, useState } from 'react';
import { Radio, RefreshCw, ShieldAlert, Sliders, X } from 'lucide-react';
import { DashboardMode, LiveAdapterConfig } from '../adapters/dataAdapter';

interface AdapterConfigModalProps {
  mode: DashboardMode;
  liveConfig: LiveAdapterConfig;
  capabilitiesReadOnlySimulated: boolean;
  staleLiveSimulated: boolean;
  onClose: () => void;
  onSwitchMode: (mode: DashboardMode) => void;
  onUpdateLiveConfig: (config: LiveAdapterConfig) => void;
  onTriggerLivePollNow: () => void;
  onToggleCapabilitiesReadOnly: (disabled: boolean) => void;
  onToggleSimulateStaleLive: (stale: boolean) => void;
  onResetDemoFixtures: () => void;
}

export const AdapterConfigModal: React.FC<AdapterConfigModalProps> = ({
  mode,
  liveConfig,
  capabilitiesReadOnlySimulated,
  staleLiveSimulated,
  onClose,
  onSwitchMode,
  onUpdateLiveConfig,
  onTriggerLivePollNow,
  onToggleCapabilitiesReadOnly,
  onToggleSimulateStaleLive,
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 overflow-y-auto"
    >
      <div className="bg-white border border-slate-300 rounded-xl w-full max-w-2xl overflow-hidden shadow-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-slate-700" />
            <h2 id="adapter-config-title" className="text-base font-semibold text-slate-900">
              Data Adapter & Connection Mode Configuration
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close adapter configuration"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-6 text-xs">
          {/* Mode Selector */}
          <div>
            <label className="block font-semibold text-slate-900 mb-2">
              1. Operating Mode (Strict Separation)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => onSwitchMode('demo')}
                className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                  mode === 'demo'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'
                }`}
              >
                <div className="font-semibold mb-1">Demo Mode (Synthetic Fixtures)</div>
                <p
                  className={
                    mode === 'demo' ? 'text-slate-300 text-[11px]' : 'text-slate-500 text-[11px]'
                  }
                >
                  Uses deterministic synthetic fixtures with a persistent DEMO DATA banner.
                </p>
              </button>

              <button
                type="button"
                onClick={() => onSwitchMode('live')}
                className={`text-left p-3.5 rounded-lg border transition-colors cursor-pointer ${
                  mode === 'live'
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'
                }`}
              >
                <div className="font-semibold mb-1">Live Mode (Local Mission Control)</div>
                <p
                  className={
                    mode === 'live' ? 'text-slate-300 text-[11px]' : 'text-slate-500 text-[11px]'
                  }
                >
                  Connects to your local adapter. Shows NOT CONNECTED until verified; never
                  substitutes demo data on failure.
                </p>
              </button>
            </div>
          </div>

          {/* Live Adapter Settings */}
          <form onSubmit={handleSaveConfig} className="space-y-4 pt-4 border-t border-slate-200">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900">
                2. Authenticated Local Adapter Settings
              </span>
              <span className="text-[11px] text-slate-500">
                No secrets or API keys stored in browser code
              </span>
            </div>

            <div>
              <label
                htmlFor="endpoint-url"
                className="block font-medium text-slate-700 mb-1"
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
                className="w-full font-mono text-xs bg-white border border-slate-300 rounded-md px-3 py-2 text-slate-900"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label
                  htmlFor="transport-mode"
                  className="block font-medium text-slate-700 mb-1"
                >
                  Transport Strategy
                </label>
                <select
                  id="transport-mode"
                  value={draftConfig.transport}
                  onChange={(e) =>
                    setDraftConfig((prev) => ({
                      ...prev,
                      transport: e.target.value as LiveAdapterConfig['transport'],
                    }))
                  }
                  className="w-full bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-900"
                >
                  <option value="bounded_polling">Bounded Polling + Backoff</option>
                  <option value="sse_stream">Single SSE Event Stream</option>
                </select>
              </div>

              <div>
                <label
                  htmlFor="poll-interval"
                  className="block font-medium text-slate-700 mb-1"
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
                  className="w-full font-mono bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-900 tabular-nums"
                />
              </div>

              <div>
                <label
                  htmlFor="bg-throttle"
                  className="block font-medium text-slate-700 mb-1"
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
                  className="w-full font-mono bg-white border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-900"
                >
                  <option value={2}>2x slower when tab hidden</option>
                  <option value={4}>4x slower when tab hidden</option>
                  <option value={6}>6x slower when tab hidden</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={onTriggerLivePollNow}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-md cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Test Live Poll Now</span>
              </button>

              <button
                type="submit"
                className="px-4 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer"
              >
                Save Adapter Config
              </button>
            </div>
          </form>

          {/* Diagnostic & Contract Verification Toggles */}
          <div className="pt-4 border-t border-slate-200 space-y-3">
            <div className="flex items-center gap-1.5 font-semibold text-slate-900">
              <ShieldAlert className="w-4 h-4 text-amber-700" />
              <span>3. Integration Contract Diagnostic Simulations</span>
            </div>

            <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div>
                <div className="font-medium text-slate-900">
                  Simulate Unsupported Backend Write Capabilities
                </div>
                <div className="text-[11px] text-slate-500">
                  Disables Archive, Priority, Notes, and Reminders and explains why on every
                  control.
                </div>
              </div>
              <input
                type="checkbox"
                checked={capabilitiesReadOnlySimulated}
                onChange={(e) => onToggleCapabilitiesReadOnly(e.target.checked)}
                aria-label="Simulate unsupported backend write capabilities"
                className="h-4 w-4 accent-slate-900 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between gap-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div>
                <div className="font-medium text-slate-900">
                  Simulate Disconnected Live Feed with Last-Known Stale Snapshot
                </div>
                <div className="text-[11px] text-slate-500">
                  Verifies that when a previously connected live feed drops, last-known data is
                  preserved with an explicit STALE warning.
                </div>
              </div>
              <input
                type="checkbox"
                checked={staleLiveSimulated}
                onChange={(e) => onToggleSimulateStaleLive(e.target.checked)}
                aria-label="Simulate disconnected live feed with preserved stale snapshot"
                className="h-4 w-4 accent-slate-900 cursor-pointer"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <span className="text-slate-500">
                Reset synthetic fixtures to initial baseline state:
              </span>
              <button
                type="button"
                onClick={onResetDemoFixtures}
                className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
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
