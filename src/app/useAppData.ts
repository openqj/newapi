import { useCallback, useEffect, useMemo, useState } from "react";
import { type AccountRow, useAccountRows } from "../features/accounts";
import { type KeyInfo, type KeyRow, useApiKeyRows } from "../features/api-keys";
import { type Rate, type RateRow, useRateRows } from "../features/rates";
import { type RemoteServer, useRemoteServers } from "../features/remote";
import { type Station, type StationSnapshot, type StationSyncProgress, useStations } from "../features/stations";
import { useUsageData } from "../features/usage/hooks";
import type { UsageLog, UsageSummary } from "../features/usage/types";
import type { AppView } from "./routes";

export type Snapshot = StationSnapshot<Rate, KeyInfo, UsageSummary>;
export type SyncProgress = StationSyncProgress;

export type AppDemoData = {
  stations: Station[];
  snapshots: Record<string, Snapshot>;
  keyRows: KeyRow[];
  rateRows: RateRow[];
  accountRows: AccountRow[];
  usageSummary: UsageSummary;
  usageLogs: UsageLog[];
  remoteServers: RemoteServer[];
};

type UseAppDataOptions = {
  demo: AppDemoData;
  emptySnapshot: Snapshot;
  emptyUsageSummary: UsageSummary;
  view: AppView;
};

/**
 * Compatibility composition root for the legacy shell. Each feature owns its
 * own Tauri calls and data lifecycle; this only coordinates existing props.
 */
export function useAppData({ demo, emptySnapshot, emptyUsageSummary, view }: UseAppDataOptions) {
  const [usageScope, setUsageScope] = useState<"all" | "current">("all");

  const { rows: keyRows, loadKeyRows } = useApiKeyRows({
    demoRows: demo.keyRows,
    loadOnMount: false,
  });
  const { rows: rateRows, loadRateRows } = useRateRows({
    demoRows: demo.rateRows,
    loadOnMount: false,
  });
  const { rows: accountRows, loadAccountRows } = useAccountRows({
    demoRows: demo.accountRows,
    loadOnMount: false,
  });
  const {
    summary: usageSummary,
    logs: usageLogs,
    loadUsageSummary,
    loadUsageLogs,
  } = useUsageData({
    emptySummary: emptyUsageSummary,
    demoSummary: demo.usageSummary,
    demoLogs: demo.usageLogs,
    loadSummaryOnMount: false,
    loadLogsOnMount: false,
  });

  const refreshFeatureRows = useCallback(async () => {
    await Promise.all([
      loadKeyRows(),
      loadAccountRows(),
      loadRateRows(),
      loadUsageSummary(),
    ]);
  }, [loadAccountRows, loadKeyRows, loadRateRows, loadUsageSummary]);

  const stationDemo = useMemo(
    () => ({ stations: demo.stations, snapshots: demo.snapshots }),
    [demo.snapshots, demo.stations],
  );

  const {
    stations,
    selectedId,
    setSelectedId,
    snapshot,
    busy,
    syncProgress,
    loadStations,
    loadSnapshot,
    refreshAll,
    cancelRefresh,
  } = useStations<Snapshot>({
    emptySnapshot,
    demo: stationDemo,
    autoRefresh: true,
    onSyncComplete: refreshFeatureRows,
  });

  const { servers: remoteServers, loadRemoteServers } = useRemoteServers({
    demoServers: demo.remoteServers,
    loadOnMount: false,
  });

  const refreshSupportingData = useCallback(async (stationId = selectedId) => {
    await loadStations();
    await loadSnapshot(stationId);
    await refreshFeatureRows();
  }, [loadSnapshot, loadStations, refreshFeatureRows, selectedId]);

  useEffect(() => { void loadUsageSummary(); }, [loadUsageSummary]);
  useEffect(() => {
    if (view === "keys" || view === "overview" || view === "apiDetection") void loadKeyRows();
  }, [loadKeyRows, view]);
  useEffect(() => { if (view === "accounts" || view === "overview") void loadAccountRows(); }, [loadAccountRows, view]);
  useEffect(() => { if (view === "rates") void loadRateRows(); }, [loadRateRows, view]);
  useEffect(() => { if (view === "usage" || view === "overview") void loadUsageLogs(); }, [loadUsageLogs, view]);
  useEffect(() => {
    if (view === "remote") {
      void loadRemoteServers();
      void loadKeyRows();
    }
  }, [loadKeyRows, loadRemoteServers, view]);

  return {
    stations, selectedId, setSelectedId, snapshot, keyRows, rateRows, accountRows, usageSummary,
    usageLogs, remoteServers, usageScope, setUsageScope, busy, syncProgress,
    loadStations, loadSnapshot, loadKeyRows, loadRateRows, loadAccountRows, loadUsageSummary,
    loadUsageLogs, loadRemoteServers, refreshSupportingData, refreshAll, cancelRefresh,
  };
}
