import { useCallback, useEffect, useState } from "react";
import { useToast } from "../../components/ui";
import { errorMessage } from "../../lib/errors";
import { isTauri } from "../../lib/platform";
import { usageApi } from "./api";
import type { UsageLog, UsageSummary } from "./types";

type UseUsageDataOptions = {
  emptySummary: UsageSummary;
  demoSummary?: UsageSummary;
  demoLogs?: UsageLog[];
  loadSummaryOnMount?: boolean;
  loadLogsOnMount?: boolean;
};

/** Owns usage summary/log read models while allowing each page to choose when it loads. */
export function useUsageData({
  emptySummary,
  demoSummary = emptySummary,
  demoLogs = [],
  loadSummaryOnMount = true,
  loadLogsOnMount = false,
}: UseUsageDataOptions) {
  const { notify } = useToast();
  const [summary, setSummary] = useState<UsageSummary>(() => isTauri() ? emptySummary : demoSummary);
  const [logs, setLogs] = useState<UsageLog[]>(() => isTauri() ? [] : demoLogs);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);

  const loadUsageSummary = useCallback(async () => {
    if (!isTauri()) {
      setSummary(demoSummary);
      return;
    }
    setSummaryLoading(true);
    try {
      setSummary(await usageApi.summary<UsageSummary>());
    } catch (reason) {
      notify(errorMessage(reason, "加载用量摘要失败，请稍后重试。"), "error");
    } finally {
      setSummaryLoading(false);
    }
  }, [demoSummary, notify]);

  const loadUsageLogs = useCallback(async () => {
    if (!isTauri()) {
      setLogs(demoLogs);
      return;
    }
    setLogsLoading(true);
    try {
      setLogs(await usageApi.logs<UsageLog[]>());
    } catch (reason) {
      notify(errorMessage(reason, "加载使用记录失败，请稍后重试。"), "error");
    } finally {
      setLogsLoading(false);
    }
  }, [demoLogs, notify]);

  const refreshUsageLogs = useCallback(async () => {
    if (!isTauri()) {
      setLogs(demoLogs);
      return;
    }
    setLogsLoading(true);
    try {
      setLogs(await usageApi.refreshLogs<UsageLog[]>());
    } catch (reason) {
      notify(errorMessage(reason, "刷新使用记录失败，请稍后重试。"), "error");
    } finally {
      setLogsLoading(false);
    }
  }, [demoLogs, notify]);

  useEffect(() => { if (loadSummaryOnMount) void loadUsageSummary(); }, [loadSummaryOnMount, loadUsageSummary]);
  useEffect(() => { if (loadLogsOnMount) void loadUsageLogs(); }, [loadLogsOnMount, loadUsageLogs]);

  return { summary, setSummary, logs, setLogs, summaryLoading, logsLoading, loadUsageSummary, loadUsageLogs, refreshUsageLogs };
}
