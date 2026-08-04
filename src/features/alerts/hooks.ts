import { useCallback, useEffect, useState } from "react";
import { useToast } from "../../components/ui";
import { errorMessage } from "../../lib/errors";
import { isTauri } from "../../lib/platform";
import { alertApi } from "./api";
import type { AlertHistoryItem, AlertPolicy } from "./types";

export const defaultAlertPolicy: AlertPolicy = {
  enabled: false,
  lowBalanceThreshold: 5,
  remainingQuotaPercent: 10,
  quotaResetWarningHours: 24,
  notifyStationFailures: true,
};

/** Feature-owned alert policy/history state for settings and future surfaces. */
export function useAlerts() {
  const { notify } = useToast();
  const [policy, setPolicy] = useState<AlertPolicy>(defaultAlertPolicy);
  const [history, setHistory] = useState<AlertHistoryItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const loadHistory = useCallback(async () => {
    if (!isTauri()) return;
    setLoadingHistory(true);
    try { setHistory(await alertApi.history()); }
    catch (reason) { notify(errorMessage(reason, "加载告警历史失败。"), "error"); }
    finally { setLoadingHistory(false); }
  }, [notify]);
  const loadPolicy = useCallback(async () => {
    if (!isTauri()) return;
    try { setPolicy(await alertApi.policy()); }
    catch (reason) { notify(errorMessage(reason, "加载告警策略失败。"), "error"); }
  }, [notify]);
  const save = useCallback(async () => {
    if (!isTauri()) return;
    setSaving(true);
    try { setPolicy(await alertApi.savePolicy(policy)); notify("告警策略已保存。", "success"); }
    catch (reason) { notify(errorMessage(reason, "保存告警策略失败。"), "error"); }
    finally { setSaving(false); }
  }, [notify, policy]);
  const evaluate = useCallback(async () => {
    if (!isTauri()) return;
    setLoadingHistory(true);
    try { const active = await alertApi.evaluate(); await loadHistory(); notify(active.length ? `已评估：${active.length} 项告警。` : "已评估：当前没有告警。", active.length ? "info" : "success"); }
    catch (reason) { notify(errorMessage(reason, "评估告警失败。"), "error"); setLoadingHistory(false); }
  }, [loadHistory, notify]);
  useEffect(() => { void loadPolicy(); void loadHistory(); }, [loadHistory, loadPolicy]);
  return { policy, setPolicy, history, saving, loadingHistory, loadPolicy, loadHistory, save, evaluate };
}
