/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Database,
  RefreshCw,
  Search,
  Sliders,
  Undo2,
  WifiOff,
  XCircle,
} from 'lucide-react';
import {
  DashboardMode,
  DEFAULT_LIVE_CONFIG,
  fetchLiveSnapshot,
  LiveAdapterConfig,
  MissionControlDataController,
} from './adapters/dataAdapter';
import { AdapterConfigModal } from './components/AdapterConfigModal';
import { AttentionPanel } from './components/AttentionPanel';
import { ContractAndTestsView } from './components/ContractAndTestsView';
import { ProjectCard } from './components/ProjectCard';
import { ProjectDetailModal } from './components/ProjectDetailModal';
import { WorkersAndRunsView } from './components/WorkersAndRunsView';
import { evaluateAllProjects, ProjectOverviewBucket } from './engine/stateEvaluator';
import { createSyntheticSnapshot, REFERENCE_NOW_ISO } from './fixtures/syntheticFixtures';
import {
  ConnectionHealthState,
  CONTRACT_SCHEMA_VERSION,
  MissionControlSnapshot,
  PriorityLevel,
} from './schema/contract';
import { formatRelativeAge, formatUtcShort } from './utils/timeFormat';

type NavSection =
  | 'command_center'
  | 'attention_queue'
  | 'workers_runs'
  | 'contract_tests'
  | 'archived';

interface ActionFeedbackBanner {
  id: string;
  tone: 'success' | 'warning' | 'danger';
  message: string;
  undoProjectId?: string;
  undoTargetArchiveState?: boolean;
}

