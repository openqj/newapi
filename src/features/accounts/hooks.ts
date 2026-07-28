import { useCallback, useEffect, useState } from "react";
import { useToast } from "../../components/ui";
import { errorMessage } from "../../lib/errors";
import { isTauri } from "../../lib/platform";
import { accountApi } from "./api";
import type { AccountRow } from "./types";

type UseAccountRowsOptions = {
  demoRows?: AccountRow[];
  loadOnMount?: boolean;
};

/** Owns the account-table projection and its command/error boundary. */
export function useAccountRows({ demoRows = [], loadOnMount = true }: UseAccountRowsOptions = {}) {
  const { notify } = useToast();
  const [rows, setRows] = useState<AccountRow[]>(() => isTauri() ? [] : demoRows);
  const [loading, setLoading] = useState(false);

  const loadAccountRows = useCallback(async () => {
    if (!isTauri()) {
      setRows(demoRows);
      return;
    }
    setLoading(true);
    try {
      setRows(await accountApi.rows<AccountRow[]>());
    } catch (reason) {
      notify(errorMessage(reason, "加载账户数据失败，请稍后重试。"), "error");
    } finally {
      setLoading(false);
    }
  }, [demoRows, notify]);

  useEffect(() => { if (loadOnMount) void loadAccountRows(); }, [loadAccountRows, loadOnMount]);
  return { rows, setRows, loading, loadAccountRows };
}
