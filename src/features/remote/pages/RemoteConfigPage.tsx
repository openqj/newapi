import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Clock3, Download, Pencil, Play, PlugZap, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { DataTable, TableBulkActions, useConfirm } from "../../../components/ui";
import { isTauri } from "../../../lib/platform";
import type { KeyRow } from "../../api-keys";
import { remoteApi } from "../api";
import { RemoteServerDialog } from "../components/RemoteServerDialog";
import { RemoteSyncLogDialog } from "../components/RemoteSyncLogDialog";
import { RemoteTestNotice } from "../components/RemoteTestNotice";
import type { RemoteConnectionResult, RemoteServer, RemoteSyncLog } from "../types";

export function RemoteConfigPage({
  servers,
  keyRows,
  onChanged,
  setError,
}: {
  servers: RemoteServer[];
  keyRows: KeyRow[];
  onChanged: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const confirm = useConfirm();
  const [showAdd, setShowAdd] = useState(false);
  const [editingServer, setEditingServer] = useState<RemoteServer | null>(null);
  const [deletingServer, setDeletingServer] = useState<string | null>(null);
  const [testingServer, setTestingServer] = useState<string | null>(null);
  const [verifyingSession, setVerifyingSession] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [syncLogs, setSyncLogs] = useState<{ server: RemoteServer; entries: RemoteSyncLog[] } | null>(null);
  const [loadingLogs, setLoadingLogs] = useState<string | null>(null);
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [bulkSelection, setBulkSelection] = useState("");
  const [bulkAction, setBulkAction] = useState<"switch" | "test" | "delete" | null>(null);
  const [openSelection, setOpenSelection] = useState<string | null>(null);
  const [selectionMenuPosition, setSelectionMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const openSelectionAnchorRef = useRef<HTMLElement | null>(null);
  const selectionMenuRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [relayDrafts, setRelayDrafts] = useState<Record<string, { url: string; key: string }>>({});
  const [savingRelay, setSavingRelay] = useState<string | null>(null);
  const [codexAction, setCodexAction] = useState<string | null>(null);
  const [editingRelay, setEditingRelay] = useState<{ serverId: string; field: "url" | "key" } | null>(null);
  useEffect(() => {
    if (!openSelection) return;
    const closeSelection = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !openSelectionAnchorRef.current?.contains(target) &&
        !selectionMenuRef.current?.contains(target)
      ) {
        setOpenSelection(null);
        setSelectionMenuPosition(null);
      }
    };
    document.addEventListener("mousedown", closeSelection);
    return () => document.removeEventListener("mousedown", closeSelection);
  }, [openSelection]);
  const relayDraft = (server: RemoteServer) => relayDrafts[server.id] ?? { url: server.relayUrl ?? "", key: "" };
  const updateRelayDraft = (server: RemoteServer, patch: Partial<{ url: string; key: string }>) => setRelayDrafts((current) => ({ ...current, [server.id]: { ...relayDraft(server), ...patch } }));
  const cancelRelayEditing = (server: RemoteServer, field: "url" | "key") => { setRelayDrafts((current) => ({ ...current, [server.id]: { ...relayDraft(server), [field]: field === "url" ? server.relayUrl ?? "" : "" } })); setEditingRelay(null); };
  const switchKey = async (server: RemoteServer, value: string) => {
    const row = keyRows.find(
      (item) => `${item.stationId}:${item.key.id}` === value,
    );
    if (!row) return;
    setSaving(server.id);
    try {
      if (isTauri())
        await remoteApi.assignRelayKey(server.id, row.stationId, row.key.id);
      setSelection((current) => ({ ...current, [server.id]: value }));
      await onChanged();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(null);
    }
  };
  const selectedKeyLabel = (serverId: string) => {
    const value = selection[serverId];
    const row = keyRows.find(
      (item) => `${item.stationId}:${item.key.id}` === value,
    );
    return row
      ? `${row.stationName} / ${row.key.name || row.key.id}`
      : "选择中转站密钥";
  };
  const selectedServers = servers.filter((server) => selectedServerIds.includes(server.id));
  const toggleServerSelection = (id: string) => {
    setSelectedServerIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };
  const toggleAllServers = () => {
    setSelectedServerIds((current) =>
      current.length === servers.length ? [] : servers.map((server) => server.id),
    );
  };
  const switchSelectedServers = async () => {
    const key = keyRows.find((row) => `${row.stationId}:${row.key.id}` === bulkSelection);
    if (!key || selectedServers.length === 0) return;
    setBulkAction("switch");
    const failures: string[] = [];
    try {
      for (const server of selectedServers) {
        try {
          setSaving(server.id);
          if (isTauri()) await remoteApi.assignRelayKey(server.id, key.stationId, key.key.id);
          setSelection((current) => ({ ...current, [server.id]: bulkSelection }));
        } catch (reason) {
          failures.push(server.name);
        } finally {
          setSaving(null);
        }
      }
      await onChanged();
      setTestResult({ success: failures.length === 0, message: failures.length === 0 ? `已切换 ${selectedServers.length} 台服务器的中转站密钥` : `${failures.length} 台服务器切换失败：${failures.join("、")}` });
    } finally {
      setBulkAction(null);
    }
  };
  const testSelectedServers = async () => {
    if (selectedServers.length === 0) return;
    setBulkAction("test");
    const failures: string[] = [];
    try {
      for (const server of selectedServers) {
        try {
          setTestingServer(server.id);
          const result = isTauri() ? await remoteApi.test<RemoteConnectionResult>(server.id) : { success: true };
          if (!result.success) failures.push(server.name);
        } catch (reason) {
          failures.push(server.name);
        } finally {
          setTestingServer(null);
        }
      }
      await onChanged();
      setTestResult({ success: failures.length === 0, message: failures.length === 0 ? `${selectedServers.length} 台服务器 SSH 连接成功` : `${failures.length} 台服务器连接失败：${failures.join("、")}` });
    } finally {
      setBulkAction(null);
    }
  };
  const deleteSelectedServers = async () => {
    if (selectedServers.length === 0 || !(await confirm({ title: "删除远程服务器", description: `确认删除选中的 ${selectedServers.length} 台服务器吗？`, confirmLabel: "删除", destructive: true }))) return;
    setBulkAction("delete");
    const failures: string[] = [];
    try {
      for (const server of selectedServers) {
        try {
          if (isTauri()) await remoteApi.remove(server.id);
        } catch (reason) {
          failures.push(server.id);
        }
      }
      await onChanged();
      setSelectedServerIds(failures);
      setTestResult({ success: failures.length === 0, message: failures.length === 0 ? `已删除 ${selectedServers.length} 台服务器` : `${failures.length} 台服务器删除失败` });
    } finally {
      setBulkAction(null);
    }
  };
  const saveRelay = async (server: RemoteServer) => {
    const draft = relayDraft(server); setSavingRelay(server.id);
    try {
      if (isTauri()) await remoteApi.updateRelay(server.id, draft.url, draft.key || null);
      setRelayDrafts((current) => ({ ...current, [server.id]: { url: draft.url, key: "" } })); setEditingRelay(null); await onChanged();
    } catch (reason) { setError(String(reason)); }
    finally { setSavingRelay(null); }
  };
  const deleteServer = async (server: RemoteServer) => {
    if (!(await confirm({ title: "删除远程服务器", description: `确认删除服务器“${server.name}”吗？`, confirmLabel: "删除", destructive: true }))) return;
    setDeletingServer(server.id);
    try {
      if (isTauri()) await remoteApi.remove(server.id);
      await onChanged();
    } catch (reason) {
      setError(String(reason));
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
      const message = String(reason);
      if (message.includes("未找到服务器密码")) {
        setEditingServer(server);
        setTestResult({ success: false, message: `${server.name} 未保存服务器密码，请重新输入后保存` });
      } else {
        setTestResult({ success: false, message: `${server.name} 连接失败：${message}` });
        setError(message);
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
      setError(String(reason));
    } finally {
      setVerifyingSession(null);
    }
  };
  const cancelServerOperation = async (server: RemoteServer) => {
    try {
      if (isTauri()) await remoteApi.cancelOperation(server.id);
      setTestResult({ success: false, message: `${server.name} 的操作正在取消，当前 SSH 请求最多还会等待 20 秒。` });
    } catch (reason) {
      setError(String(reason));
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
      const message = String(reason);
      setTestResult({ success: false, message: `${server.name} 的 Codex CLI ${action === "install" ? "安装" : "更新"}失败：${message}` });
      setError(message);
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
      setError(String(reason));
    } finally {
      setLoadingLogs(null);
    }
  };
  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm text-slate-500">服务器连接与中转路由</p>
          <h1 className="mt-1 text-2xl font-semibold">远程配置</h1>
        </div>
        <button className="button-primary" onClick={() => setShowAdd(true)}>
          <Plus size={16} />
          添加服务器
        </button>
      </div>
      {selectedServers.length > 0 && (
        <TableBulkActions summary={`${selectedServers.length} 台已选`}>
          <select
            className="input remote-bulk-key-select"
            aria-label="选择批量切换的中转站密钥"
            value={bulkSelection}
            onChange={(event) => setBulkSelection(event.target.value)}
            disabled={bulkAction !== null}
          >
            <option value="">选择中转站密钥</option>
            {keyRows.map((row) => (
              <option key={`${row.stationId}:${row.key.id}`} value={`${row.stationId}:${row.key.id}`}>
                {row.stationName} · {row.key.name || row.key.id}
              </option>
            ))}
          </select>
          <button className="button-secondary" type="button" disabled={!bulkSelection || bulkAction !== null} onClick={() => void switchSelectedServers()}>
            <RefreshCw size={16} className={bulkAction === "switch" ? "animate-spin" : ""} />
            一键切换
          </button>
          <button className="button-secondary" type="button" disabled={bulkAction !== null} onClick={() => void testSelectedServers()}>
            <PlugZap size={16} className={bulkAction === "test" ? "animate-spin" : ""} />
            一键测试
          </button>
          <button className="button-secondary" type="button" disabled={bulkAction !== null} onClick={() => void deleteSelectedServers()}>
            <Trash2 size={16} className={bulkAction === "delete" ? "animate-spin" : ""} />
            删除
          </button>
        </TableBulkActions>
      )}
      <DataTable className="mt-5">
        <table className="remote-config-table">
          <colgroup>
            <col className="remote-config-select-column" />
            <col className="remote-config-id-column" />
            <col className="remote-config-status-column" />
            <col span={8} />
            <col className="remote-config-actions-column" />
          </colgroup>
          <thead>
            <tr>
              <th className="remote-config-select-cell">
                <input
                  type="checkbox"
                  aria-label="全选远程服务器"
                  checked={servers.length > 0 && selectedServers.length === servers.length}
                  onChange={toggleAllServers}
                />
              </th>
              <th>ID</th>
              <th>状态</th>
              <th>别名</th>
              <th>主机</th>
              <th>端口</th>
              <th>身份文件</th>
              <th>版本</th>
              <th>中转站地址</th>
              <th>中转站密钥</th>
              <th>一键切换</th>
              <th>管理</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((server, index) => (
              <tr key={server.id}>
                <td className="remote-config-select-cell">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${server.name}`}
                    checked={selectedServerIds.includes(server.id)}
                    onChange={() => toggleServerSelection(server.id)}
                  />
                </td>
                <td>{index + 1}</td>
                <td>
                  <span
                    className={`connection-status ${server.connectionStatus ?? "warning"}`}
                    title={
                      server.connectionError ??
                      ((server.connectionStatus ?? "warning") === "online"
                        ? "SSH 端口连接成功"
                        : "尚未完成连接测试")
                    }
                  />
                </td>
                <td>
                  <p className="font-medium">{server.name}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {server.username} ·{" "}
                    {server.authType === "key" ? "SSH密匙" : "密码"}
                  </p>
                </td>
                <td className="font-mono" title={server.hostKeyFingerprint}>{server.host}</td>
                <td className="font-mono">{server.port || 22}</td>
                <td className="truncate text-xs" title={server.privateKeyPath}>{server.authType === "key" ? (server.privateKeyPath?.split(/[/\\]/).pop() ?? "SSH key") : "Password"}</td>
                <td className="text-xs">
                  {server.codexVersion ? (
                    <div className="remote-codex-version" title={server.codexLatestVersion ? `最新版本 ${server.codexLatestVersion}` : undefined}>
                      <span className="truncate">{server.codexVersion}</span>
                      {server.codexUpdateAvailable && <button className="button-secondary remote-codex-action" type="button" disabled={codexAction === server.id} onClick={() => void manageCodex(server, "update")}>
                        <RefreshCw size={14} className={codexAction === server.id ? "animate-spin" : ""} /> 更新
                      </button>}
                    </div>
                  ) : (
                    <button className="button-secondary remote-codex-action" type="button" disabled={codexAction === server.id} onClick={() => void manageCodex(server, "install")}>
                      <Download size={14} className={codexAction === server.id ? "animate-spin" : ""} /> 安装
                    </button>
                  )}
                </td>
                <td>{editingRelay?.serverId === server.id && editingRelay.field === "url" ? <div className="relay-key-input" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) cancelRelayEditing(server, "url"); }}><input className="input relay-input" autoFocus value={relayDraft(server).url} onChange={(event) => updateRelayDraft(server, { url: event.target.value })} placeholder="输入中转站地址" /><button className="icon-button" title="保存中转配置" disabled={savingRelay === server.id} onClick={() => void saveRelay(server)}><Check size={16} /></button></div> : <button className="relay-display" onClick={() => setEditingRelay({ serverId: server.id, field: "url" })}>{server.relayUrl ?? "未配置"}</button>}</td>
                <td>{editingRelay?.serverId === server.id && editingRelay.field === "key" ? <div className="relay-key-input" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) cancelRelayEditing(server, "key"); }}><input className="input" autoFocus type="password" value={relayDraft(server).key} onChange={(event) => updateRelayDraft(server, { key: event.target.value })} placeholder={server.relayKeyMasked ? "已安全保存，输入新密钥以替换" : "输入中转站密钥"} /><button className="icon-button" title="保存中转配置" disabled={savingRelay === server.id} onClick={() => void saveRelay(server)}><Check size={16} /></button></div> : <button className="relay-display relay-key-display api-key-mask" onClick={() => setEditingRelay({ serverId: server.id, field: "key" })}>{server.relayKeyMasked ?? "未配置"}</button>}</td>
                <td>
                  <details
                    className="relay-switch-select"
                    open={openSelection === server.id}
                    onToggle={(event) => {
                      const details = event.currentTarget;
                      if (!details.open) {
                        setOpenSelection(null);
                        setSelectionMenuPosition(null);
                        return;
                      }
                      const { bottom, left, width } = details.getBoundingClientRect();
                      openSelectionAnchorRef.current = details;
                      setSelectionMenuPosition({ top: bottom + 1, left, width });
                      setOpenSelection(server.id);
                    }}
                  >
                    <summary>
                      <span className="truncate">
                        {selectedKeyLabel(server.id)}
                      </span>
                      <ChevronDown size={15} />
                    </summary>
                    <div className="relay-switch-options" hidden>
                      {keyRows.map((row) => (
                        <button
                          type="button"
                          key={`${row.stationId}:${row.key.id}`}
                          disabled={saving === server.id}
                          onClick={() => {
                            const value = `${row.stationId}:${row.key.id}`;
                            setOpenSelection(null);
                            void switchKey(server, value);
                          }}
                        >
                          {row.stationName} · {row.key.name || row.key.id} ·{" "}
                          {row.key.maskedKey}
                        </button>
                      ))}
                      {keyRows.length === 0 && (
                        <p className="relay-switch-empty">暂无本地中转站密钥</p>
                      )}
                    </div>
                  </details>
                </td>
                <td>
                  <div className="flex items-center gap-1">
                    <button
                      className="icon-button"
                      type="button"
                      title="管理服务器"
                      onClick={() => setEditingServer(server)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="测试 SSH 连接"
                      disabled={testingServer === server.id}
                      onClick={() => void testServer(server)}
                    >
                      <PlugZap size={16} className={testingServer === server.id ? "animate-spin" : ""} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="同步记录"
                      disabled={loadingLogs === server.id}
                      onClick={() => void showSyncLogs(server)}
                    >
                      <Clock3 size={16} className={loadingLogs === server.id ? "animate-spin" : ""} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="验证 Codex CLI 实际会话"
                      disabled={verifyingSession === server.id}
                      onClick={() => void verifyCodexSession(server)}
                    >
                      <Play size={16} className={verifyingSession === server.id ? "animate-spin" : ""} />
                    </button>
                    {(testingServer === server.id || verifyingSession === server.id || saving === server.id || savingRelay === server.id || codexAction === server.id) && (
                      <button className="icon-button text-rose-600" type="button" title="取消服务器操作" onClick={() => void cancelServerOperation(server)}>
                        <X size={16} />
                      </button>
                    )}
                    <button
                      className="icon-button text-rose-600"
                      type="button"
                      title="删除服务器"
                      disabled={deletingServer === server.id || testingServer === server.id || verifyingSession === server.id || saving === server.id || savingRelay === server.id || codexAction === server.id}
                      onClick={() => void deleteServer(server)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {servers.length === 0 && (
              <tr>
                <td colSpan={12} className="empty-cell">
                  尚未添加远程服务器。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </DataTable>
      {testResult && (
        <RemoteTestNotice
          result={testResult}
          onClose={() => setTestResult(null)}
        />
      )}
      {syncLogs && (
        <RemoteSyncLogDialog
          server={syncLogs.server}
          entries={syncLogs.entries}
          onClose={() => setSyncLogs(null)}
        />
      )}
      {openSelection && selectionMenuPosition &&
        createPortal(
          <div
            ref={selectionMenuRef}
            className="relay-switch-options"
            style={selectionMenuPosition}
          >
            {keyRows.map((row) => (
              <button
                type="button"
                key={`${row.stationId}:${row.key.id}`}
                disabled={saving === openSelection}
                onClick={() => {
                  const server = servers.find((item) => item.id === openSelection);
                  if (!server) return;
                  const value = `${row.stationId}:${row.key.id}`;
                  setOpenSelection(null);
                  setSelectionMenuPosition(null);
                  void switchKey(server, value);
                }}
              >
                {row.stationName} 路 {row.key.name || row.key.id} 路{" "}
                {row.key.maskedKey}
              </button>
            ))}
            {keyRows.length === 0 && (
              <p className="relay-switch-empty">暂无本地中转站密钥。</p>
            )}
          </div>,
          document.body,
        )}
      {showAdd && (
        <RemoteServerDialog
          onClose={() => setShowAdd(false)}
          onSaved={onChanged}
          setError={setError}
        />
      )}
      {editingServer && (
        <RemoteServerDialog
          server={editingServer}
          onClose={() => setEditingServer(null)}
          onSaved={onChanged}
          setError={setError}
        />
      )}
    </>
  );
}
