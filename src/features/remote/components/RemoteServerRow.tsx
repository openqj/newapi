import { Check, ChevronDown, Clock3, Download, Pencil, Play, PlugZap, RefreshCw, Trash2, X } from "lucide-react";
import type { KeyRow } from "../../api-keys";
import type { RemoteServer } from "../types";

export type RelayEditing = { serverId: string; field: "url" | "key" } | null;
export type RelayDraft = { url: string; key: string };

type RemoteServerRowProps = {
  server: RemoteServer;
  index: number;
  keyRows: KeyRow[];
  selected: boolean;
  selectedKeyLabel: string;
  openSelection: boolean;
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
  onSelectMenuToggle: (details: HTMLDetailsElement) => void;
  onCloseSelection: () => void;
  onSwitchKey: (value: string) => void;
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
  server, index, keyRows, selected, selectedKeyLabel, openSelection, saving, savingRelay,
  testing, verifyingSession, loadingLogs, codexAction, deleting, editingRelay, relayDraft,
  onToggleSelected, onSelectMenuToggle, onCloseSelection, onSwitchKey, onOpenEditor, onTest,
  onShowLogs, onVerifySession, onCancelOperation, onDelete, onManageCodex, onStartRelayEdit,
  onCancelRelayEdit, onRelayDraftChange, onSaveRelay,
}: RemoteServerRowProps) {
  const editingUrl = editingRelay?.serverId === server.id && editingRelay.field === "url";
  const editingKey = editingRelay?.serverId === server.id && editingRelay.field === "key";
  const operationRunning = testing || verifyingSession || saving || savingRelay || codexAction;

  return <tr>
    <td className="remote-config-select-cell"><input type="checkbox" aria-label={`选择 ${server.name}`} checked={selected} onChange={onToggleSelected} /></td>
    <td>{index + 1}</td>
    <td><span className={`connection-status ${server.connectionStatus ?? "warning"}`} title={server.connectionError ?? ((server.connectionStatus ?? "warning") === "online" ? "SSH 端口连接成功" : "尚未完成连接测试")} /></td>
    <td><p className="font-medium">{server.name}</p><p className="mt-1 text-xs text-slate-400">{server.username} · {server.authType === "key" ? "SSH密匙" : "密码"}</p></td>
    <td className="font-mono" title={server.hostKeyFingerprint}>{server.host}</td>
    <td className="font-mono">{server.port || 22}</td>
    <td className="truncate text-xs" title={server.privateKeyPath}>{server.authType === "key" ? (server.privateKeyPath?.split(/[/\\]/).pop() ?? "SSH key") : "Password"}</td>
    <td className="text-xs">
      {server.codexVersion ? <div className="remote-codex-version" title={server.codexLatestVersion ? `最新版本 ${server.codexLatestVersion}` : undefined}><span className="truncate">{server.codexVersion}</span>{server.codexUpdateAvailable && <button className="button-secondary remote-codex-action" type="button" disabled={codexAction} onClick={() => onManageCodex("update")}><RefreshCw size={14} className={codexAction ? "animate-spin" : ""} /> 更新</button>}</div> : <button className="button-secondary remote-codex-action" type="button" disabled={codexAction} onClick={() => onManageCodex("install")}><Download size={14} className={codexAction ? "animate-spin" : ""} /> 安装</button>}
    </td>
    <td>{editingUrl ? <div className="relay-key-input" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) onCancelRelayEdit("url"); }}><input className="input relay-input" autoFocus value={relayDraft.url} onChange={(event) => onRelayDraftChange({ url: event.target.value })} placeholder="输入中转站地址" /><button className="icon-button" title="保存中转配置" disabled={savingRelay} onClick={onSaveRelay}><Check size={16} /></button></div> : <button className="relay-display" onClick={() => onStartRelayEdit("url")}>{server.relayUrl ?? "未配置"}</button>}</td>
    <td>{editingKey ? <div className="relay-key-input" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) onCancelRelayEdit("key"); }}><input className="input" autoFocus type="password" value={relayDraft.key} onChange={(event) => onRelayDraftChange({ key: event.target.value })} placeholder={server.relayKeyMasked ? "已安全保存，输入新密钥以替换" : "输入中转站密钥"} /><button className="icon-button" title="保存中转配置" disabled={savingRelay} onClick={onSaveRelay}><Check size={16} /></button></div> : <button className="relay-display relay-key-display api-key-mask" onClick={() => onStartRelayEdit("key")}>{server.relayKeyMasked ?? "未配置"}</button>}</td>
    <td><details className="relay-switch-select" open={openSelection} onToggle={(event) => onSelectMenuToggle(event.currentTarget)}><summary><span className="truncate">{selectedKeyLabel}</span><ChevronDown size={15} /></summary><div className="relay-switch-options" hidden>{keyRows.map((row) => <button type="button" key={`${row.stationId}:${row.key.id}`} disabled={saving} onClick={() => { onCloseSelection(); onSwitchKey(`${row.stationId}:${row.key.id}`); }}>{row.stationName} · {row.key.name || row.key.id} · {row.key.maskedKey}</button>)}{keyRows.length === 0 && <p className="relay-switch-empty">暂无本地中转站密钥</p>}</div></details></td>
    <td><div className="flex items-center gap-1">
      <button className="icon-button" type="button" title="管理服务器" onClick={onOpenEditor}><Pencil size={16} /></button>
      <button className="icon-button" type="button" title="测试 SSH 连接" disabled={testing} onClick={onTest}><PlugZap size={16} className={testing ? "animate-spin" : ""} /></button>
      <button className="icon-button" type="button" title="同步记录" disabled={loadingLogs} onClick={onShowLogs}><Clock3 size={16} className={loadingLogs ? "animate-spin" : ""} /></button>
      <button className="icon-button" type="button" title="验证 Codex CLI 实际会话" disabled={verifyingSession} onClick={onVerifySession}><Play size={16} className={verifyingSession ? "animate-spin" : ""} /></button>
      {operationRunning && <button className="icon-button text-rose-600" type="button" title="取消服务器操作" onClick={onCancelOperation}><X size={16} /></button>}
      <button className="icon-button text-rose-600" type="button" title="删除服务器" disabled={deleting || operationRunning} onClick={onDelete}><Trash2 size={16} /></button>
    </div></td>
  </tr>;
}
