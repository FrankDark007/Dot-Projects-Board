/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  Database,
  FileCode2,
  LayoutGrid,
  List,
  Menu,
  Moon,
  RefreshCw,
  Search,
  ShieldAlert,
  Sliders,
  Sun,
  Undo2,
  Wifi,
  WifiOff,
  X,
  XCircle,
} from 'lucide-react';
import {
  DashboardMode,
  DEFAULT_LIVE_CONFIG,
  evaluateSnapshotDataFreshness,
  executeLiveCommand,
  FetchLike,
  isCommandCapabilitySupported,
  LiveAdapterConfig,
  LivePollCoordinator,
  MissionControlDataController,
} from './adapters/dataAdapter';
import { AdapterConfigModal } from './components/AdapterConfigModal';
import { AttentionPanel } from './components/AttentionPanel';
import { ContractAndTestsView } from './components/ContractAndTestsView';
import { ProjectCard } from './components/ProjectCard';
import { ProjectDetailModal } from './components/ProjectDetailModal';
import { ProjectRow } from './components/ProjectRow';
import { TodayView } from './components/TodayView';
import { WorkersAndRunsView } from './components/WorkersAndRunsView';
import { evaluateAllProjects, ProjectOverviewBucket } from './engine/stateEvaluator';
import { REFERENCE_NOW_ISO } from './fixtures/syntheticFixtures';
import {
  BackendCapabilities,
  ConnectionHealthState,
  CONTRACT_SCHEMA_VERSION,
  MissionControlSnapshot,
  OperatorCommandRequest,
  PriorityLevel,
} from './schema/contract';
import { formatRelativeAge, formatUtcShort } from './utils/timeFormat';

type NavSection =
  | 'board_overview'
  | 'today_focus'
  | 'attention_queue'
  | 'workers_runs'
  | 'archived'
  | 'contract_tests';

type ProjectDisplayLayout = 'rows' | 'cards';

interface ActionFeedbackBanner {
  id: string;
  tone: 'success' | 'warning' | 'danger';
  message: string;
  undoProjectId?: string;
  undoTargetArchiveState?: boolean;
}

export interface AppProps {
  initialMode?: DashboardMode;
  initialLiveConfig?: LiveAdapterConfig;
  liveFetchImpl?: FetchLike;
  getNowIso?: () => string;
}

