import { useCallback, useEffect, useState } from "react";
import { useToast } from "../../components/ui";
import { useConfirm } from "../../components/ui";
import { errorMessage } from "../../lib/errors";
import { isTauri } from "../../lib/platform";
import type { KeyRow } from "../api-keys";
import { remoteApi } from "./api";
import type { RemoteConnectionResult, RemoteServer, RemoteSyncLog } from "./types";

type UseRemoteServersOptions = {
  demoServers?: RemoteServer[];
  /** Defaults to true so a remote page can be mounted without App-owned effects. */
  loadOnMount?: boolean;
};

/** Owns the remote-server list and exposes a single reload boundary for mutations. */
export function useRemoteServers({ demoServers = [], loadOnMount = true }: UseRemoteServersOptions = {}) {
  const { notify } = useToast();
  const [servers, setServers] = useState<RemoteServer[]>(() => isTauri() ? [] : demoServers);
  const [loading, setLoading] = useState(false);

  const loadRemoteServers = useCallback(async () => {
    if (!isTauri()) {
      setServers(demoServers);
      return;
    }
    setLoading(true);
    try {
      setServers(await remoteApi.list<RemoteServer[]>());
    } catch (reason) {
      notify(errorMessage(reason, "加载远程服务器失败，请稍后重试。"), "error");
    } finally {
      setLoading(false);
    }
  }, [demoServers, notify]);

  useEffect(() => {
    if (loadOnMount) void loadRemoteServers();
  }, [loadOnMount, loadRemoteServers]);

  return { servers, setServers, loading, loadRemoteServers };
}

type RemoteBulkAction = "switch" | "test" | "session" | "delete" | null;

type UseRemoteBulkActionsOptions = {
  servers: RemoteServer[];
  keyRows: KeyRow[];
  onChanged: () => Promise<void>;
  onSavingChange: (id: string | null) => void;
  onTestingChange: (id: string | null) => void;
  onVerifyingSessionChange: (id: string | null) => void;
  onResult: (result: { success: boolean; message: string }) => void;
  onKeyAssigned: (serverId: string, keyValue: string) => void;
};

