import { useCallback, useState } from "react";
import { useToast } from "../../components/ui";
import { errorMessage } from "../../lib/errors";
import { dashboardApi } from "./api";

/** Standard dashboard refresh state for pages that compose shared feature data. */
export function useDashboardRefresh(refresh: () => Promise<void>) {
  const { notify } = useToast();
  const [refreshing, setRefreshing] = useState(false);
  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      await dashboardApi.refresh(refresh);
    } catch (reason) {
      notify(errorMessage(reason, "刷新概览失败，请稍后重试。"), "error");
    } finally {
      setRefreshing(false);
    }
  }, [notify, refresh]);
  return { refreshing, reload };
}