export default function App() {
  const controllerRef = useRef<MissionControlDataController>(
    new MissionControlDataController()
  );

  const [mode, setMode] = useState<DashboardMode>('demo');
  const [liveConfig, setLiveConfig] = useState<LiveAdapterConfig>(DEFAULT_LIVE_CONFIG);
  const [demoSnapshot, setDemoSnapshot] = useState<MissionControlSnapshot>(() =>
    controllerRef.current.getSnapshot()
  );

  // Live mode state (strictly separate from Demo data; never silently falls back to Demo)
  const [liveSnapshot, setLiveSnapshot] = useState<MissionControlSnapshot | null>(null);
  const [liveConnectionHealth, setLiveConnectionHealth] =
    useState<ConnectionHealthState>('not_connected');
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveLastSyncedAt, setLiveLastSyncedAt] = useState<string | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [isBackgroundTab, setIsBackgroundTab] = useState(false);

  // Diagnostic simulation flags for verifying contract behavior
  const [capabilitiesReadOnlySimulated, setCapabilitiesReadOnlySimulated] = useState(false);
  const [staleLiveSimulated, setStaleLiveSimulated] = useState(false);

  // Navigation, filtering & selection state
  const [activeNav, setActiveNav] = useState<NavSection>('command_center');
  const [selectedBucket, setSelectedBucket] = useState<'all' | ProjectOverviewBucket>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [adapterModalOpen, setAdapterModalOpen] = useState(false);
  const [feedbackBanner, setFeedbackBanner] = useState<ActionFeedbackBanner | null>(null);

  const referenceNowIso = REFERENCE_NOW_ISO;

  // Track background tab visibility for bounded polling throttling
  useEffect(() => {
    const onVisibilityChange = () => {
      setIsBackgroundTab(document.visibilityState === 'hidden');
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Poll Live Adapter when in Live Mode
  const performLivePoll = useCallback(async () => {
    try {
      const snap = await fetchLiveSnapshot(liveConfig);
      setLiveSnapshot(snap);
      setLiveConnectionHealth('connected');
      setLiveLastSyncedAt(new Date().toISOString());
      setLiveError(null);
      setConsecutiveFailures(0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLiveError(msg);
      setConsecutiveFailures((prev) => prev + 1);
      setLiveConnectionHealth((prevHealth) =>
        prevHealth === 'connected' || prevHealth === 'degraded_stale' || liveSnapshot !== null
          ? 'degraded_stale'
          : 'not_connected'
      );
    }
  }, [liveConfig, liveSnapshot]);

  useEffect(() => {
    if (mode !== 'live' || staleLiveSimulated) return;

    let cancelled = false;
    const controller = new AbortController();

    const backoffMultiplier = Math.pow(1.5, Math.min(consecutiveFailures, 5));
    const tabMultiplier = isBackgroundTab ? liveConfig.backgroundTabMultiplier : 1;
    const delayMs = Math.min(
      liveConfig.maxBackoffMs * tabMultiplier,
      Math.round(liveConfig.basePollIntervalMs * backoffMultiplier * tabMultiplier)
    );

    const timer = window.setTimeout(() => {
      if (!cancelled) {
        void performLivePoll();
      }
    }, delayMs);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [
    mode,
    staleLiveSimulated,
    consecutiveFailures,
    isBackgroundTab,
    liveConfig,
    performLivePoll,
  ]);

  // Determine effective connection health and active snapshot (never substituting demo data in live mode unless stale simulation is explicitly toggled)
  const effectiveConnectionHealth: ConnectionHealthState =
    mode === 'demo' ? 'demo_synthetic' : liveConnectionHealth;

  const activeSnapshot: MissionControlSnapshot | null =
    mode === 'demo' ? demoSnapshot : liveSnapshot;

  // Evaluate all projects in the active snapshot
  const allEvaluatedProjects = useMemo(() => {
    if (!activeSnapshot) return [];
    return evaluateAllProjects(activeSnapshot, referenceNowIso);
  }, [activeSnapshot, referenceNowIso]);

  const activeUnarchivedProjects = useMemo(
    () => allEvaluatedProjects.filter((ep) => !ep.project.archived),
    [allEvaluatedProjects]
  );

  const archivedProjects = useMemo(
    () => allEvaluatedProjects.filter((ep) => ep.project.archived),
    [allEvaluatedProjects]
  );

  // Compute truthful Overview KPI bucket counts (across non-archived projects)
  const bucketCounts = useMemo(() => {
    const counts: Record<ProjectOverviewBucket, number> = {
      working_now: 0,
      blocked: 0,
      waiting_for_me: 0,
      unfinished: 0,
      recently_verified_complete: 0,
    };
    for (const ep of activeUnarchivedProjects) {
      for (const b of ep.buckets) {
        counts[b] += 1;
      }
    }
    return counts;
  }, [activeUnarchivedProjects]);

  // Unique owners for filter
  const uniqueOwners = useMemo(() => {
    if (!activeSnapshot) return [];
    return Array.from(new Set(activeSnapshot.projects.map((p) => p.owner)));
  }, [activeSnapshot]);

  // Filter projects according to active view, bucket, owner, priority, and search query
  const filteredProjects = useMemo(() => {
    const sourceList =
      activeNav === 'archived' ? archivedProjects : activeUnarchivedProjects;

    return sourceList.filter((ep) => {
      if (activeNav !== 'archived' && selectedBucket !== 'all') {
        if (!ep.buckets.includes(selectedBucket)) return false;
      }
      if (ownerFilter !== 'all' && ep.project.owner !== ownerFilter) {
        return false;
      }
      if (priorityFilter !== 'all' && ep.project.priority !== priorityFilter) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchName = ep.project.name.toLowerCase().includes(q);
        const matchScope = ep.project.currentScope.toLowerCase().includes(q);
        const matchOwner = ep.project.owner.toLowerCase().includes(q);
        const matchNext = ep.project.nextAction.toLowerCase().includes(q);
        const matchBlocker = ep.project.blocker?.summary.toLowerCase().includes(q) ?? false;
        const matchMilestone = ep.project.milestones.some(
          (m) =>
            m.title.toLowerCase().includes(q) ||
            m.remainingSteps.some((s) => s.toLowerCase().includes(q))
        );
        if (
          !matchName &&
          !matchScope &&
          !matchOwner &&
          !matchNext &&
          !matchBlocker &&
          !matchMilestone
        ) {
          return false;
        }
      }
      return true;
    });
  }, [
    activeNav,
    archivedProjects,
    activeUnarchivedProjects,
    selectedBucket,
    ownerFilter,
    priorityFilter,
    searchQuery,
  ]);

  // Effective capabilities (disabled when Live Mode is not connected or when simulated read-only is active)
  const effectiveCapabilities = useMemo(() => {
    if (!activeSnapshot) {
      return {
        canArchive: false,
        canChangePriority: false,
        canAddNote: false,
        canSendReminder: false,
        canResolveDecision: false,
        reasonIfDisabled: 'Live adapter is not connected.',
      };
    }
    if (mode === 'live' && effectiveConnectionHealth !== 'connected') {
      return {
        canArchive: false,
        canChangePriority: false,
        canAddNote: false,
        canSendReminder: false,
        canResolveDecision: false,
        reasonIfDisabled:
          'Live feed is disconnected (showing stale data). Reconnect before issuing operator writes.',
      };
    }
    return activeSnapshot.capabilities;
  }, [activeSnapshot, mode, effectiveConnectionHealth]);

  // Command Handlers (with Idempotency Keys, Optimistic Concurrency & Truthful Delivery Acks)
  const handleToggleArchive = (projectId: string, archive: boolean) => {
    if (!activeSnapshot) return;
    const proj = activeSnapshot.projects.find((p) => p.projectId === projectId);
    if (!proj) return;

    const res = controllerRef.current.executeCommand({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      idempotencyKey: `ui-archive-${projectId}-r${proj.revision}-${archive ? '1' : '0'}`,
      expectedRevision: proj.revision,
      issuedAt: new Date().toISOString(),
      command: {
        type: 'archive_project',
        projectId,
        archive,
      },
    });

    setDemoSnapshot(controllerRef.current.getSnapshot());

    if (res.ok) {
      setFeedbackBanner({
        id: res.idempotencyKey,
        tone: 'success',
        message: archive
          ? `Archived "${proj.name}". Zero files deleted and zero running jobs cancelled.`
          : `Restored "${proj.name}" from archive.`,
        undoProjectId: projectId,
        undoTargetArchiveState: !archive,
      });
    } else {
      setFeedbackBanner({
        id: res.idempotencyKey,
        tone: 'danger',
        message: res.errorMessage || 'Failed to update archive state.',
      });
    }
  };

  const handleChangePriority = (projectId: string, priority: PriorityLevel) => {
    if (!activeSnapshot) return;
    const proj = activeSnapshot.projects.find((p) => p.projectId === projectId);
    if (!proj) return;

    const res = controllerRef.current.executeCommand({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      idempotencyKey: `ui-prio-${projectId}-r${proj.revision}-${priority}`,
      expectedRevision: proj.revision,
      issuedAt: new Date().toISOString(),
      command: {
        type: 'set_priority',
        projectId,
        priority,
      },
    });

    setDemoSnapshot(controllerRef.current.getSnapshot());
    if (res.ok) {
      setFeedbackBanner({
        id: res.idempotencyKey,
        tone: 'success',
        message: `Updated "${proj.name}" priority to ${priority.toUpperCase()} (revision v${res.newRevision}).`,
      });
    } else {
      setFeedbackBanner({
        id: res.idempotencyKey,
        tone: 'danger',
        message: res.errorMessage || 'Priority update rejected.',
      });
    }
  };

  const handleAddNote = (projectId: string, body: string) => {
    if (!activeSnapshot) return;
    const proj = activeSnapshot.projects.find((p) => p.projectId === projectId);
    if (!proj) return;

    const res = controllerRef.current.executeCommand({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      idempotencyKey: `ui-note-${projectId}-r${proj.revision}-${Date.now()}`,
      expectedRevision: proj.revision,
      issuedAt: new Date().toISOString(),
      command: {
        type: 'add_note',
        projectId,
        body,
        author: 'you',
      },
    });

    setDemoSnapshot(controllerRef.current.getSnapshot());
    if (res.ok) {
      setFeedbackBanner({
        id: res.idempotencyKey,
        tone: 'success',
        message: `Added operator note to "${proj.name}".`,
      });
    } else {
      setFeedbackBanner({
        id: res.idempotencyKey,
        tone: 'danger',
        message: res.errorMessage || 'Could not add note.',
      });
    }
  };

  const handleSendReminder = (
    projectId: string,
    targetOwner: string,
    message: string
  ) => {
    if (!activeSnapshot) return;
    const proj = activeSnapshot.projects.find((p) => p.projectId === projectId);
    if (!proj) return;

    const res = controllerRef.current.executeCommand({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      idempotencyKey: `ui-rem-${projectId}-r${proj.revision}-${Date.now()}`,
      expectedRevision: proj.revision,
      issuedAt: new Date().toISOString(),
      command: {
        type: 'send_reminder',
        projectId,
        targetOwner,
        message,
      },
    });

    setDemoSnapshot(controllerRef.current.getSnapshot());

    if (res.ok && res.deliveryAck?.acknowledged) {
      setFeedbackBanner({
        id: res.idempotencyKey,
        tone: 'success',
        message: `Reminder delivered and acknowledged by ${targetOwner} via ${res.deliveryAck.channel} (Ack ID: ${res.deliveryAck.ackId}).`,
      });
    } else {
      setFeedbackBanner({
        id: res.idempotencyKey,
        tone: 'danger',
        message:
          res.errorMessage ||
          `Reminder delivery to ${targetOwner} was NOT acknowledged. Do not assume ${targetOwner} was notified.`,
      });
    }
  };

  const handleResolveDecision = (
    projectId: string,
    decisionId: string,
    selectedOption: string | undefined,
    resolutionNote: string
  ) => {
    if (!activeSnapshot) return;
    const proj = activeSnapshot.projects.find((p) => p.projectId === projectId);
    if (!proj) return;

    const res = controllerRef.current.executeCommand({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      idempotencyKey: `ui-dec-${decisionId}-r${proj.revision}`,
      expectedRevision: proj.revision,
      issuedAt: new Date().toISOString(),
      command: {
        type: 'resolve_decision',
        projectId,
        decisionId,
        selectedOption,
        resolutionNote,
      },
    });

    setDemoSnapshot(controllerRef.current.getSnapshot());
    if (res.ok) {
      setFeedbackBanner({
        id: res.idempotencyKey,
        tone: 'success',
        message: `Recorded decision for ${decisionId} (revision v${res.newRevision}).`,
      });
    } else {
      setFeedbackBanner({
        id: res.idempotencyKey,
        tone: 'danger',
        message: res.errorMessage || 'Could not resolve decision.',
      });
    }
  };

  const handleToggleCapabilitiesReadOnly = (disabled: boolean) => {
    setCapabilitiesReadOnlySimulated(disabled);
    controllerRef.current.setCapabilities({
      canArchive: !disabled,
      canChangePriority: !disabled,
      canAddNote: !disabled,
      canSendReminder: !disabled,
      canResolveDecision: !disabled,
      reasonIfDisabled: disabled
        ? 'Backend mounted in read-only observer mode (writes disabled by capability flag).'
        : undefined,
    });
    setDemoSnapshot(controllerRef.current.getSnapshot());
  };

  const handleToggleSimulateStaleLive = (stale: boolean) => {
    setStaleLiveSimulated(stale);
    if (stale) {
      setMode('live');
      setLiveSnapshot(createSyntheticSnapshot(REFERENCE_NOW_ISO));
      setLiveConnectionHealth('degraded_stale');
      setLiveLastSyncedAt(REFERENCE_NOW_ISO);
      setLiveError(
        'Connection lost to http://127.0.0.1:43110/api/mission-control/v1/snapshot (ECONNREFUSED). Preserving last-known snapshot.'
      );
    } else {
      setLiveSnapshot(null);
      setLiveConnectionHealth('not_connected');
      setLiveError(null);
    }
  };

  const handleResetDemoFixtures = () => {
    controllerRef.current = new MissionControlDataController();
    setCapabilitiesReadOnlySimulated(false);
    setStaleLiveSimulated(false);
    setDemoSnapshot(controllerRef.current.getSnapshot());
    setMode('demo');
    setFeedbackBanner({
      id: `reset-${Date.now()}`,
      tone: 'success',
      message: 'Synthetic fixtures reset to baseline state.',
    });
  };

  const selectedEvaluatedProject = useMemo(
    () =>
      allEvaluatedProjects.find((ep) => ep.project.projectId === selectedProjectId) ?? null,
    [allEvaluatedProjects, selectedProjectId]
  );

  const openDecisionsCount = useMemo(() => {
    if (!activeSnapshot) return 0;
    return activeSnapshot.decisions.filter((d) => d.status === 'open').length;
  }, [activeSnapshot]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* 1. Persistent Truthfulness Mode Banner (DEMO DATA vs NOT CONNECTED vs STALE LIVE) */}
      {mode === 'demo' && (
        <div
          role="region"
          aria-label="Demo Data Mode Notice"
          className="bg-slate-900 text-slate-100 px-4 sm:px-8 py-2.5 text-xs border-b border-slate-800"
        >
          <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Database className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="font-mono font-semibold tracking-wide text-amber-300">
                DEMO DATA — SYNTHETIC FIXTURES
              </span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="text-slate-300">
                No access to your Macs, local repos, or MD workers from AI Studio. Showing
                contract-compliant synthetic fixtures ({controllerRef.current.getDroppedDuplicatesCount()}{' '}
                duplicate event automatically deduplicated).
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setStaleLiveSimulated(false);
                  setLiveSnapshot(null);
                  setLiveConnectionHealth('not_connected');
                  setMode('live');
                  void performLivePoll();
                }}
                className="font-medium text-amber-300 hover:text-white underline underline-offset-4 whitespace-nowrap cursor-pointer"
              >
                Switch to Live Adapter Mode
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === 'live' && effectiveConnectionHealth === 'not_connected' && (
        <div
          role="region"
          aria-label="Live Adapter Not Connected"
          className="bg-red-950 text-red-100 px-4 sm:px-8 py-2.5 text-xs border-b border-red-900"
        >
          <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <WifiOff className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <span className="font-mono font-semibold text-red-300">
                LIVE MODE — NOT CONNECTED
              </span>
              <span aria-hidden="true" className="text-red-700">
                ·
              </span>
              <span>
                Endpoint <code className="font-mono">{liveConfig.endpointBaseUrl}</code> is
                unreachable. Demo data is never silently substituted for a failed live feed.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMode('demo')}
              className="font-medium text-red-200 hover:text-white underline underline-offset-4 whitespace-nowrap cursor-pointer"
            >
              Return to Demo Fixtures
            </button>
          </div>
        </div>
      )}

      {mode === 'live' && effectiveConnectionHealth === 'degraded_stale' && (
        <div
          role="region"
          aria-label="Stale Live Data Warning"
          className="bg-amber-950 text-amber-100 px-4 sm:px-8 py-2.5 text-xs border-b border-amber-900"
        >
          <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="font-mono font-semibold text-amber-300">
                STALE DATA — LIVE FEED DISCONNECTED
              </span>
              <span aria-hidden="true" className="text-amber-700">
                ·
              </span>
              <span>
                Preserving last-known snapshot from{' '}
                <strong className="font-mono tabular-nums">
                  {formatUtcShort(liveLastSyncedAt)}
                </strong>
                . Operator writes are disabled until connection recovers.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAdapterModalOpen(true)}
              className="font-medium text-amber-200 hover:text-white underline underline-offset-4 whitespace-nowrap cursor-pointer"
            >
              Inspect Connection Error
            </button>
          </div>
        </div>
      )}

      {/* 2. Top Bar Contract: 3 Zones separated by gap-8 */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-8 py-4">
        <div className="max-w-[1400px] mx-auto flex items-center justify-between gap-8">
          {/* Zone 1: Single text element Brand wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveNav('command_center');
            }}
            className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            dot · Mission Control
          </a>

          {/* Zone 2: 5 concise single-line text navigation links */}
          <nav
            aria-label="Primary Navigation"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600"
          >
            <button
              type="button"
              onClick={() => setActiveNav('command_center')}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
                activeNav === 'command_center'
                  ? 'text-slate-900 border-b-2 border-slate-900 font-semibold'
                  : ''
              }`}
            >
              Command Center
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('attention_queue')}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
                activeNav === 'attention_queue'
                  ? 'text-slate-900 border-b-2 border-slate-900 font-semibold'
                  : ''
              }`}
            >
              Attention Queue ({openDecisionsCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('workers_runs')}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
                activeNav === 'workers_runs'
                  ? 'text-slate-900 border-b-2 border-slate-900 font-semibold'
                  : ''
              }`}
            >
              Workers & Runs
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('contract_tests')}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
                activeNav === 'contract_tests'
                  ? 'text-slate-900 border-b-2 border-slate-900 font-semibold'
                  : ''
              }`}
            >
              Contract & Tests
            </button>
            <button
              type="button"
              onClick={() => setActiveNav('archived')}
              className={`hover:text-slate-900 transition-colors whitespace-nowrap shrink-0 cursor-pointer pb-0.5 ${
                activeNav === 'archived'
                  ? 'text-slate-900 border-b-2 border-slate-900 font-semibold'
                  : ''
              }`}
            >
              Archived ({archivedProjects.length})
            </button>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={() => setAdapterModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Configure Adapter</span>
            </button>
          </div>
        </div>

        {/* Mobile Navigation Bar */}
        <div className="flex md:hidden items-center gap-2 overflow-x-auto pt-3 mt-3 border-t border-slate-100 text-xs">
          {(
            [
              ['command_center', 'Command Center'],
              ['attention_queue', `Attention (${openDecisionsCount})`],
              ['workers_runs', 'Workers & Runs'],
              ['contract_tests', 'Contract & Tests'],
              ['archived', `Archived (${archivedProjects.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveNav(key)}
              className={`px-3 py-1.5 rounded-md font-medium whitespace-nowrap shrink-0 ${
                activeNav === key
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Main Content Container */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-8 py-8">
        {/* Operator Command Feedback / Undo Toast */}
        {feedbackBanner && (
          <div
            role="status"
            className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-lg border mb-6 text-xs ${
              feedbackBanner.tone === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                : feedbackBanner.tone === 'danger'
                ? 'bg-red-50 border-red-200 text-red-950'
                : 'bg-amber-50 border-amber-200 text-amber-950'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedbackBanner.tone === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 text-red-700 shrink-0" />
              )}
              <span className="font-medium">{feedbackBanner.message}</span>
            </div>
            <div className="flex items-center gap-3">
              {feedbackBanner.undoProjectId !== undefined &&
                feedbackBanner.undoTargetArchiveState !== undefined && (
                  <button
                    type="button"
                    onClick={() =>
                      handleToggleArchive(
                        feedbackBanner.undoProjectId!,
                        feedbackBanner.undoTargetArchiveState!
                      )
                    }
                    className="inline-flex items-center gap-1 font-semibold underline underline-offset-4 hover:text-slate-900 cursor-pointer"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span>Undo</span>
                  </button>
                )}
              <button
                type="button"
                onClick={() => setFeedbackBanner(null)}
                className="text-slate-500 hover:text-slate-900 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* LIVE MODE: NOT CONNECTED EMPTY STATE (No silent demo fallback!) */}
        {mode === 'live' && !activeSnapshot ? (
          <section className="bg-white border border-slate-300 rounded-xl p-10 text-center max-w-2xl mx-auto my-8">
            <WifiOff className="w-10 h-10 text-red-700 mx-auto mb-3" />
            <h1 className="text-xl font-bold text-slate-900 mb-2">
              NOT CONNECTED TO LOCAL MISSION CONTROL
            </h1>
            <p className="text-sm text-slate-600 mb-4">
              Live Mode is active, and no snapshot has been received from{' '}
              <code className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded">
                {liveConfig.endpointBaseUrl}/snapshot
              </code>
              . By contract, this dashboard never silently substitutes synthetic demo data when a
              live feed fails or is disconnected.
            </p>
            {liveError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs font-mono text-red-800 mb-6 text-left">
                Last connection error: {liveError} (Failed polls: {consecutiveFailures})
              </div>
            )}
            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => void performLivePoll()}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Live Connection</span>
              </button>
              <button
                type="button"
                onClick={() => setAdapterModalOpen(true)}
                className="px-4 py-2 text-xs font-medium text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 cursor-pointer"
              >
                Configure Endpoint / Simulate Stale Snapshot
              </button>
              <button
                type="button"
                onClick={() => setMode('demo')}
                className="px-4 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
              >
                Switch to Explicit Demo Mode
              </button>
            </div>
          </section>
        ) : activeSnapshot ? (
          <>
            {/* VIEW: CONTRACT & AUTOMATED TESTS */}
            {activeNav === 'contract_tests' && <ContractAndTestsView />}

            {/* VIEW: WORKERS & RUNS */}
            {activeNav === 'workers_runs' && (
              <WorkersAndRunsView
                snapshot={activeSnapshot}
                referenceNowIso={referenceNowIso}
                onSelectProject={(id) => setSelectedProjectId(id)}
              />
            )}

            {/* VIEW: ATTENTION QUEUE ONLY */}
            {activeNav === 'attention_queue' && (
              <AttentionPanel
                decisions={activeSnapshot.decisions}
                projects={activeSnapshot.projects}
                referenceNowIso={referenceNowIso}
                capabilities={effectiveCapabilities}
                onSelectProject={(id) => setSelectedProjectId(id)}
                onResolveDecision={handleResolveDecision}
                onSendReminder={handleSendReminder}
              />
            )}

            {/* VIEW: COMMAND CENTER OR ARCHIVED */}
            {(activeNav === 'command_center' || activeNav === 'archived') && (
              <>
                {/* Overview 5-Bucket KPI Strip (Only on main Command Center) */}
                {activeNav === 'command_center' && (
                  <section aria-label="Execution & Completion Overview" className="mb-8">
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 mb-4">
                      <div>
                        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                          Execution, Blockers & Verification Overview
                        </h1>
                        <p className="text-xs text-slate-600 mt-0.5">
                          Separating active execution (fresh heartbeat + progress) from blocked
                          work, pending operator decisions, unfinished scope, and verified
                          completion.
                        </p>
                      </div>
                      <div className="text-xs font-mono text-slate-500 tabular-nums">
                        Snapshot: {activeSnapshot.snapshotId} · Schema:{' '}
                        {activeSnapshot.schemaVersion}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3.5">
                      {(
                        [
                          {
                            id: 'working_now',
                            label: 'Working Now',
                            count: bucketCounts.working_now,
                            desc: 'Fresh heartbeat + fresh progress',
                            accent: 'text-emerald-800',
                          },
                          {
                            id: 'blocked',
                            label: 'Blocked',
                            count: bucketCounts.blocked,
                            desc: 'Crash, gate failure, stall, or blocker',
                            accent: 'text-red-700',
                          },
                          {
                            id: 'waiting_for_me',
                            label: 'Waiting for Me',
                            count: bucketCounts.waiting_for_me,
                            desc: 'Open decision owned by you',
                            accent: 'text-amber-800',
                          },
                          {
                            id: 'unfinished',
                            label: 'Unfinished',
                            count: bucketCounts.unfinished,
                            desc: 'Remaining milestones or unverified',
                            accent: 'text-slate-900',
                          },
                          {
                            id: 'recently_verified_complete',
                            label: 'Verified Complete',
                            count: bucketCounts.recently_verified_complete,
                            desc: 'All required acceptance gates passed',
                            accent: 'text-emerald-800',
                          },
                        ] as const
                      ).map((card) => {
                        const isSelected = selectedBucket === card.id;
                        return (
                          <button
                            key={card.id}
                            type="button"
                            onClick={() =>
                              setSelectedBucket((prev) =>
                                prev === card.id ? 'all' : card.id
                              )
                            }
                            className={`text-left p-4 rounded-xl border transition-colors cursor-pointer ${
                              isSelected
                                ? 'bg-slate-900 text-white border-slate-900'
                                : 'bg-white text-slate-900 border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div
                              className={`text-xs font-medium mb-1 ${
                                isSelected ? 'text-slate-300' : 'text-slate-500'
                              }`}
                            >
                              {card.label}
                            </div>
                            <div
                              className={`text-3xl font-bold font-mono tabular-nums ${
                                isSelected ? 'text-white' : card.accent
                              }`}
                            >
                              {card.count}
                            </div>
                            <div
                              className={`text-[11px] mt-1.5 leading-snug ${
                                isSelected ? 'text-slate-300' : 'text-slate-500'
                              }`}
                            >
                              {card.desc}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* Prominent Attention Panel on Command Center */}
                {activeNav === 'command_center' && (
                  <AttentionPanel
                    decisions={activeSnapshot.decisions}
                    projects={activeSnapshot.projects}
                    referenceNowIso={referenceNowIso}
                    capabilities={effectiveCapabilities}
                    onSelectProject={(id) => setSelectedProjectId(id)}
                    onResolveDecision={handleResolveDecision}
                    onSendReminder={handleSendReminder}
                  />
                )}

                {/* Search, Bucket Filter & Discoverability Toolbar */}
                <section aria-label="Project Filter Controls" className="mb-6">
                  <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    {/* Left: Segmented Bucket Filter or Archived Header */}
                    {activeNav === 'archived' ? (
                      <div className="flex items-center gap-2">
                        <Archive className="w-4 h-4 text-slate-600" />
                        <div>
                          <h2 className="text-sm font-semibold text-slate-900">
                            Archived Projects ({archivedProjects.length})
                          </h2>
                          <p className="text-xs text-slate-500">
                            Archiving hides projects from the main queue without deleting files or
                            cancelling jobs. Old unfinished work remains discoverable here.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
                        {(
                          [
                            ['all', `All Active (${activeUnarchivedProjects.length})`],
                            ['working_now', `Working Now (${bucketCounts.working_now})`],
                            ['blocked', `Blocked (${bucketCounts.blocked})`],
                            ['waiting_for_me', `Waiting for Me (${bucketCounts.waiting_for_me})`],
                            ['unfinished', `Unfinished (${bucketCounts.unfinished})`],
                            [
                              'recently_verified_complete',
                              `Verified (${bucketCounts.recently_verified_complete})`,
                            ],
                          ] as const
                        ).map(([bKey, bLabel]) => (
                          <button
                            key={bKey}
                            type="button"
                            onClick={() => setSelectedBucket(bKey)}
                            className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                              selectedBucket === bKey
                                ? 'bg-white text-slate-900 shadow-xs'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {bLabel}
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Right: Search + Owner & Priority Filters */}
                    <div className="flex flex-wrap items-center gap-2.5">
                      <div className="relative flex-1 sm:w-64">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="search"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Search projects, milestones, blockers..."
                          aria-label="Search projects"
                          className="w-full text-xs bg-slate-50 border border-slate-300 rounded-md pl-8 pr-3 py-1.5 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-900"
                        />
                      </div>

                      <select
                        aria-label="Filter by owner"
                        value={ownerFilter}
                        onChange={(e) => setOwnerFilter(e.target.value)}
                        className="text-xs bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-700"
                      >
                        <option value="all">All Owners</option>
                        {uniqueOwners.map((o) => (
                          <option key={o} value={o}>
                            Owner: {o}
                          </option>
                        ))}
                      </select>

                      <select
                        aria-label="Filter by priority"
                        value={priorityFilter}
                        onChange={(e) => setPriorityFilter(e.target.value)}
                        className="text-xs bg-slate-50 border border-slate-300 rounded-md px-2.5 py-1.5 text-slate-700"
                      >
                        <option value="all">All Priorities</option>
                        <option value="critical">Critical</option>
                        <option value="high">High</option>
                        <option value="normal">Normal</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                  </div>
                </section>

                {/* Project Cards List */}
                {filteredProjects.length === 0 ? (
                  <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
                    <p className="text-sm font-semibold text-slate-900 mb-1">
                      No projects match the current filter
                    </p>
                    <p className="text-xs text-slate-500 mb-4">
                      Try clearing your search query or switching the overview filter.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedBucket('all');
                        setOwnerFilter('all');
                        setPriorityFilter('all');
                        setSearchQuery('');
                      }}
                      className="px-3.5 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer"
                    >
                      Reset Filters
                    </button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    {filteredProjects.map((ep) => (
                      <ProjectCard
                        key={ep.project.projectId}
                        evaluated={ep}
                        referenceNowIso={referenceNowIso}
                        capabilities={effectiveCapabilities}
                        onSelectProject={(id) => setSelectedProjectId(id)}
                        onChangePriority={handleChangePriority}
                        onToggleArchive={handleToggleArchive}
                        onSendReminder={handleSendReminder}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        ) : null}
      </main>

      {/* Quiet Footer (No fake telemetry tickers) */}
      <footer className="bg-white border-t border-slate-200 px-4 sm:px-8 py-4 mt-12 text-xs text-slate-500">
        <div className="max-w-[1400px] mx-auto flex flex-wrap items-center justify-between gap-4">
          <div>
            <span>dot Mission Control UI · Contract Schema </span>
            <code className="font-mono text-slate-700">{CONTRACT_SCHEMA_VERSION}</code>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveNav('contract_tests')}
              className="hover:text-slate-900 underline-offset-4 hover:underline cursor-pointer"
            >
              Integration Contract & 11 Automated Tests
            </button>
            <button
              type="button"
              onClick={() => setAdapterModalOpen(true)}
              className="hover:text-slate-900 underline-offset-4 hover:underline cursor-pointer"
            >
              Adapter Settings
            </button>
          </div>
        </div>
      </footer>

      {/* Project Detail Modal */}
      {selectedEvaluatedProject && activeSnapshot && (
        <ProjectDetailModal
          evaluated={selectedEvaluatedProject}
          tasks={activeSnapshot.tasks.filter(
            (t) => t.projectId === selectedEvaluatedProject.project.projectId
          )}
          runs={activeSnapshot.runs.filter(
            (r) => r.projectId === selectedEvaluatedProject.project.projectId
          )}
          evidence={activeSnapshot.evidence.filter(
            (ev) => ev.projectId === selectedEvaluatedProject.project.projectId
          )}
          events={activeSnapshot.events.filter(
            (e) => e.projectId === selectedEvaluatedProject.project.projectId
          )}
          referenceNowIso={referenceNowIso}
          capabilities={effectiveCapabilities}
          onClose={() => setSelectedProjectId(null)}
          onChangePriority={handleChangePriority}
          onToggleArchive={handleToggleArchive}
          onAddNote={handleAddNote}
          onSendReminder={handleSendReminder}
          onResolveDecision={handleResolveDecision}
        />
      )}

      {/* Adapter Configuration & Diagnostic Simulation Modal */}
      {adapterModalOpen && (
        <AdapterConfigModal
          mode={mode}
          liveConfig={liveConfig}
          capabilitiesReadOnlySimulated={capabilitiesReadOnlySimulated}
          staleLiveSimulated={staleLiveSimulated}
          onClose={() => setAdapterModalOpen(false)}
          onSwitchMode={(nextMode) => {
            setStaleLiveSimulated(false);
            if (nextMode === 'live') {
              setLiveSnapshot(null);
              setLiveConnectionHealth('not_connected');
              setMode('live');
              void performLivePoll();
            } else {
              setMode('demo');
            }
          }}
          onUpdateLiveConfig={(cfg) => setLiveConfig(cfg)}
          onTriggerLivePollNow={() => {
            setStaleLiveSimulated(false);
            setMode('live');
            void performLivePoll();
          }}
          onToggleCapabilitiesReadOnly={handleToggleCapabilitiesReadOnly}
          onToggleSimulateStaleLive={handleToggleSimulateStaleLive}
          onResetDemoFixtures={handleResetDemoFixtures}
        />
      )}
    </div>
  );
}
