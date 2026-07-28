import { useCallback, useEffect, useState } from "react";
import { useToast } from "../../components/ui";
import { errorMessage } from "../../lib/errors";
import { isTauri } from "../../lib/platform";
import { apiKeyApi } from "./api";
import type { KeyRow } from "./types";

type UseApiKeyRowsOptions = {
  demoRows?: KeyRow[];
  loadOnMount?: boolean;
};

/** Owns the aggregated key-table read model shared by key, dashboard and remote views. */
export function useApiKeyRows({ demoRows = [], loadOnMount = true }: UseApiKeyRowsOptions = {}) {
  const { notify } = useToast();
  const [rows, setRows] = useState<KeyRow[]>(() => isTauri() ? [] : demoRows);
  const [loading, setLoading] = useState(false);

  const loadKeyRows = useCallback(async () => {
    if (!isTauri()) {
      setRows(demoRows);
      return;
    }
    setLoading(true);
    try {
      setRows(await apiKeyApi.rows<KeyRow[]>());
    } catch (reason) {
      notify(errorMessage(reason, "加载 API 密钥失败，请稍后重试。"), "error");
    } finally {
      setLoading(false);
    }
  }, [demoRows, notify]);

  useEffect(() => {
    if (loadOnMount) void loadKeyRows();
  }, [loadKeyRows, loadOnMount]);

  return { rows, setRows, loading, loadKeyRows };
}

export type ApiKeyEditorValues = {
  stationId: string;
  name: string;
  group: string;
  customKey: string;
  useCustomKey: boolean;
  quota: string;
  expiresInDays: string;
  enableExpiration: boolean;
  status: string;
  initialStatus: string;
  whitelist: string;
  blacklist: string;
  enableIpRestriction: boolean;
  rateLimit5h: string;
  rateLimit1d: string;
  rateLimit7d: string;
  enableRateLimit: boolean;
};

type UseApiKeyEditorSubmitOptions = {
  row?: KeyRow;
  onSaved: () => Promise<void>;
  onError: (reason: unknown) => void;
};

/** Converts the editor's local fields into the stable API-key save contract. */
export function useApiKeyEditorSubmit({ row, onSaved, onError }: UseApiKeyEditorSubmitOptions) {
  const [saving, setSaving] = useState(false);
  const submit = async (values: ApiKeyEditorValues) => {
    if (!values.stationId || !values.name.trim()) return;
    setSaving(true);
    try {
      await apiKeyApi.save({
        stationId: values.stationId,
        keyId: row?.key.id,
        name: values.name.trim(),
        group: values.group || null,
        customKey: !row && values.useCustomKey ? values.customKey.trim() || null : null,
        quota: values.quota.trim() ? Number(values.quota) : null,
        expiresInDays: values.enableExpiration && values.expiresInDays.trim() ? Number(values.expiresInDays) : null,
        status: row && values.status === values.initialStatus ? null : values.status,
        ipWhitelist: values.enableIpRestriction ? values.whitelist.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) : null,
        ipBlacklist: values.enableIpRestriction ? values.blacklist.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) : null,
        rateLimit5h: values.enableRateLimit && values.rateLimit5h.trim() ? Number(values.rateLimit5h) : null,
        rateLimit1d: values.enableRateLimit && values.rateLimit1d.trim() ? Number(values.rateLimit1d) : null,
        rateLimit7d: values.enableRateLimit && values.rateLimit7d.trim() ? Number(values.rateLimit7d) : null,
      }, Boolean(row));
      await onSaved();
    } catch (reason) {
      onError(reason);
    } finally {
      setSaving(false);
    }
  };

  return { saving, submit };
}
