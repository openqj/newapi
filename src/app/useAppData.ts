import { useCallback, useEffect, useMemo, useState } from "react";
import { type AccountRow, useAccountRows } from "../features/accounts";
import { type KeyInfo, type KeyRow, useApiKeyRows } from "../features/api-keys";
import { type Rate, type RateRow, useRateRows } from "../features/rates";
import { type RemoteServer, useRemoteServers } from "../features/remote";
import { stationApi, type Station, type StationSnapshot, type StationSyncProgress, useStations } from "../features/stations";
import { DEFAULT_BACKGROUND_REFRESH_MINUTES, settingsApi } from "../features/settings/api";
import { useUsageData } from "../features/usage/hooks";
import { isTauri } from "../lib/platform";
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
  const [backgroundRefreshMinutes, setBackgroundRefreshMinutes] = useState(DEFAULT_BACKGROUND_REFRESH_MINUTES);

  useEffect(() => {
    if (!isTauri()) return;
    void settingsApi.backgroundRefreshMinutes()
      .then(setBackgroundRefreshMinutes)
      .catch(() => undefined);
  }, []);

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
    refreshUsageLogs,
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
      refreshUsageLogs(),
    ]);
  }, [loadAccountRows, loadKeyRows, loadRateRows, loadUsageSummary, refreshUsageLogs]);

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
    onSyncComplete: refreshFeatureRows,
    autoRefresh: true,
    refreshIntervalMs: backgroundRefreshMinutes * 60 * 1000,
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

  const refreshStationLogin = useCallback(async (stationId: string) => {
    if (!isTauri()) return;
    await stationApi.reauthenticate(stationId, null);
    await Promise.all([loadStations(), loadAccountRows()]);
  }, [loadAccountRows, loadStations]);

  const refreshRatesAndKeys = useCallback(() => refreshAll(async () => {
    await Promise.all([loadRateRows(), loadKeyRows()]);
  }), [loadKeyRows, loadRateRows, refreshAll]);

  useEffect(() => { void loadUsageSummary(); }, [loadUsageSummary]);
  useEffect(() => {
    if (view === "keys" || view === "overview" || view === "apiDetection") void loadKeyRows();
  }, [loadKeyRows, view]);
  useEffect(() => { if (view === "accounts" || view === "overview") void loadAccountRows(); }, [loadAccountRows, view]);
  useEffect(() => { if (view === "rates") void loadRateRows(); }, [loadRateRows, view]);
  useEffect(() => {
    if (view === "usage") void refreshUsageLogs();
    else if (view === "overview") void loadUsageLogs();
  }, [loadUsageLogs, refreshUsageLogs, view]);
  useEffect(() => {
    if (view === "remote" || view === "overview") {
      void loadRemoteServers();
      if (view === "remote") void loadKeyRows();
    }
  }, [loadKeyRows, loadRemoteServers, view]);

  return {
    stations, selectedId, setSelectedId, snapshot, keyRows, rateRows, accountRows, usageSummary,
    usageLogs, remoteServers, usageScope, setUsageScope, busy, syncProgress,
    backgroundRefreshMinutes, setBackgroundRefreshMinutes,
    loadStations, loadSnapshot, loadKeyRows, loadRateRows, loadAccountRows, loadUsageSummary, refreshStationLogin,
    loadUsageLogs, refreshUsageLogs, loadRemoteServers, refreshSupportingData, refreshRatesAndKeys,
    refreshAll, cancelRefresh,
  };
}
