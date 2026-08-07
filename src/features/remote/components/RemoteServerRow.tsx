import { Check, Clock3, Download, Pencil, Play, PlugZap, RefreshCw, Trash2, X } from "lucide-react";
import { Button, IconButton, SelectDropdown, TextField, type SelectDropdownOption } from "../../../components/ui";
import type { KeyRow } from "../../api-keys";
import { LOCAL_RELAY_SELECTION } from "../hooks";
import type { RemoteServer } from "../types";

export type RelayEditing = { serverId: string; field: "url" | "key" } | null;
export type RelayDraft = { url: string; key: string };

type RemoteServerRowProps = {
  server: RemoteServer;
  index: number;
  keyRows: KeyRow[];
  selected: boolean;
  selectedKeyValue: string;
  selectedKeyLabel: string;
  saving: boolean;
  savingRelay: boolean;
  testing: boolean;
  verifyingSession: boolean;
  loadingLogs: boolean;
  codexAction: boolean;
  deleting: boolean;
  editingRelay: RelayEditing;
  relayDraft: RelayDraft;
  onToggleSelected: () => void;
  onSwitchKey: (value: string) => void;
  onSwitchLocal: () => void;
  onOpenEditor: () => void;
  onTest: () => void;
  onShowLogs: () => void;
  onVerifySession: () => void;
  onCancelOperation: () => void;
  onDelete: () => void;
  onManageCodex: (action: "install" | "update") => void;
  onStartRelayEdit: (field: "url" | "key") => void;
  onCancelRelayEdit: (field: "url" | "key") => void;
  onRelayDraftChange: (patch: Partial<RelayDraft>) => void;
  onSaveRelay: () => void;
};

