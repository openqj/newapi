import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "../../components/ui";
import { errorMessage } from "../../lib/errors";
import { isTauri } from "../../lib/platform";
import { stationApi } from "./api";
import type { Station, StationSnapshot, StationSyncProgress, StationSyncResult } from "./types";

type UseStationsOptions<Snapshot extends StationSnapshot> = {
  emptySnapshot: Snapshot;
  demo?: { stations: Station[]; snapshots: Record<string, Snapshot> };
  /** Called after a successful sync to refresh feature-specific projections. */
  onSyncComplete?: (stationId?: string) => Promise<void> | void;
  /** Kept opt-in for gradual migration; the legacy app currently owns the timer. */
  autoRefresh?: boolean;
  refreshIntervalMs?: number;
};

/**
 * Owns station selection, snapshot loading and synchronisation lifecycle.
 * Consumers can layer their own key/account/rate reloads through onSyncComplete
 * while the Tauri command contract remains private to this feature.
 */
export function useStations<Snapshot extends StationSnapshot>({
  emptySnapshot,
  demo,
  onSyncComplete,
  autoRefresh = false,
  refreshIntervalMs = 30 * 60 * 1000,
}: UseStationsOptions<Snapshot>) {
  const { notify } = useToast();
  const [stations, setStations] = useState<Station[]>(() => isTauri() ? [] : (demo?.stations ?? []));
  const [selectedId, setSelectedId] = useState<string | undefined>(() => isTauri() ? undefined : demo?.stations[0]?.id);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => isTauri() ? emptySnapshot : (demo?.snapshots[demo.stations[0]?.id ?? ""] ?? emptySnapshot));
  const [busy, setBusy] = useState(false);
  const [syncProgress, setSyncProgress] = useState<StationSyncProgress | null>(null);
  const refreshInFlight = useRef<Promise<void> | null>(null);

  const loadStations = useCallback(async () => {
    if (!isTauri()) {
      setStations(demo?.stations ?? []);
      return;
    }
    try {
      const next = await stationApi.list<Station[]>();
      setStations(next);
      setSelectedId((current) => current && next.some((station) => station.id === current) ? current : next[0]?.id);
    } catch (reason) {
      notify(errorMessage(reason, "加载站点失败，请稍后重试。"), "error");
    }
  }, [demo, notify]);

  const loadSnapshot = useCallback(async (id = selectedId) => {
    if (!isTauri()) {
      setSnapshot(id ? (demo?.snapshots[id] ?? emptySnapshot) : emptySnapshot);
      return;
    }
    if (!id) {
      setSnapshot(emptySnapshot);
      return;
    }
    try {
      setSnapshot(((await stationApi.snapshot<Snapshot>(id)) ?? emptySnapshot) as Snapshot);
    } catch (reason) {
      notify(errorMessage(reason, "加载站点数据失败，请稍后重试。"), "error");
    }
  }, [demo, emptySnapshot, notify, selectedId]);

  const refreshAll = useCallback((onComplete = onSyncComplete) => {
    if (!isTauri()) return Promise.resolve();
    if (refreshInFlight.current) return refreshInFlight.current;

    const refresh = (async () => {
      setBusy(true);
    try {
      await stationApi.refreshAll<StationSyncResult<Snapshot>[]>();
      await loadStations();
      await loadSnapshot();
      await onComplete?.(selectedId);
    } catch (reason) {
      notify(errorMessage(reason, "同步站点失败，请稍后重试。"), "error");
    } finally {
      setBusy(false);
      setSyncProgress(null);
    }
    })();
    refreshInFlight.current = refresh;
    void refresh.finally(() => {
      if (refreshInFlight.current === refresh) refreshInFlight.current = null;
    });
    return refresh;
  }, [loadSnapshot, loadStations, notify, onSyncComplete, selectedId]);

  const cancelRefresh = useCallback(async () => {
    try {
      await stationApi.cancelSync();
    } catch (reason) {
      notify(errorMessage(reason, "取消同步失败，请稍后重试。"), "error");
    }
  }, [notify]);

  useEffect(() => { void loadStations(); }, [loadStations]);
  useEffect(() => { void loadSnapshot(selectedId); }, [loadSnapshot, selectedId]);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void refreshAll(), refreshIntervalMs);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refreshAll, refreshIntervalMs]);
  useEffect(() => {
    if (!busy || !isTauri()) return;
    const update = () => void stationApi.syncProgress<StationSyncProgress>().then(setSyncProgress).catch(() => undefined);
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [busy]);

  return { stations, selectedId, setSelectedId, snapshot, busy, syncProgress, loadStations, loadSnapshot, refreshAll, cancelRefresh };
}
