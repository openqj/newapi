import { useCallback, useEffect, useState } from "react";
import { useToast } from "../../components/ui";
import { errorMessage } from "../../lib/errors";
import { isTauri } from "../../lib/platform";
import { rateApi } from "./api";
import type { RateRow } from "./types";

type UseRateRowsOptions = {
  demoRows?: RateRow[];
  loadOnMount?: boolean;
};

/** Owns the rate-table projection and its command/error boundary. */
export function useRateRows({ demoRows = [], loadOnMount = true }: UseRateRowsOptions = {}) {
  const { notify } = useToast();
  const [rows, setRows] = useState<RateRow[]>(() => isTauri() ? [] : demoRows);
  const [loading, setLoading] = useState(false);

  const loadRateRows = useCallback(async () => {
    if (!isTauri()) {
      setRows(demoRows);
      return;
    }
    setLoading(true);
    try {
      setRows(await rateApi.rows<RateRow[]>());
    } catch (reason) {
      notify(errorMessage(reason, "加载倍率数据失败，请稍后重试。"), "error");
    } finally {
      setLoading(false);
    }
  }, [demoRows, notify]);

  useEffect(() => { if (loadOnMount) void loadRateRows(); }, [loadOnMount, loadRateRows]);
  return { rows, setRows, loading, loadRateRows };
}