/** Owns the selection and progress state for the remote-server bulk actions. */
export function useRemoteBulkActions({
  servers, keyRows, onChanged, onSavingChange, onTestingChange, onVerifyingSessionChange, onResult, onKeyAssigned,
}: UseRemoteBulkActionsOptions) {
  const confirm = useConfirm();
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [selection, setSelection] = useState("");
  const [action, setAction] = useState<RemoteBulkAction>(null);
  const selectedServers = servers.filter((server) => selectedServerIds.includes(server.id));

  const toggleServer = (id: string) => {
    setSelectedServerIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const toggleAllServers = () => {
    setSelectedServerIds((current) => current.length === servers.length ? [] : servers.map((server) => server.id));
  };
  const switchSelectedServers = async (keyValue = selection) => {
    const key = keyRows.find((row) => `${row.stationId}:${row.key.id}` === keyValue);
    if (!key || selectedServers.length === 0) return;
    setAction("switch");
    const failures: string[] = [];
    try {
      for (const server of selectedServers) {
        try {
          onSavingChange(server.id);
          if (isTauri()) await remoteApi.assignRelayKey(server.id, key.stationId, key.key.id);
          onKeyAssigned(server.id, keyValue);
        } catch {
          failures.push(server.name);
        } finally {
          onSavingChange(null);
        }
      }
      await onChanged();
      onResult({ success: failures.length === 0, message: failures.length === 0 ? `已切换 ${selectedServers.length} 台服务器的中转站密钥` : `${failures.length} 台服务器切换失败：${failures.join("、")}` });
    } finally {
      setAction(null);
    }
  };
  const testSelectedServers = async () => {
    if (selectedServers.length === 0) return;
    setAction("test");
    const failures: string[] = [];
    try {
      for (const server of selectedServers) {
        try {
          onTestingChange(server.id);
          const result = isTauri() ? await remoteApi.test<RemoteConnectionResult>(server.id) : { success: true };
          if (!result.success) failures.push(server.name);
        } catch {
          failures.push(server.name);
        } finally {
          onTestingChange(null);
        }
      }
      await onChanged();
      onResult({ success: failures.length === 0, message: failures.length === 0 ? `${selectedServers.length} 台服务器 SSH 连接成功` : `${failures.length} 台服务器连接失败：${failures.join("、")}` });
    } finally {
      setAction(null);
    }
  };
  const verifySelectedCodexSessions = async () => {
    if (selectedServers.length === 0) return;
    setAction("session");
    const failures: string[] = [];
    try {
      for (const server of selectedServers) {
        try {
          onVerifyingSessionChange(server.id);
          const result = isTauri() ? await remoteApi.verifyCodexSession<RemoteConnectionResult>(server.id) : { success: true };
          if (!result.success) failures.push(server.name);
        } catch {
          failures.push(server.name);
        } finally {
          onVerifyingSessionChange(null);
        }
      }
      await onChanged();
      onResult({ success: failures.length === 0, message: failures.length === 0 ? `${selectedServers.length} 台服务器 Codex CLI 会话验证成功` : `${failures.length} 台服务器 Codex CLI 会话验证失败：${failures.join("、")}` });
    } finally {
      setAction(null);
    }
  };
  const deleteSelectedServers = async () => {
    if (selectedServers.length === 0 || !(await confirm({ title: "删除远程服务器", description: `确认删除选中的 ${selectedServers.length} 台服务器吗？`, confirmLabel: "删除", destructive: true }))) return;
    setAction("delete");
    const failures: string[] = [];
    try {
      for (const server of selectedServers) {
        try {
          if (isTauri()) await remoteApi.remove(server.id);
        } catch {
          failures.push(server.id);
        }
      }
      await onChanged();
      setSelectedServerIds(failures);
      onResult({ success: failures.length === 0, message: failures.length === 0 ? `已删除 ${selectedServers.length} 台服务器` : `${failures.length} 台服务器删除失败` });
    } finally {
      setAction(null);
    }
  };

  return { selectedServerIds, selection, setSelection, action, selectedServers, toggleServer, toggleAllServers, switchSelectedServers, testSelectedServers, verifySelectedCodexSessions, deleteSelectedServers };
}

type RelayDraft = { url: string; key: string };
type RelayEditing = { serverId: string; field: "url" | "key" } | null;

type UseRemoteServerActionsOptions = {
  keyRows: KeyRow[];
  onChanged: () => Promise<void>;
  onCredentialsRequired: (server: RemoteServer) => void;
};

/** Owns a single remote server's mutations, progress state, and operation feedback. */
export function useRemoteServerActions({
  keyRows,
  onChanged,
  onCredentialsRequired,
}: UseRemoteServerActionsOptions) {
  const confirm = useConfirm();
  const { notify } = useToast();
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [relayDrafts, setRelayDrafts] = useState<Record<string, RelayDraft>>({});
  const [savingRelay, setSavingRelay] = useState<string | null>(null);
  const [editingRelay, setEditingRelay] = useState<RelayEditing>(null);
  const [deletingServer, setDeletingServer] = useState<string | null>(null);
  const [testingServer, setTestingServer] = useState<string | null>(null);
  const [verifyingSession, setVerifyingSession] = useState<string | null>(null);
  const [codexAction, setCodexAction] = useState<string | null>(null);
  const [loadingLogs, setLoadingLogs] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [syncLogs, setSyncLogs] = useState<{ server: RemoteServer; entries: RemoteSyncLog[] } | null>(null);

  const showError = (reason: unknown) => notify(errorMessage(reason), "error");
  const relayDraft = (server: RemoteServer) => relayDrafts[server.id] ?? { url: server.relayUrl ?? "", key: "" };
  const updateRelayDraft = (server: RemoteServer, patch: Partial<RelayDraft>) => {
    setRelayDrafts((current) => ({ ...current, [server.id]: { ...relayDraft(server), ...patch } }));
  };
  const cancelRelayEditing = (server: RemoteServer, field: "url" | "key") => {
    setRelayDrafts((current) => ({
      ...current,
      [server.id]: { ...relayDraft(server), [field]: field === "url" ? server.relayUrl ?? "" : "" },
    }));
    setEditingRelay(null);
  };
  const switchKey = async (server: RemoteServer, value: string) => {
    const row = keyRows.find((item) => `${item.stationId}:${item.key.id}` === value);
    if (!row) return;
    setSaving(server.id);
    try {
      if (isTauri()) await remoteApi.assignRelayKey(server.id, row.stationId, row.key.id);
      setSelection((current) => ({ ...current, [server.id]: value }));
      await onChanged();
    } catch (reason) {
      showError(reason);
    } finally {
      setSaving(null);
    }
  };
  const selectedKeyLabel = (serverId: string) => {
    const value = selection[serverId];
    const row = keyRows.find((item) => `${item.stationId}:${item.key.id}` === value);
    return row ? `${row.stationName} / ${row.key.name || row.key.id}` : "选择中转站密钥";
  };
  const saveRelay = async (server: RemoteServer) => {
    const draft = relayDraft(server);
    const savedField = editingRelay?.serverId === server.id ? editingRelay.field : null;
    setSavingRelay(server.id);
    try {
      if (isTauri()) await remoteApi.updateRelay(server.id, draft.url, draft.key || null);
      setRelayDrafts((current) => ({ ...current, [server.id]: { url: draft.url, key: "" } }));
      setEditingRelay(null);
      await onChanged();
      notify(
        savedField === "key"
          ? `服务器“${server.name}”的 API 密钥已保存。`
          : savedField === "url"
            ? `服务器“${server.name}”的中转站网址已保存。`
            : `服务器“${server.name}”的中转配置已保存。`,
        "success",
      );
    } catch (reason) {
      showError(reason);
    } finally {
      setSavingRelay(null);
    }
  };
  const deleteServer = async (server: RemoteServer) => {
    const approved = await confirm({
      title: "删除远程服务器",
      description: `确认删除服务器“${server.name}”吗？`,
      confirmLabel: "删除",
      destructive: true,
    });
    if (!approved) return;
    setDeletingServer(server.id);
    try {
      if (isTauri()) await remoteApi.remove(server.id);
      await onChanged();
    } catch (reason) {
      showError(reason);
    } finally {
      setDeletingServer(null);
    }
  };
  const testServer = async (server: RemoteServer) => {
    setTestingServer(server.id);
    setTestResult(null);
    try {
      const result = isTauri()
        ? await remoteApi.test<RemoteConnectionResult>(server.id)
        : { success: true, status: "online" as const };
      setTestResult({
        success: result.success,
        message: result.success
          ? `${server.name} SSH 连接成功`
          : `${server.name} 连接失败${result.code ? `（错误代码 ${result.code}）` : ""}${result.reason ? `：${result.reason}` : ""}`,
      });
      await onChanged();
    } catch (reason) {
      const detail = errorMessage(reason, "SSH 连接失败，请检查服务器配置后重试。");
      if (detail.includes("未找到服务器密码")) {
        onCredentialsRequired(server);
        setTestResult({ success: false, message: `${server.name} 未保存服务器密码，请重新输入后保存。` });
      } else {
        setTestResult({ success: false, message: `${server.name} 连接失败：${detail}` });
        showError(detail);
      }
    } finally {
      setTestingServer(null);
    }
  };
  const verifyCodexSession = async (server: RemoteServer) => {
    setVerifyingSession(server.id);
    setTestResult(null);
    try {
      const result = isTauri()
        ? await remoteApi.verifyCodexSession<RemoteConnectionResult>(server.id)
        : { success: true, status: "online" as const };
      setTestResult({
        success: result.success,
        message: result.success
          ? `${server.name} Codex CLI 实际会话验证成功`
          : `${server.name} Codex CLI 会话验证失败${result.reason ? `：${result.reason}` : ""}`,
      });
      await onChanged();
    } catch (reason) {
      setTestResult({ success: false, message: `${server.name} Codex CLI 会话验证失败` });
      showError(reason);
    } finally {
      setVerifyingSession(null);
    }
  };
  const cancelServerOperation = async (server: RemoteServer) => {
    try {
      if (isTauri()) await remoteApi.cancelOperation(server.id);
      setTestResult({ success: false, message: `${server.name} 的操作正在取消，当前 SSH 请求最多还会等待 20 秒。` });
    } catch (reason) {
      showError(reason);
    }
  };
  const manageCodex = async (server: RemoteServer, action: "install" | "update") => {
    setCodexAction(server.id);
    setTestResult(null);
    try {
      if (isTauri()) await remoteApi.manageCodex(server.id, action);
      await onChanged();
      setTestResult({ success: true, message: `${server.name} 的 Codex CLI 已${action === "install" ? "安装" : "更新"}并完成版本校验。` });
    } catch (reason) {
      const detail = errorMessage(reason, "Codex CLI 操作失败，请稍后重试。");
      setTestResult({ success: false, message: `${server.name} 的 Codex CLI ${action === "install" ? "安装" : "更新"}失败：${detail}` });
      showError(detail);
    } finally {
      setCodexAction(null);
    }
  };
  const showSyncLogs = async (server: RemoteServer) => {
    setLoadingLogs(server.id);
    try {
      const entries = isTauri() ? await remoteApi.syncLogs<RemoteSyncLog[]>(server.id) : [];
      setSyncLogs({ server, entries });
    } catch (reason) {
      showError(reason);
    } finally {
      setLoadingLogs(null);
    }
  };

  return {
    selection,
    setSelection,
    saving,
    setSaving,
    relayDraft,
    updateRelayDraft,
    savingRelay,
    editingRelay,
    setEditingRelay,
    cancelRelayEditing,
    switchKey,
    selectedKeyLabel,
    saveRelay,
    deletingServer,
    deleteServer,
    testingServer,
    setTestingServer,
    testServer,
    verifyingSession,
    setVerifyingSession,
    verifyCodexSession,
    cancelServerOperation,
    codexAction,
    manageCodex,
    loadingLogs,
    showSyncLogs,
    testResult,
    setTestResult,
    syncLogs,
    setSyncLogs,
  };
}