export default function App({
  initialMode = 'demo',
  initialLiveConfig = DEFAULT_LIVE_CONFIG,
  liveFetchImpl,
  getNowIso,
}: AppProps) {
  // Demo controller is strictly isolated to Demo Mode
  const demoControllerRef = useRef<MissionControlDataController>(
    new MissionControlDataController()
  );

  // Live poll coordinator prevents overlapping requests and ignores late responses from old modes/endpoints
  const liveCoordinatorRef = useRef<LivePollCoordinator>(new LivePollCoordinator());

  // Monotonic connection generation token shared by both live polls and live commands.
  // Incremented on unmount, mode switch, or endpoint configuration update.
  const connectionGenRef = useRef<number>(0);
  const inFlightCommandsAbortRef = useRef<Set<AbortController>>(new Set());
  const scheduledPollTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(
    null
  );
  const unmountedRef = useRef<boolean>(false);

  const getNowFn = useCallback(
    () => (getNowIso ? getNowIso() : new Date().toISOString()),
    [getNowIso]
  );
  const getNowFnRef = useRef(getNowFn);
  getNowFnRef.current = getNowFn;

  const liveFetchImplRef = useRef<FetchLike | undefined>(liveFetchImpl);
  liveFetchImplRef.current = liveFetchImpl;

  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mode, setMode] = useState<DashboardMode>(initialMode);
  const modeRef = useRef<DashboardMode>(initialMode);
  modeRef.current = mode;

  const [liveConfig, setLiveConfig] = useState<LiveAdapterConfig>(initialLiveConfig);
  const liveConfigRef = useRef<LiveAdapterConfig>(initialLiveConfig);
  liveConfigRef.current = liveConfig;

  // Demo state
  const [demoSnapshot, setDemoSnapshot] = useState<MissionControlSnapshot>(() =>
    demoControllerRef.current.getSnapshot()
  );
  const [demoClockOffsetSeconds, setDemoClockOffsetSeconds] = useState<number>(0);
  const [capabilitiesReadOnlySimulated, setCapabilitiesReadOnlySimulated] =
    useState<boolean>(false);

  // Live state (strictly separate from Demo state; never receives synthetic fixtures)
  const [liveSnapshot, setLiveSnapshot] = useState<MissionControlSnapshot | null>(null);
  const [liveConnectionHealth, setLiveConnectionHealth] =
    useState<ConnectionHealthState>('never_connected');
  const [liveWarningOrError, setLiveWarningOrError] = useState<string | null>(null);
  // Transport contact timestamp is tracked strictly separately from snapshot.generatedAt
  const [liveLastContactAt, setLiveLastContactAt] = useState<string | null>(null);
  const [consecutiveFailures, setConsecutiveFailures] = useState<number>(0);
  const consecutiveFailuresRef = useRef<number>(0);
  const [isPollingLive, setIsPollingLive] = useState<boolean>(false);
  const [isBackgroundTab, setIsBackgroundTab] = useState<boolean>(false);
  const isBackgroundTabRef = useRef<boolean>(false);

  // Real advancing clock for Live Mode (updates every 1000ms so heartbeat expiry and stale data warnings update without a new snapshot)
  const [liveNowIso, setLiveNowIso] = useState<string>(() => getNowFn());

  // Navigation, layout & filter state
  const [activeNav, setActiveNav] = useState<NavSection>('board_overview');
  const [displayLayout, setDisplayLayout] = useState<ProjectDisplayLayout>('rows');
  const [selectedBucket, setSelectedBucket] = useState<'all' | ProjectOverviewBucket>('all');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [adapterModalOpen, setAdapterModalOpen] = useState<boolean>(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState<boolean>(false);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState<boolean>(false);
  const [feedbackBanner, setFeedbackBanner] = useState<ActionFeedbackBanner | null>(null);

  // Sync dark mode class on documentElement
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [theme]);

  // Advancing real-time clock in Live Mode with proper timer cleanup
  useEffect(() => {
    if (mode !== 'live') return;
    setLiveNowIso(getNowFnRef.current());
    const intervalId = globalThis.setInterval(() => {
      setLiveNowIso(getNowFnRef.current());
    }, 1000);
    return () => {
      globalThis.clearInterval(intervalId);
    };
  }, [mode]);

  // Compute current evaluation reference timestamp:
  // - In Demo Mode: deterministic REFERENCE_NOW_ISO + demoClockOffsetSeconds
  // - In Live Mode: advancing real-time clock `liveNowIso`
  const referenceNowIso = useMemo(() => {
    if (mode === 'demo') {
      return new Date(
        Date.parse(REFERENCE_NOW_ISO) + demoClockOffsetSeconds * 1000
      ).toISOString();
    }
    return liveNowIso;
  }, [mode, demoClockOffsetSeconds, liveNowIso]);

  const clearScheduledPollTimer = useCallback(() => {
    if (scheduledPollTimerRef.current !== null) {
      globalThis.clearTimeout(scheduledPollTimerRef.current);
      scheduledPollTimerRef.current = null;
    }
  }, []);

  const abortAllInFlightCommands = useCallback(() => {
    for (const ctrl of inFlightCommandsAbortRef.current) {
      ctrl.abort();
    }
    inFlightCommandsAbortRef.current.clear();
  }, []);

  // Forward reference for mutually recursive single-flight poll loop
  const runLivePollCycleRef = useRef<
    (cfg: LiveAdapterConfig, gen: number) => Promise<void>
  >(async () => {});

  const scheduleNextLivePoll = useCallback(
    (gen: number, cfg: LiveAdapterConfig, failuresCount: number) => {
      clearScheduledPollTimer();
      if (
        unmountedRef.current ||
        modeRef.current !== 'live' ||
        gen !== connectionGenRef.current
      ) {
        return;
      }

      const backoffMultiplier = Math.pow(1.5, Math.min(failuresCount, 5));
      const tabMultiplier = isBackgroundTabRef.current ? cfg.backgroundTabMultiplier : 1;
      const delayMs = Math.min(
        cfg.maxBackoffMs * tabMultiplier,
        Math.round(cfg.basePollIntervalMs * backoffMultiplier * tabMultiplier)
      );

      scheduledPollTimerRef.current = globalThis.setTimeout(() => {
        scheduledPollTimerRef.current = null;
        if (
          !unmountedRef.current &&
          modeRef.current === 'live' &&
          gen === connectionGenRef.current
        ) {
          void runLivePollCycleRef.current(cfg, gen);
        }
      }, delayMs);
    },
    [clearScheduledPollTimer]
  );

  // Execute a single-flight poll cycle and always schedule the next cycle upon completion
  const runLivePollCycle = useCallback(
    async (cfg: LiveAdapterConfig, gen: number) => {
      if (
        unmountedRef.current ||
        modeRef.current !== 'live' ||
        gen !== connectionGenRef.current
      ) {
        return;
      }
      if (liveCoordinatorRef.current.isInFlight()) {
        return;
      }

      clearScheduledPollTimer();
      setIsPollingLive(true);
      const nowForValidation = getNowFnRef.current();
      setLiveNowIso(nowForValidation);

      const outcome = await liveCoordinatorRef.current.pollOnce(cfg, {
        referenceNowIso: nowForValidation,
        fetchImpl: liveFetchImplRef.current,
      });

      if (
        unmountedRef.current ||
        modeRef.current !== 'live' ||
        gen !== connectionGenRef.current
      ) {
        return;
      }

      setIsPollingLive(false);

      if (
        outcome.status === 'ignored_stale_generation' ||
        outcome.status === 'skipped_in_flight'
      ) {
        return;
      }

      setLiveSnapshot(outcome.snapshot);
      setLiveConnectionHealth(outcome.connectionHealth);
      setLiveWarningOrError(outcome.warningOrError);
      setLiveLastContactAt(outcome.lastSuccessfulContactAt);

      let nextFailures = consecutiveFailuresRef.current;
      if (outcome.status === 'updated') {
        nextFailures = 0;
        consecutiveFailuresRef.current = 0;
        setConsecutiveFailures(0);
      } else {
        nextFailures = consecutiveFailuresRef.current + 1;
        consecutiveFailuresRef.current = nextFailures;
        setConsecutiveFailures(nextFailures);
      }

      // Schedule next attempt in continuous single-flight loop
      scheduleNextLivePoll(gen, cfg, nextFailures);
    },
    [clearScheduledPollTimer, scheduleNextLivePoll]
  );

  runLivePollCycleRef.current = runLivePollCycle;

  // Manual trigger using the active configuration and current connection generation
  const performLivePoll = useCallback(async () => {
    await runLivePollCycleRef.current(liveConfigRef.current, connectionGenRef.current);
  }, []);

  // Track background tab visibility for bounded polling throttling
  useEffect(() => {
    const onVisibilityChange = () => {
      const hidden = document.visibilityState === 'hidden';
      isBackgroundTabRef.current = hidden;
      setIsBackgroundTab(hidden);
      if (
        !unmountedRef.current &&
        modeRef.current === 'live' &&
        !liveCoordinatorRef.current.isInFlight()
      ) {
        scheduleNextLivePoll(
          connectionGenRef.current,
          liveConfigRef.current,
          consecutiveFailuresRef.current
        );
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [scheduleNextLivePoll]);

  // Start initial poll if mounted in Live Mode, and clean up all timers & in-flight requests on unmount
  useEffect(() => {
    unmountedRef.current = false;
    if (modeRef.current === 'live') {
      void runLivePollCycleRef.current(liveConfigRef.current, connectionGenRef.current);
    }
    return () => {
      unmountedRef.current = true;
      connectionGenRef.current += 1;
      clearScheduledPollTimer();
      liveCoordinatorRef.current.invalidateAndReset(true);
      abortAllInFlightCommands();
    };
  }, [clearScheduledPollTimer, abortAllInFlightCommands]);

  // Complete endpoint/connection reset helper: clears endpoint-bound data, permissions, health, and feedback
  const resetLiveEndpointStateAndInvalidate = useCallback((): number => {
    connectionGenRef.current += 1;
    const nextGen = connectionGenRef.current;
    clearScheduledPollTimer();
    liveCoordinatorRef.current.invalidateAndReset(true);
    abortAllInFlightCommands();

    setIsPollingLive(false);
    setLiveSnapshot(null);
    setLiveConnectionHealth('never_connected');
    setLiveWarningOrError(null);
    setLiveLastContactAt(null);
    consecutiveFailuresRef.current = 0;
    setConsecutiveFailures(0);
    setSelectedProjectId(null);
    setFeedbackBanner(null);

    return nextGen;
  }, [clearScheduledPollTimer, abortAllInFlightCommands]);

  // Switch between Demo and Live modes cleanly (clearing incompatible selections & cancelling in-flight reads/writes)
  const handleSwitchMode = useCallback(
    (nextMode: DashboardMode) => {
      const nextGen = resetLiveEndpointStateAndInvalidate();
      modeRef.current = nextMode;
      setMode(nextMode);

      if (nextMode === 'live') {
        setLiveNowIso(getNowFnRef.current());
        void runLivePollCycleRef.current(liveConfigRef.current, nextGen);
      }
    },
    [resetLiveEndpointStateAndInvalidate]
  );

  // Isolate endpoint/config changes completely: clear old snapshot, permissions, health, and feedback,
  // invalidate pending reads & writes, and start polling with the NEW configuration.
  const handleUpdateLiveConfig = useCallback(
    (nextConfig: LiveAdapterConfig) => {
      const nextGen = resetLiveEndpointStateAndInvalidate();
      liveConfigRef.current = nextConfig;
      setLiveConfig(nextConfig);

      if (modeRef.current === 'live') {
        setLiveNowIso(getNowFnRef.current());
        void runLivePollCycleRef.current(nextConfig, nextGen);
      }
    },
    [resetLiveEndpointStateAndInvalidate]
  );

  // Separate transport reachability (`liveLastContactAt`) from snapshot data freshness (`liveSnapshot.generatedAt`)
  const liveDataFreshness = useMemo(() => {
    if (mode !== 'live' || !liveSnapshot) return null;
    return evaluateSnapshotDataFreshness(liveSnapshot, referenceNowIso, liveConfig);
  }, [mode, liveSnapshot, referenceNowIso, liveConfig]);

  // Determine effective connection health:
  // Repeated HTTP 200 responses serving an old snapshot (`!liveDataFreshness.isDataFresh`) evaluate as `'stale'`!
  const effectiveConnectionHealth: ConnectionHealthState = useMemo(() => {
    if (mode === 'demo') return 'demo_synthetic';
    if (!liveSnapshot || liveConnectionHealth === 'never_connected') {
      return 'never_connected';
    }
    if (liveConnectionHealth === 'disconnected') {
      return 'disconnected';
    }
    if (liveConnectionHealth === 'stale') {
      return 'stale';
    }
    if (liveDataFreshness && !liveDataFreshness.isDataFresh) {
      return 'stale';
    }
    return 'connected';
  }, [mode, liveConnectionHealth, liveSnapshot, liveDataFreshness]);

  const effectiveLiveWarning = useMemo(() => {
    if (liveWarningOrError) return liveWarningOrError;
    if (liveDataFreshness && !liveDataFreshness.isDataFresh) {
      return liveDataFreshness.reason;
    }
    return null;
  }, [liveWarningOrError, liveDataFreshness]);

  const activeSnapshot: MissionControlSnapshot | null =
    mode === 'demo' ? demoSnapshot : liveSnapshot;

  // Evaluate all projects against `referenceNowIso`
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

  // Compute bucket counts across non-archived projects
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

  const uniqueOwners = useMemo(() => {
    if (!activeSnapshot) return [];
    return Array.from(new Set(activeSnapshot.projects.map((p) => p.owner)));
  }, [activeSnapshot]);

  // Filter projects for current view
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

  // Group filtered projects into clear operational hierarchy for the Board Overview:
  // 1) Attention / Blocked Needed First
  // 2) Current Work (Confirmed Running) Second
  // 3) Unfinished Backlog & Verified Complete Third
  const hierarchySections = useMemo(() => {
    const attentionOrBlocked = filteredProjects.filter(
      (ep) => ep.buckets.includes('waiting_for_me') || ep.buckets.includes('blocked')
    );
    const attentionIds = new Set(attentionOrBlocked.map((ep) => ep.project.projectId));

    const currentWork = filteredProjects.filter(
      (ep) =>
        !attentionIds.has(ep.project.projectId) && ep.buckets.includes('working_now')
    );
    const currentWorkIds = new Set(currentWork.map((ep) => ep.project.projectId));

    const backlogAndCompleted = filteredProjects.filter(
      (ep) =>
        !attentionIds.has(ep.project.projectId) &&
        !currentWorkIds.has(ep.project.projectId)
    );

    return {
      attentionOrBlocked,
      currentWork,
      backlogAndCompleted,
    };
  }, [filteredProjects]);

  // Effective capabilities:
  // In Live Mode, controls are strictly read-only unless `effectiveConnectionHealth === 'connected'`,
  // `liveConfig.enableLiveCommandRoute === true`, AND `activeSnapshot.capabilities.commandEndpointVerified === true`.
  const effectiveCapabilities: BackendCapabilities = useMemo(() => {
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

    if (mode === 'live') {
      if (effectiveConnectionHealth !== 'connected') {
        return {
          canArchive: false,
          canChangePriority: false,
          canAddNote: false,
          canSendReminder: false,
          canResolveDecision: false,
          reasonIfDisabled:
            'Live feed is stale or disconnected. Reconnect to fresh data before issuing operator commands.',
        };
      }
      if (
        !liveConfig.enableLiveCommandRoute ||
        !activeSnapshot.capabilities.commandEndpointVerified
      ) {
        return {
          canArchive: false,
          canChangePriority: false,
          canAddNote: false,
          canSendReminder: false,
          canResolveDecision: false,
          reasonIfDisabled:
            'Live Mode is read-only until a verified backend command endpoint (/commands) is configured in local Mission Control.',
        };
      }
    }

    return activeSnapshot.capabilities;
  }, [activeSnapshot, mode, effectiveConnectionHealth, liveConfig.enableLiveCommandRoute]);

  // Unified Command Dispatcher:
  // - Rechecks specific capability and connection health at dispatch time
  // - Cancels & ignores command responses from obsolete connections or modes
  const dispatchOperatorCommand = useCallback(
    async (
      req: OperatorCommandRequest,
      onDemoSuccessMessage: (newRev?: number) => {
        message: string;
        undoProjectId?: string;
        undoTargetArchiveState?: boolean;
      }
    ) => {
      if (modeRef.current === 'live') {
        const dispatchGen = connectionGenRef.current;
        const dispatchCfg = liveConfigRef.current;
        const rawSnapshotCaps = liveSnapshot?.capabilities ?? null;

        // Recheck current connection health & specific capability at dispatch
        if (effectiveConnectionHealth !== 'connected') {
          setFeedbackBanner({
            id: req.idempotencyKey,
            tone: 'danger',
            message: `Cannot dispatch "${req.command.type}" while live connection is "${effectiveConnectionHealth}".`,
          });
          return;
        }

        if (
          !dispatchCfg.enableLiveCommandRoute ||
          !rawSnapshotCaps?.commandEndpointVerified
        ) {
          setFeedbackBanner({
            id: req.idempotencyKey,
            tone: 'danger',
            message:
              'Live mode is read-only until a verified backend command route (/commands) is configured and advertised.',
          });
          return;
        }

        if (!isCommandCapabilitySupported(req.command.type, rawSnapshotCaps)) {
          setFeedbackBanner({
            id: req.idempotencyKey,
            tone: 'danger',
            message:
              rawSnapshotCaps.reasonIfDisabled ||
              `Backend does not permit "${req.command.type}" on this connection.`,
          });
          return;
        }

        const cmdAbort = new AbortController();
        inFlightCommandsAbortRef.current.add(cmdAbort);

        const liveRes = await executeLiveCommand(
          dispatchCfg,
          rawSnapshotCaps,
          req,
          {
            connectionHealth: effectiveConnectionHealth,
            signal: cmdAbort.signal,
            fetchImpl: liveFetchImplRef.current,
          }
        );

        inFlightCommandsAbortRef.current.delete(cmdAbort);

        // Ignore responses from obsolete connections or modes
        if (
          unmountedRef.current ||
          modeRef.current !== 'live' ||
          dispatchGen !== connectionGenRef.current ||
          cmdAbort.signal.aborted
        ) {
          return;
        }

        if (liveRes.ok) {
          if (liveRes.deliveryAck?.outcome === 'accepted_pending_delivery') {
            setFeedbackBanner({
              id: liveRes.idempotencyKey,
              tone: 'warning',
              message: `Command accepted by backend; downstream delivery to ${liveRes.deliveryAck.recipient} is still pending acknowledgment.`,
            });
          } else if (liveRes.deliveryAck?.outcome === 'delivered_acknowledged') {
            setFeedbackBanner({
              id: liveRes.idempotencyKey,
              tone: 'success',
              message: `Live reminder delivered and acknowledged by ${liveRes.deliveryAck.recipient} via ${liveRes.deliveryAck.channel} (Ack: ${liveRes.deliveryAck.ackId}).`,
            });
          } else {
            setFeedbackBanner({
              id: liveRes.idempotencyKey,
              tone: 'success',
              message: `Live command (${req.command.type}) acknowledged by backend${
                liveRes.newRevision ? ` (rev v${liveRes.newRevision})` : ''
              }. Refreshing snapshot...`,
            });
          }
          void runLivePollCycleRef.current(dispatchCfg, dispatchGen);
        } else {
          setFeedbackBanner({
            id: liveRes.idempotencyKey,
            tone: liveRes.errorCode === 'UNCERTAIN_WRITE_TIMEOUT' ? 'warning' : 'danger',
            message:
              liveRes.errorMessage ||
              'Live command rejected by backend. Demo controller was not invoked.',
          });
        }
        return;
      }

      // Demo Mode execution
      const res = demoControllerRef.current.executeCommand(req);
      setDemoSnapshot(demoControllerRef.current.getSnapshot());

      if (res.ok) {
        if (req.command.type === 'send_reminder') {
          if (res.deliveryAck?.outcome === 'delivered_acknowledged') {
            setFeedbackBanner({
              id: res.idempotencyKey,
              tone: 'success',
              message: `[Demo Simulation] Reminder acknowledged by ${res.deliveryAck.recipient} via ${res.deliveryAck.channel} (Ack: ${res.deliveryAck.ackId}).`,
            });
          } else {
            setFeedbackBanner({
              id: res.idempotencyKey,
              tone: 'warning',
              message: `[Demo Simulation] Command accepted, but delivery to ${req.command.targetOwner} is still pending acknowledgment.`,
            });
          }
          return;
        }

        const info = onDemoSuccessMessage(res.newRevision);
        setFeedbackBanner({
          id: res.idempotencyKey,
          tone: 'success',
          message: info.message,
          undoProjectId: info.undoProjectId,
          undoTargetArchiveState: info.undoTargetArchiveState,
        });
      } else {
        setFeedbackBanner({
          id: res.idempotencyKey,
          tone: res.errorCode === 'UNCERTAIN_WRITE_TIMEOUT' ? 'warning' : 'danger',
          message: res.errorMessage || 'Command failed.',
        });
      }
    },
    [liveSnapshot, effectiveConnectionHealth]
  );

  const handleToggleArchive = (projectId: string, archive: boolean) => {
    if (!activeSnapshot) return;
    const proj = activeSnapshot.projects.find((p) => p.projectId === projectId);
    if (!proj) return;

    void dispatchOperatorCommand(
      {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: `cmd-archive-${projectId}-r${proj.revision}-${archive ? '1' : '0'}`,
        expectedRevision: proj.revision,
        issuedAt: referenceNowIso,
        command: {
          type: 'archive_project',
          projectId,
          archive,
        },
      },
      () => ({
        message: archive
          ? `Archived "${proj.name}" in demo state (files & running workers untouched).`
          : `Restored "${proj.name}" from archive.`,
        undoProjectId: projectId,
        undoTargetArchiveState: !archive,
      })
    );
  };

  const handleChangePriority = (projectId: string, priority: PriorityLevel) => {
    if (!activeSnapshot) return;
    const proj = activeSnapshot.projects.find((p) => p.projectId === projectId);
    if (!proj) return;

    void dispatchOperatorCommand(
      {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: `cmd-prio-${projectId}-r${proj.revision}-${priority}`,
        expectedRevision: proj.revision,
        issuedAt: referenceNowIso,
        command: {
          type: 'set_priority',
          projectId,
          priority,
        },
      },
      (newRev) => ({
        message: `Updated "${proj.name}" priority to ${priority.toUpperCase()} (rev v${newRev}).`,
      })
    );
  };

  const handleAddNote = (projectId: string, body: string) => {
    if (!activeSnapshot) return;
    const proj = activeSnapshot.projects.find((p) => p.projectId === projectId);
    if (!proj) return;

    void dispatchOperatorCommand(
      {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: `cmd-note-${projectId}-r${proj.revision}-${Date.now()}`,
        expectedRevision: proj.revision,
        issuedAt: referenceNowIso,
        command: {
          type: 'add_note',
          projectId,
          body,
          author: 'you',
        },
      },
      () => ({
        message: `Added operator note to "${proj.name}".`,
      })
    );
  };

  const handleSendReminder = (
    projectId: string,
    targetOwner: string,
    message: string
  ) => {
    if (!activeSnapshot) return;
    const proj = activeSnapshot.projects.find((p) => p.projectId === projectId);
    if (!proj) return;

    void dispatchOperatorCommand(
      {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: `cmd-rem-${projectId}-r${proj.revision}-${Date.now()}`,
        expectedRevision: proj.revision,
        issuedAt: referenceNowIso,
        command: {
          type: 'send_reminder',
          projectId,
          targetOwner,
          message,
        },
      },
      () => ({
        message: `Reminder processed for ${targetOwner}.`,
      })
    );
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

    void dispatchOperatorCommand(
      {
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        idempotencyKey: `cmd-dec-${decisionId}-r${proj.revision}`,
        expectedRevision: proj.revision,
        issuedAt: referenceNowIso,
        command: {
          type: 'resolve_decision',
          projectId,
          decisionId,
          selectedOption,
          resolutionNote,
        },
      },
      (newRev) => ({
        message: `Recorded decision for ${decisionId} (rev v${newRev}).`,
      })
    );
  };

  const handleToggleCapabilitiesReadOnly = (disabled: boolean) => {
    if (mode !== 'demo') return;
    setCapabilitiesReadOnlySimulated(disabled);
    demoControllerRef.current.setCapabilities({
      canArchive: !disabled,
      canChangePriority: !disabled,
      canAddNote: !disabled,
      canSendReminder: !disabled,
      canResolveDecision: !disabled,
      reasonIfDisabled: disabled
        ? 'Simulated read-only observer mode in Demo (writes disabled by capability flag).'
        : undefined,
    });
    setDemoSnapshot(demoControllerRef.current.getSnapshot());
  };

  const handleResetDemoFixtures = () => {
    demoControllerRef.current = new MissionControlDataController();
    setCapabilitiesReadOnlySimulated(false);
    setDemoClockOffsetSeconds(0);
    setDemoSnapshot(demoControllerRef.current.getSnapshot());
    handleSwitchMode('demo');
    setFeedbackBanner({
      id: `reset-${Date.now()}`,
      tone: 'success',
      message: 'Synthetic demo fixtures and clock offset reset to baseline.',
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

  const renderProjectCollection = (projectsToRender: typeof filteredProjects) => {
    if (displayLayout === 'rows') {
      return (
        <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
          {projectsToRender.map((ep) => (
            <ProjectRow
              key={ep.project.projectId}
              evaluated={ep}
              referenceNowIso={referenceNowIso}
              capabilities={effectiveCapabilities}
              isSelected={selectedProjectId === ep.project.projectId}
              onSelectProject={(id) => setSelectedProjectId(id)}
              onChangePriority={handleChangePriority}
              onToggleArchive={handleToggleArchive}
              onSendReminder={handleSendReminder}
            />
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {projectsToRender.map((ep) => (
          <ProjectCard
            key={ep.project.projectId}
            evaluated={ep}
            referenceNowIso={referenceNowIso}
            capabilities={effectiveCapabilities}
            isSelected={selectedProjectId === ep.project.projectId}
            onSelectProject={(id) => setSelectedProjectId(id)}
            onChangePriority={handleChangePriority}
            onToggleArchive={handleToggleArchive}
            onSendReminder={handleSendReminder}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-[#0B0F17] text-slate-900 dark:text-slate-100">
      {/* 1. Persistent Mode & Connection Truthfulness Banner */}
      {mode === 'demo' && (
        <div
          role="region"
          aria-label="Synthetic Demo Data Notice"
          className="bg-slate-900 dark:bg-slate-950 text-slate-100 px-4 py-2 text-xs border-b border-slate-800"
        >
          <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Database className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="font-mono font-semibold tracking-wide text-amber-300">
                SYNTHETIC DEMO DATA
              </span>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <span className="text-slate-300">
                Sanitized fixtures for evaluation ({demoControllerRef.current.getDroppedDuplicatesCount()}{' '}
                duplicate event deduplicated). Not connected to local Macs or MD workers.
                {demoClockOffsetSeconds > 0
                  ? ` Clock advanced +${demoClockOffsetSeconds}s.`
                  : ''}
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setDemoClockOffsetSeconds((s) => s + 120)}
                className="text-slate-300 hover:text-white underline underline-offset-4 cursor-pointer"
              >
                Advance Demo Clock +2m
              </button>
              <span aria-hidden="true" className="text-slate-600">
                ·
              </span>
              <button
                type="button"
                onClick={() => handleSwitchMode('live')}
                className="font-medium text-amber-300 hover:text-white underline underline-offset-4 whitespace-nowrap cursor-pointer"
              >
                Switch to Live Adapter Mode
              </button>
            </div>
          </div>
        </div>
      )}

      {mode === 'live' && effectiveConnectionHealth === 'never_connected' && (
        <div
          role="region"
          aria-label="Live Adapter Not Connected"
          className="bg-red-950 text-red-100 px-4 py-2 text-xs border-b border-red-900"
        >
          <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <WifiOff className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <span className="font-mono font-semibold text-red-300">
                LIVE MODE — NOT CONNECTED
              </span>
              <span aria-hidden="true" className="text-red-700">
                ·
              </span>
              <span>
                No valid snapshot received from{' '}
                <code className="font-mono">{liveConfig.endpointBaseUrl}</code>. Synthetic
                demo fixtures are never substituted for a failed live feed.
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleSwitchMode('demo')}
              className="font-medium text-red-200 hover:text-white underline underline-offset-4 whitespace-nowrap cursor-pointer"
            >
              Return to Demo Fixtures
            </button>
          </div>
        </div>
      )}

      {mode === 'live' &&
        (effectiveConnectionHealth === 'stale' ||
          effectiveConnectionHealth === 'disconnected') && (
          <div
            role="region"
            aria-label="Stale or Disconnected Live Feed Warning"
            className="bg-amber-950 text-amber-100 px-4 py-2 text-xs border-b border-amber-900"
          >
            <div className="max-w-[1600px] mx-auto flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="font-mono font-semibold text-amber-300">
                  {effectiveConnectionHealth === 'disconnected'
                    ? 'LIVE FEED DISCONNECTED — SHOWING PRESERVED SNAPSHOT'
                    : 'STALE LIVE FEED WARNING'}
                </span>
                <span aria-hidden="true" className="text-amber-700">
                  ·
                </span>
                <span>
                  Snapshot generated:{' '}
                  <strong className="font-mono tabular-nums">
                    {formatRelativeAge(liveSnapshot?.generatedAt, referenceNowIso)}
                  </strong>
                  {' · '}
                  Last HTTP contact:{' '}
                  <strong className="font-mono tabular-nums">
                    {formatRelativeAge(liveLastContactAt, referenceNowIso)}
                  </strong>
                  {effectiveLiveWarning ? ` (${effectiveLiveWarning})` : ''}.
                </span>
              </div>
              <button
                type="button"
                onClick={() => void performLivePoll()}
                className="font-medium text-amber-200 hover:text-white underline underline-offset-4 whitespace-nowrap cursor-pointer"
              >
                Retry Poll Now
              </button>
            </div>
          </div>
        )}

      {/* 2. Workspace Shell: Compact Sidebar + Main Content Area */}
      <div className="flex-1 flex max-w-[1600px] w-full mx-auto">
        {/* Compact Left Sidebar (Desktop) */}
        <aside
          aria-label="Workspace Navigation"
          className="hidden md:flex md:w-56 shrink-0 flex-col border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-[#111827] p-3.5 justify-between"
        >
          <div className="space-y-5">
            {/* Brand */}
            <div className="px-2 pt-1">
              <div className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
                dot · Projects Board
              </div>
              <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                {mode === 'demo'
                  ? 'Mode: Demo Fixtures'
                  : `Mode: Live (${effectiveConnectionHealth})`}
              </div>
            </div>

            {/* Primary Views */}
            <nav aria-label="Primary Views" className="space-y-1 text-xs">
              <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                Workspace
              </div>
              {(
                [
                  {
                    id: 'board_overview',
                    label: 'Board Overview',
                    icon: List,
                    badge: activeUnarchivedProjects.length,
                  },
                  { id: 'today_focus', label: 'Today Focus', icon: Calendar, badge: undefined },
                  {
                    id: 'attention_queue',
                    label: 'Attention Needed',
                    icon: ShieldAlert,
                    badge: openDecisionsCount,
                  },
                  {
                    id: 'workers_runs',
                    label: 'Workers & Runs',
                    icon: Cpu,
                    badge: activeSnapshot?.workers.length,
                  },
                  {
                    id: 'archived',
                    label: 'Archived',
                    icon: Archive,
                    badge: archivedProjects.length,
                  },
                  {
                    id: 'contract_tests',
                    label: 'Contract & Tests',
                    icon: FileCode2,
                    badge: undefined,
                  },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const isActive = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveNav(item.id)}
                    className={`w-full flex items-center justify-between px-2.5 py-2 rounded-md font-medium transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-slate-900 dark:bg-sky-600 text-white'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70'
                    }`}
                  >
                    <span className="inline-flex items-center gap-2 truncate">
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </span>
                    {item.badge !== undefined && (
                      <span
                        className={`font-mono text-[11px] tabular-nums ${
                          isActive
                            ? 'text-slate-200 dark:text-sky-100'
                            : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Quick Status Filters */}
            {activeSnapshot && (
              <div className="space-y-1 text-xs pt-3 border-t border-slate-200 dark:border-slate-800">
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  Status Filters
                </div>
                {(
                  [
                    ['all', 'All Active', activeUnarchivedProjects.length],
                    ['working_now', 'Running', bucketCounts.working_now],
                    ['waiting_for_me', 'Needs Me', bucketCounts.waiting_for_me],
                    ['blocked', 'Blocked', bucketCounts.blocked],
                    ['unfinished', 'Unfinished', bucketCounts.unfinished],
                    [
                      'recently_verified_complete',
                      'Completed',
                      bucketCounts.recently_verified_complete,
                    ],
                  ] as const
                ).map(([bKey, bLabel, bCount]) => {
                  const isSelected =
                    activeNav === 'board_overview' && selectedBucket === bKey;
                  return (
                    <button
                      key={bKey}
                      type="button"
                      onClick={() => {
                        setActiveNav('board_overview');
                        setSelectedBucket(bKey);
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-slate-100 dark:bg-slate-800 font-semibold text-slate-900 dark:text-white'
                          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-900'
                      }`}
                    >
                      <span>{bLabel}</span>
                      <span className="font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                        {bCount}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Sidebar Footer: Connection & Clock Summary */}
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 px-2 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
            <div className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
              {mode === 'demo' ? (
                <>
                  <Database className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Demo Fixtures</span>
                </>
              ) : effectiveConnectionHealth === 'connected' ? (
                <>
                  <Wifi className="w-3.5 h-3.5 text-teal-500 shrink-0" />
                  <span>Connected (Fresh)</span>
                </>
              ) : effectiveConnectionHealth === 'stale' ? (
                <>
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Stale Snapshot</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5 text-red-500 shrink-0" />
                  <span>{effectiveConnectionHealth.replace('_', ' ')}</span>
                </>
              )}
            </div>
            <div className="font-mono tabular-nums text-[10px]">
              Clock: {formatUtcShort(referenceNowIso)}
            </div>
          </div>
        </aside>

        {/* Mobile Drawer Sidebar */}
        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-50 md:hidden flex">
            <div className="w-64 bg-white dark:bg-[#111827] border-r border-slate-200 dark:border-slate-800 p-4 flex flex-col justify-between">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-900 dark:text-white">
                    dot · Projects Board
                  </span>
                  <button
                    type="button"
                    onClick={() => setMobileSidebarOpen(false)}
                    aria-label="Close navigation menu"
                    className="p-1 text-slate-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <nav className="space-y-1 text-xs">
                  {(
                    [
                      ['board_overview', 'Board Overview'],
                      ['today_focus', 'Today Focus'],
                      ['attention_queue', `Attention Needed (${openDecisionsCount})`],
                      ['workers_runs', 'Workers & Runs'],
                      ['archived', `Archived (${archivedProjects.length})`],
                      ['contract_tests', 'Contract & Tests'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => {
                        setActiveNav(id);
                        setMobileSidebarOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-md font-medium ${
                        activeNav === id
                          ? 'bg-slate-900 dark:bg-sky-600 text-white'
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
              </div>
            </div>
            <div
              className="flex-1 bg-slate-900/40"
              onClick={() => setMobileSidebarOpen(false)}
            />
          </div>
        )}

        {/* Right Main Column: Clean Header + Workspace Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Top Header */}
          <header className="bg-white dark:bg-[#111827] border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* Left: Mobile Menu Trigger + View Title + Separate Snapshot Observation vs Contact Status */}
              <div className="flex items-center gap-3 min-w-0">
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(true)}
                  aria-label="Open navigation menu"
                  className="md:hidden p-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded"
                >
                  <Menu className="w-4 h-4" />
                </button>

                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-sm font-bold text-slate-900 dark:text-white tracking-tight">
                      {activeNav === 'board_overview'
                        ? 'Command Center Board'
                        : activeNav === 'today_focus'
                        ? 'Today Operational Focus'
                        : activeNav === 'attention_queue'
                        ? 'Attention Queue'
                        : activeNav === 'workers_runs'
                        ? 'Workers & Runs Telemetry'
                        : activeNav === 'archived'
                        ? 'Archived Projects'
                        : 'Integration Contract & Verification'}
                    </h1>
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                      ·
                    </span>
                    <span className="text-xs font-mono text-slate-500 dark:text-slate-400 tabular-nums">
                      {mode === 'demo'
                        ? `Demo snapshot (${formatRelativeAge(
                            activeSnapshot?.generatedAt,
                            referenceNowIso
                          )})`
                        : activeSnapshot
                        ? `Snapshot observed: ${formatRelativeAge(
                            activeSnapshot.generatedAt,
                            referenceNowIso
                          )} · HTTP contact: ${formatRelativeAge(
                            liveLastContactAt,
                            referenceNowIso
                          )}`
                        : 'Live: Never connected'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Controls: Search + Row/Card Toggle + Theme Switch + Adapter Button */}
              <div className="flex flex-wrap items-center gap-2">
                {(activeNav === 'board_overview' || activeNav === 'archived') && (
                  <>
                    <div className="relative w-48 sm:w-60">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="search"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search projects, steps..."
                        aria-label="Search projects"
                        className="w-full text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded pl-8 pr-2.5 py-1.5 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-600"
                      />
                    </div>

                    {/* Compact Rows vs Cards Toggle */}
                    <div
                      role="group"
                      aria-label="Project layout view"
                      className="inline-flex items-center p-0.5 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded"
                    >
                      <button
                        type="button"
                        onClick={() => setDisplayLayout('rows')}
                        title="Compact Rows (Default)"
                        className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-xs cursor-pointer ${
                          displayLayout === 'rows'
                            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-2xs'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <List className="w-3.5 h-3.5" />
                        <span>Rows</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDisplayLayout('cards')}
                        title="Expanded Cards"
                        className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-xs cursor-pointer ${
                          displayLayout === 'cards'
                            ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-2xs'
                            : 'text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <LayoutGrid className="w-3.5 h-3.5" />
                        <span>Cards</span>
                      </button>
                    </div>
                  </>
                )}

                {/* Light / Dark Theme Toggle */}
                <button
                  type="button"
                  onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
                  aria-label={
                    theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'
                  }
                  title={theme === 'light' ? 'Switch to Dark Theme' : 'Switch to Light Theme'}
                  className="p-1.5 text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded hover:bg-slate-200 dark:hover:bg-slate-800 cursor-pointer"
                >
                  {theme === 'light' ? (
                    <Moon className="w-3.5 h-3.5" />
                  ) : (
                    <Sun className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Adapter Config */}
                <button
                  type="button"
                  onClick={() => setAdapterModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 dark:bg-sky-600 hover:bg-slate-800 dark:hover:bg-sky-700 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5" />
                  <span>Adapter &amp; Mode</span>
                </button>
              </div>
            </div>
          </header>

          {/* Main Workspace Scroll Area */}
          <main className="flex-1 p-4 sm:p-6 max-w-full overflow-x-hidden">
            {/* Action Feedback / Undo Banner */}
            {feedbackBanner && (
              <div
                role="status"
                className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-lg border mb-5 text-xs ${
                  feedbackBanner.tone === 'success'
                    ? 'bg-teal-50 dark:bg-teal-950/40 border-teal-200 dark:border-teal-900 text-teal-950 dark:text-teal-200'
                    : feedbackBanner.tone === 'danger'
                    ? 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-950 dark:text-red-200'
                    : 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-950 dark:text-amber-200'
                }`}
              >
                <div className="flex items-center gap-2">
                  {feedbackBanner.tone === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                  ) : feedbackBanner.tone === 'danger' ? (
                    <XCircle className="w-4 h-4 text-red-700 dark:text-red-400 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
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
                        className="inline-flex items-center gap-1 font-semibold underline underline-offset-4 cursor-pointer"
                      >
                        <Undo2 className="w-3.5 h-3.5" />
                        <span>Undo</span>
                      </button>
                    )}
                  <button
                    type="button"
                    onClick={() => setFeedbackBanner(null)}
                    className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* LIVE MODE: NOT CONNECTED EMPTY STATE (Never substitutes synthetic data!) */}
            {mode === 'live' && !activeSnapshot ? (
              <section className="bg-white dark:bg-[#111827] border border-slate-300 dark:border-slate-800 rounded-xl p-8 text-center max-w-xl mx-auto my-8">
                <WifiOff className="w-9 h-9 text-red-600 dark:text-red-400 mx-auto mb-3" />
                <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-1.5">
                  Not Connected to Local Mission Control
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed">
                  Live Mode is active and waiting for a verified{' '}
                  <code className="font-mono">{CONTRACT_SCHEMA_VERSION}</code> snapshot from{' '}
                  <code className="font-mono bg-slate-100 dark:bg-slate-900 px-1.5 py-0.5 rounded">
                    {liveConfig.endpointBaseUrl}/snapshot
                  </code>
                  . Synthetic demo fixtures are never displayed in Live Mode.
                </p>
                {effectiveLiveWarning && (
                  <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 rounded p-3 text-xs font-mono text-red-800 dark:text-red-300 mb-5 text-left">
                    {effectiveLiveWarning} (Failed attempts: {consecutiveFailures})
                  </div>
                )}
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    disabled={isPollingLive}
                    onClick={() => void performLivePoll()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isPollingLive ? 'animate-spin' : ''}`} />
                    <span>{isPollingLive ? 'Polling...' : 'Retry Live Connection'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdapterModalOpen(true)}
                    className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 rounded hover:bg-slate-200 cursor-pointer"
                  >
                    Configure Endpoint
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSwitchMode('demo')}
                    className="px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-50 dark:hover:bg-slate-900 cursor-pointer"
                  >
                    Switch to Demo Mode
                  </button>
                </div>
              </section>
            ) : activeSnapshot ? (
              <>
                {activeNav === 'contract_tests' && <ContractAndTestsView />}

                {activeNav === 'today_focus' && (
                  <TodayView
                    snapshot={activeSnapshot}
                    evaluatedProjects={allEvaluatedProjects}
                    referenceNowIso={referenceNowIso}
                    onSelectProject={(id) => setSelectedProjectId(id)}
                  />
                )}

                {activeNav === 'workers_runs' && (
                  <WorkersAndRunsView
                    snapshot={activeSnapshot}
                    referenceNowIso={referenceNowIso}
                    onSelectProject={(id) => setSelectedProjectId(id)}
                  />
                )}

                {activeNav === 'attention_queue' && (
                  <AttentionPanel
                    decisions={activeSnapshot.decisions}
                    projects={activeSnapshot.projects}
                    referenceNowIso={referenceNowIso}
                    capabilities={effectiveCapabilities}
                    selectedProjectId={selectedProjectId}
                    onSelectProject={(id) => setSelectedProjectId(id)}
                    onResolveDecision={handleResolveDecision}
                    onSendReminder={handleSendReminder}
                  />
                )}

                {(activeNav === 'board_overview' || activeNav === 'archived') && (
                  <div className="space-y-6">
                    {/* 1. Attention Panel at Top of Board Overview */}
                    {activeNav === 'board_overview' && (
                      <AttentionPanel
                        decisions={activeSnapshot.decisions}
                        projects={activeSnapshot.projects}
                        referenceNowIso={referenceNowIso}
                        capabilities={effectiveCapabilities}
                        selectedProjectId={selectedProjectId}
                        onSelectProject={(id) => setSelectedProjectId(id)}
                        onResolveDecision={handleResolveDecision}
                        onSendReminder={handleSendReminder}
                      />
                    )}

                    {/* Filter Bar: Segmented Status Pills + Owner & Priority Selectors */}
                    <section
                      aria-label="Filter Bar"
                      className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-2.5"
                    >
                      {activeNav === 'archived' ? (
                        <div className="flex items-center gap-2 text-xs">
                          <Archive className="w-4 h-4 text-slate-500" />
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            Archived Projects ({archivedProjects.length})
                          </span>
                          <span className="text-slate-500 dark:text-slate-400">
                            — Unfinished work stays discoverable; archiving never deletes files
                            or cancels workers.
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1">
                          {(
                            [
                              ['all', 'All', activeUnarchivedProjects.length],
                              ['working_now', 'Running', bucketCounts.working_now],
                              ['waiting_for_me', 'Needs Me', bucketCounts.waiting_for_me],
                              ['blocked', 'Blocked', bucketCounts.blocked],
                              ['unfinished', 'Unfinished', bucketCounts.unfinished],
                              [
                                'recently_verified_complete',
                                'Completed',
                                bucketCounts.recently_verified_complete,
                              ],
                            ] as const
                          ).map(([bKey, bLabel, bCount]) => (
                            <button
                              key={bKey}
                              type="button"
                              onClick={() => setSelectedBucket(bKey)}
                              className={`px-2.5 py-1 text-xs font-medium rounded transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                                selectedBucket === bKey
                                  ? 'bg-slate-900 dark:bg-sky-600 text-white'
                                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              <span>{bLabel}</span>
                              <span
                                className={`ml-1.5 font-mono text-[11px] tabular-nums ${
                                  selectedBucket === bKey
                                    ? 'text-slate-200 dark:text-sky-100'
                                    : 'text-slate-400 dark:text-slate-500'
                                }`}
                              >
                                {bCount}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          aria-label="Filter by owner"
                          value={ownerFilter}
                          onChange={(e) => setOwnerFilter(e.target.value)}
                          className="text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1 text-slate-700 dark:text-slate-200"
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
                          className="text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded px-2.5 py-1 text-slate-700 dark:text-slate-200"
                        >
                          <option value="all">All Priorities</option>
                          <option value="critical">Critical</option>
                          <option value="high">High</option>
                          <option value="normal">Normal</option>
                          <option value="low">Low</option>
                        </select>
                      </div>
                    </section>

                    {/* Project List: Hierarchy View when showing 'all' on Board Overview, or flat filtered list */}
                    {filteredProjects.length === 0 ? (
                      <div className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg p-8 text-center">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white mb-1">
                          No projects match the current filter
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                          Clear your search or reset status filters to inspect all projects.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedBucket('all');
                            setOwnerFilter('all');
                            setPriorityFilter('all');
                            setSearchQuery('');
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-white bg-sky-600 hover:bg-sky-700 rounded cursor-pointer"
                        >
                          Reset Filters
                        </button>
                      </div>
                    ) : activeNav === 'board_overview' && selectedBucket === 'all' ? (
                      <div className="space-y-6">
                        {/* Section 1: Needs Attention / Blocked First */}
                        {hierarchySections.attentionOrBlocked.length > 0 && (
                          <section aria-label="Blocked and Needs Attention Projects">
                            <div className="flex items-center justify-between mb-2 px-1">
                              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                                1. Blocked &amp; Needs Attention (
                                {hierarchySections.attentionOrBlocked.length})
                              </h2>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                Confirmed failures, stalled progress, or pending operator decisions
                              </span>
                            </div>
                            {renderProjectCollection(hierarchySections.attentionOrBlocked)}
                          </section>
                        )}

                        {/* Section 2: Current Work Second */}
                        {hierarchySections.currentWork.length > 0 && (
                          <section aria-label="Currently Running Projects">
                            <div className="flex items-center justify-between mb-2 px-1">
                              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                                2. Current Work — Confirmed Running (
                                {hierarchySections.currentWork.length})
                              </h2>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                Fresh worker heartbeats and verified progress
                              </span>
                            </div>
                            {renderProjectCollection(hierarchySections.currentWork)}
                          </section>
                        )}

                        {/* Section 3: Unfinished Backlog & Verified Complete Third */}
                        {hierarchySections.backlogAndCompleted.length > 0 && (
                          <section aria-label="Unfinished Backlog and Verified Complete Projects">
                            <div className="flex items-center justify-between mb-2 px-1">
                              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                                3. Unfinished Backlog &amp; Verified Complete (
                                {hierarchySections.backlogAndCompleted.length})
                              </h2>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                Idle, queued, unknown coverage, or strictly verified complete
                              </span>
                            </div>
                            {renderProjectCollection(hierarchySections.backlogAndCompleted)}
                          </section>
                        )}
                      </div>
                    ) : (
                      renderProjectCollection(filteredProjects)
                    )}

                    {/* Expandable Technical Diagnostics Section */}
                    <section
                      aria-label="Technical Diagnostics"
                      className="bg-white dark:bg-[#111827] border border-slate-200 dark:border-slate-800 rounded-lg px-4 py-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-slate-600 dark:text-slate-400">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            Technical Diagnostics &amp; Thresholds
                          </span>
                          <span className="ml-2 font-mono text-[11px]">
                            Schema: {activeSnapshot.schemaVersion} · Snapshot:{' '}
                            {activeSnapshot.snapshotId}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDiagnosticsExpanded((prev) => !prev)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                        >
                          {diagnosticsExpanded ? (
                            <>
                              <ChevronUp className="w-3.5 h-3.5" />
                              <span>Hide Diagnostics</span>
                            </>
                          ) : (
                            <>
                              <ChevronDown className="w-3.5 h-3.5" />
                              <span>Expand Diagnostics</span>
                            </>
                          )}
                        </button>
                      </div>

                      {diagnosticsExpanded && (
                        <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-5 gap-3 text-xs font-mono text-slate-600 dark:text-slate-400">
                          <div>
                            <div className="text-[11px] text-slate-400">Heartbeat Expiry</div>
                            <div>
                              {activeSnapshot.evaluationThresholds.heartbeatExpirySeconds}s
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-400">
                              Stalled Progress Limit
                            </div>
                            <div>
                              {activeSnapshot.evaluationThresholds.stalledProgressSeconds}s (
                              {Math.floor(
                                activeSnapshot.evaluationThresholds.stalledProgressSeconds / 60
                              )}
                              m)
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-400">
                              Snapshot Generated At
                            </div>
                            <div>{formatUtcShort(activeSnapshot.generatedAt)}</div>
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-400">
                              Last HTTP Contact
                            </div>
                            <div>
                              {mode === 'demo'
                                ? 'N/A (Demo)'
                                : liveLastContactAt
                                ? formatUtcShort(liveLastContactAt)
                                : 'None'}
                            </div>
                          </div>
                          <div>
                            <div className="text-[11px] text-slate-400">Command Capabilities</div>
                            <div>
                              {effectiveCapabilities.canChangePriority
                                ? mode === 'demo'
                                  ? 'Writable (Demo)'
                                  : 'Writable (Live)'
                                : 'Read-Only'}
                            </div>
                          </div>
                        </div>
                      )}
                    </section>
                  </div>
                )}
              </>
            ) : null}
          </main>
        </div>
      </div>

      {/* Slide-Over Side Panel for Selected Project */}
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

      {/* Adapter Configuration Modal */}
      {adapterModalOpen && (
        <AdapterConfigModal
          mode={mode}
          liveConfig={liveConfig}
          capabilitiesReadOnlySimulated={capabilitiesReadOnlySimulated}
          demoClockOffsetSeconds={demoClockOffsetSeconds}
          onClose={() => setAdapterModalOpen(false)}
          onSwitchMode={handleSwitchMode}
          onUpdateLiveConfig={handleUpdateLiveConfig}
          onTriggerLivePollNow={() => {
            if (modeRef.current !== 'live') {
              handleSwitchMode('live');
            } else {
              void performLivePoll();
            }
          }}
          onToggleCapabilitiesReadOnly={handleToggleCapabilitiesReadOnly}
          onAdvanceDemoClockSeconds={(delta) =>
            setDemoClockOffsetSeconds((prev) => prev + delta)
          }
          onResetDemoFixtures={handleResetDemoFixtures}
        />
      )}
    </div>
  );
}