export function RemoteServerRow({
  server, index, keyRows, selected, selectedKeyValue, selectedKeyLabel, saving, savingRelay,
  testing, verifyingSession, loadingLogs, codexAction, deleting, editingRelay, relayDraft,
  onToggleSelected, onSwitchKey, onSwitchLocal, onOpenEditor, onTest,
  onShowLogs, onVerifySession, onCancelOperation, onDelete, onManageCodex, onStartRelayEdit,
  onCancelRelayEdit, onRelayDraftChange, onSaveRelay,
}: RemoteServerRowProps) {
  const editingUrl = editingRelay?.serverId === server.id && editingRelay.field === "url";
  const editingKey = editingRelay?.serverId === server.id && editingRelay.field === "key";
  const operationRunning = testing || saving || savingRelay || codexAction;
  const rowBusy = operationRunning || verifyingSession;
  const relayOptions: SelectDropdownOption[] = [
    { value: LOCAL_RELAY_SELECTION, label: "本地中转站 / API 密钥", searchText: "本地中转站 API 密钥" },
    ...keyRows.map((row) => ({
      value: `${row.stationId}:${row.key.id}`,
      label: `${row.stationName} · ${row.key.name || row.key.id} · ${row.key.maskedKey}`,
      searchText: `${row.stationName} ${row.key.name || row.key.id} ${row.key.maskedKey}`,
    })),
  ];

  return <tr>
    <td className="remote-config-select-cell"><input type="checkbox" aria-label={`选择 ${server.name}`} checked={selected} onChange={onToggleSelected} /></td>
    <td>{index + 1}</td>
    <td><span className={`connection-status ${server.connectionStatus ?? "warning"}`} title={server.connectionError ?? ((server.connectionStatus ?? "warning") === "online" ? "SSH 端口连接成功" : "尚未完成连接测试")} /></td>
    <td><p className="font-medium">{server.name}</p><p className="mt-1 text-xs text-slate-400">{server.username} · {server.authType === "key" ? "SSH密匙" : "密码"}</p></td>
    <td className="font-mono" title={server.hostKeyFingerprint}>{server.host}</td>
    <td className="font-mono">{server.port || 22}</td>
    <td className="truncate text-xs" title={server.privateKeyPath}>{server.authType === "key" ? (server.privateKeyPath?.split(/[/\\]/).pop() ?? "SSH key") : "Password"}</td>
    <td className="text-xs">
      {server.codexVersion ? <div className="remote-codex-version" title={server.codexLatestVersion ? `最新版本 ${server.codexLatestVersion}` : undefined}><span className="truncate">{server.codexVersion}</span>{server.codexUpdateAvailable && <Button variant="secondary" className="remote-codex-action" disabled={codexAction} onClick={() => onManageCodex("update")}><RefreshCw size={14} className={codexAction ? "animate-spin" : ""} /> 更新</Button>}</div> : <Button variant="secondary" className="remote-codex-action" disabled={codexAction} onClick={() => onManageCodex("install")}><Download size={14} className={codexAction ? "animate-spin" : ""} /> 安装</Button>}
    </td>
    <td>{editingUrl ? <div className="relay-key-input" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) onCancelRelayEdit("url"); }}><TextField className="relay-input" autoFocus value={relayDraft.url} onChange={(event) => onRelayDraftChange({ url: event.target.value })} placeholder="输入中转站地址" /><IconButton label="保存中转站地址" title="保存中转配置" disabled={savingRelay} onClick={onSaveRelay} icon={<Check size={16} />} /></div> : <Button variant="ghost" className="relay-display" onClick={() => onStartRelayEdit("url")}>{server.relayUrl ?? "未配置"}</Button>}</td>
    <td>{editingKey ? <div className="relay-key-input" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) onCancelRelayEdit("key"); }}><TextField className="relay-input" autoFocus type="password" value={relayDraft.key} onChange={(event) => onRelayDraftChange({ key: event.target.value })} placeholder={server.relayKeyMasked ? "已安全保存，输入新密钥以替换" : "输入中转站密钥"} /><IconButton label="保存 API 密钥" title="保存中转配置" disabled={savingRelay} onClick={onSaveRelay} icon={<Check size={16} />} /></div> : <Button variant="ghost" className="relay-display relay-key-display api-key-mask" onClick={() => onStartRelayEdit("key")}>{server.relayKeyMasked ?? "未配置"}</Button>}</td>
    <td><SelectDropdown
      value={selectedKeyValue}
      options={relayOptions}
      onChange={(value) => value === LOCAL_RELAY_SELECTION ? onSwitchLocal() : onSwitchKey(value)}
      ariaLabel="选择中转站密钥"
      placeholder={selectedKeyLabel}
      disabled={saving}
      className="relay-switch-dropdown"
      renderValue={() => <span className="ui-select-dropdown-value">{selectedKeyLabel}</span>}
    /></td>
    <td><div className="remote-server-row-actions">
      <Button variant="ghost" className="edit" title="管理服务器" onClick={onOpenEditor}><Pencil size={15} /><span>管理</span></Button>
      <Button variant="ghost" className="test" title="测试 SSH 连接" disabled={testing} onClick={onTest}><PlugZap size={15} className={testing ? "animate-spin" : ""} /><span>测试</span></Button>
      <Button variant="ghost" className="logs" title="同步记录" disabled={loadingLogs} onClick={onShowLogs}><Clock3 size={15} className={loadingLogs ? "animate-spin" : ""} /><span>记录</span></Button>
      <Button variant="ghost" className="verify" title="验证 Codex CLI 实际会话" disabled={verifyingSession} onClick={onVerifySession}><Play size={15} className={verifyingSession ? "animate-spin" : ""} /><span>验证</span></Button>
      {operationRunning && <Button variant="ghost" className="cancel" title="取消服务器操作" onClick={onCancelOperation}><X size={15} /><span>取消</span></Button>}
      <Button variant="ghost" className="delete" title="删除服务器" disabled={deleting || rowBusy} onClick={onDelete}><Trash2 size={15} /><span>删除</span></Button>
    </div></td>
  </tr>;
}
