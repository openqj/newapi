import { type FormEvent, useEffect, useState } from "react";
import { Ban, Check, Clipboard, Columns3, Copy, Pencil, Plus, RefreshCw, Search, Terminal, Trash2, TriangleAlert, Upload } from "lucide-react";
import { DataTable, useConfirm } from "../../../components/ui";
import { FormDialog } from "../../../components/FormDialog";
import { isTauri } from "../../../lib/platform";
import { apiKeyApi } from "../api";
import type { KeyRow } from "../types";
import type { Station } from "../../stations";
import "../../../components/Sub2ApiPages.css";

type KeyTableColumn = "station" | "name" | "apiKey" | "group" | "concurrency" | "usage" | "expires" | "status" | "created" | "actions";

const keyTableColumns: ReadonlyArray<{ key: KeyTableColumn; label: string }> = [
  { key: "station", label: "中转站" },
  { key: "name", label: "名称" },
  { key: "apiKey", label: "API 密钥" },
  { key: "group", label: "分组" },
  { key: "concurrency", label: "当前并发" },
  { key: "usage", label: "用量" },
  { key: "expires", label: "过期时间" },
  { key: "status", label: "状态" },
  { key: "created", label: "创建时间" },
  { key: "actions", label: "操作" },
];

const formatMoney = (value?: number) =>
  value == null ? "-" : `${value.toFixed(4)} 额度`;
const formatTime = (value?: number) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value * 1000)
    : "尚未同步";
const statusLabel = (value: string) =>
  (({ online: "正常", partial: "部分可用", error: "异常", connecting: "连接中" })[value] ?? value) || "未知";

function StatusBadge({ status }: { status: string }) {
  const tone = status === "online" ? "good" : status === "error" ? "bad" : "warn";
  return <span className={`sub2-status sub2-status-${tone}`}><i />{statusLabel(status)}</span>;
}

function EmptyState({ message }: { message: string }) { return <div className="sub2-empty"><TriangleAlert size={22} /><span>{message}</span></div>; }

export function ApiKeysPage({ rows, stations, onUpdated, setError }: { rows: KeyRow[]; stations: Station[]; onUpdated: () => Promise<void>; setError: (message: string) => void }) {
  const confirm = useConfirm();
  const [query, setQuery] = useState("");
  const [station, setStation] = useState("all");
  const [status, setStatus] = useState("all");
  const [showColumns, setShowColumns] = useState(false);
  const [visible, setVisible] = useState<Record<KeyTableColumn, boolean>>({ station: true, name: true, apiKey: true, group: true, concurrency: true, usage: true, expires: true, status: true, created: true, actions: true });
  const [saving, setSaving] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editor, setEditor] = useState<{ row?: KeyRow } | null>(null);
  const filtered = rows.filter((row) => {
    const active = row.key.status === "active" || row.key.status === "有效";
    return (station === "all" || row.stationId === station) && (status === "all" || (status === "active" ? active : !active)) && `${row.stationName} ${row.key.name} ${row.key.maskedKey} ${row.key.group ?? ""}`.toLowerCase().includes(query.toLowerCase());
  });
  const reveal = async (row: KeyRow) => {
    try {
      const key = await apiKeyApi.reveal(row.stationId, row.key.id);
      await navigator.clipboard.writeText(key);
      window.setTimeout(() => void navigator.clipboard.writeText(""), 30_000);
    } catch (reason) { setError(String(reason)); }
  };
  const changeGroup = async (row: KeyRow, group: string) => {
    if (group === row.key.group) return;
    const id = `${row.stationId}:${row.key.id}`;
    setSaving(id);
    try {
      if (isTauri()) await apiKeyApi.updateGroup(row.stationId, row.key.id, group);
      await onUpdated();
    } catch (reason) { setError(String(reason)); } finally { setSaving(null); }
  };
  const toggleStatus = async (row: KeyRow) => {
    const id = `${row.stationId}:${row.key.id}`;
    setSaving(id);
    try {
      await apiKeyApi.update({ stationId: row.stationId, keyId: row.key.id, status: row.key.status === "active" || row.key.status === "有效" ? "inactive" : "active" });
      await onUpdated();
    } catch (reason) { setError(String(reason)); } finally { setSaving(null); }
  };
  const importToCcSwitch = async (row: KeyRow) => {
    try { await apiKeyApi.importToCcSwitch(row.stationId, row.key.id, "codex"); }
    catch (reason) { setError(String(reason)); }
  };
  const remove = async (row: KeyRow) => {
    if (!(await confirm({ title: "删除 API 密钥", description: `确定删除“${row.key.name || row.key.id}”吗？此操作无法撤销。`, confirmLabel: "删除", destructive: true }))) return;
    try { await apiKeyApi.remove(row.stationId, row.key.id); await onUpdated(); } catch (reason) { setError(String(reason)); }
  };
  const refresh = async () => {
    setRefreshing(true);
    try { await onUpdated(); }
    finally { setRefreshing(false); }
  };
  const hiddenColumns = keyTableColumns.filter(({ key }) => !visible[key]).map(({ key }) => `sub2-key-column-hidden-${key}`).join(" ");
  return <div className="sub2-page sub2-keys-page">
    <section className="sub2-key-page-toolbar">
      <div className="sub2-key-filters"><label className="sub2-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索密钥名称、站点或分组" /></label><select aria-label="站点筛选" value={station} onChange={(event) => setStation(event.target.value)}><option value="all">全部站点</option>{stations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select aria-label="状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="active">启用</option><option value="inactive">停用</option></select></div>
      <div className="sub2-key-actions"><button className="button-secondary" title="刷新" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "sub2-spin" : ""} /></button><div className="sub2-column-menu"><button className="button-secondary" title="列设置" onClick={() => setShowColumns((value) => !value)}><Columns3 size={16} /><span>列设置</span></button>{showColumns && <div className="sub2-menu">{keyTableColumns.map(({ key, label }) => <label key={key}><input type="checkbox" checked={visible[key]} onChange={() => setVisible((value) => ({ ...value, [key]: !value[key] }))} />{label}</label>)}</div>}</div><button className="button-primary" onClick={() => setEditor({})}><Plus size={16} />新建密钥</button></div>
    </section>
    <DataTable className="sub2-panel sub2-table-panel">
      <div className={`sub2-desktop-table sub2-key-data-table ${hiddenColumns}`}><table><thead><tr><th>中转站</th><th>名称</th><th>API 密钥</th><th>分组</th><th>当前并发</th><th>用量</th><th>过期时间</th><th>状态</th><th>创建时间</th><th>操作</th></tr></thead><tbody>{filtered.map((row) => { const totalQuota = row.key.totalQuota ?? ((row.key.remainingQuota ?? 0) + (row.key.usedQuota ?? 0)); return <tr key={`${row.stationId}:${row.key.id}`}><td className="sub2-key-station"><strong>{row.stationName}</strong><small>{row.stationUrl}</small></td><td><strong>{row.key.name || "未命名密钥"}</strong></td><td><div className="sub2-key-code"><code>{row.key.maskedKey || "已隐藏"}</code><button title="复制 API 密钥" className="sub2-copy-key" onClick={() => void reveal(row)}><Copy size={15} /></button></div></td><td><select className="sub2-group-select sub2-key-group-select" value={row.key.group ?? "default"} disabled={saving === `${row.stationId}:${row.key.id}`} onChange={(event) => void changeGroup(row, event.target.value)}>{(row.groups.length ? row.groups : [{ name: row.key.group ?? "default" }]).map((group) => <option key={group.name}>{group.name}</option>)}</select></td><td><span className={`sub2-concurrency ${row.key.currentConcurrency ? "active" : ""}`}>{row.key.currentConcurrency ?? 0}</span></td><td><div className="sub2-key-usage"><div><span>今日：</span><strong>{formatMoney(row.key.todaySpent)}</strong></div><div><span>总计：</span><strong>{formatMoney(row.key.last30DaysSpent ?? row.key.usedQuota)}</strong></div>{row.key.unlimitedQuota ? <div className="sub2-key-quota"><span>额度：</span><strong>不限额</strong></div> : row.key.remainingQuota != null && <div className="sub2-key-quota"><div><span>额度：</span><strong>{formatMoney(row.key.usedQuota)} / {formatMoney(totalQuota)}</strong></div><i><b style={{ width: `${Math.min(((row.key.usedQuota ?? 0) / Math.max(0.0001, totalQuota)) * 100, 100)}%` }} /></i></div>}</div></td><td>{row.key.expiresAt ? formatTime(row.key.expiresAt) : "永不过期"}</td><td><StatusBadge status={row.key.status === "有效" || row.key.status === "active" ? "online" : "partial"} /></td><td>{formatTime(row.key.createdAt)}</td><td><div className="sub2-key-row-actions"><button className="use" title="使用密钥" onClick={() => void reveal(row)}><Terminal size={15} /><span>使用</span></button><button className="import" title="导入 CC Switch" onClick={() => void importToCcSwitch(row)}><Upload size={15} /><span>导入</span></button><button className="toggle" title={row.key.status === "有效" || row.key.status === "active" ? "停用密钥" : "启用密钥"} onClick={() => void toggleStatus(row)} disabled={saving === `${row.stationId}:${row.key.id}`}>{row.key.status === "有效" || row.key.status === "active" ? <Ban size={15} /> : <Check size={15} />}<span>{row.key.status === "有效" || row.key.status === "active" ? "停用" : "启用"}</span></button><button className="edit" title="编辑密钥" onClick={() => setEditor({ row })}><Pencil size={15} /><span>编辑</span></button><button className="delete" title="删除密钥" onClick={() => void remove(row)}><Trash2 size={15} /><span>删除</span></button></div></td></tr>})}{!filtered.length && <tr><td colSpan={10}><EmptyState message="没有符合筛选条件的 API 密钥。" /></td></tr>}</tbody></table></div>
      <div className="sub2-mobile-cards">{filtered.map((row) => <article className="sub2-record-card" key={`${row.stationId}:${row.key.id}`}><div><strong>{row.key.name || "未命名密钥"}</strong><StatusBadge status={row.key.status === "有效" || row.key.status === "active" ? "online" : "partial"} /></div><code>{row.key.maskedKey || "已隐藏"}</code><dl><div><dt>来源</dt><dd>{row.stationName}</dd></div><div><dt>网址</dt><dd>{row.stationUrl}</dd></div><div><dt>分组</dt><dd>{row.key.group || "default"}</dd></div><div><dt>今日消费</dt><dd>{formatMoney(row.key.todaySpent)}</dd></div><div><dt>额度</dt><dd>{formatMoney(row.key.remainingQuota)}</dd></div></dl><div className="sub2-card-actions"><button className="button-secondary" onClick={() => void reveal(row)}><Clipboard size={16} />复制</button><button className="button-secondary" onClick={() => setEditor({ row })}><Pencil size={16} />编辑</button><button className="sub2-icon-action sub2-danger-action" onClick={() => void remove(row)}><Trash2 size={16} /></button></div></article>)}{!filtered.length && <EmptyState message="没有符合筛选条件的 API 密钥。" />}</div>
    </DataTable>
    {editor && <ApiKeyEditor row={editor.row} rows={rows} stations={stations} onClose={() => setEditor(null)} onSaved={async () => { setEditor(null); await onUpdated(); }} setError={setError} />}
  </div>;
}

function ApiKeyEditor({ row, rows, stations, onClose, onSaved, setError }: { row?: KeyRow; rows: KeyRow[]; stations: Station[]; onClose: () => void; onSaved: () => Promise<void>; setError: (message: string) => void }) {
  const [stationId, setStationId] = useState(row?.stationId ?? stations[0]?.id ?? "");
  const [name, setName] = useState(row?.key.name ?? "");
  const [group, setGroup] = useState(row?.key.group ?? "");
  const [quota, setQuota] = useState("");
  const [expiresInDays, setExpiresInDays] = useState("");
  const initialStatus = row?.key.status === "inactive" ? "inactive" : "active";
  const [status, setStatus] = useState(initialStatus);
  const [whitelist, setWhitelist] = useState("");
  const [blacklist, setBlacklist] = useState("");
  const [customKey, setCustomKey] = useState("");
  const [useCustomKey, setUseCustomKey] = useState(false);
  const [enableIpRestriction, setEnableIpRestriction] = useState(false);
  const [enableRateLimit, setEnableRateLimit] = useState(false);
  const [rateLimit5h, setRateLimit5h] = useState("");
  const [rateLimit1d, setRateLimit1d] = useState("");
  const [rateLimit7d, setRateLimit7d] = useState("");
  const [enableExpiration, setEnableExpiration] = useState(Boolean(row?.key.expiresAt));
  const [saving, setSaving] = useState(false);
  const isNewApi = stations.find((station) => station.id === stationId)?.kind === "newapi";
  const stationRows = rows.filter((item) => item.stationId === stationId);
  const fallbackGroups = Array.from(new Set(stationRows.flatMap((item) => item.groups.map((entry) => entry.name))));
  const [groups, setGroups] = useState(fallbackGroups);

  useEffect(() => {
    let active = true;
    setGroups(fallbackGroups);
    if (!stationId || !isTauri()) return () => { active = false; };
    void apiKeyApi.groups<{ name: string }[]>(stationId)
      .then((result) => {
        if (active) setGroups(result.map((entry) => entry.name));
      })
      .catch((reason) => {
        if (active) setError(String(reason));
      });
    return () => { active = false; };
  }, [stationId, rows, setError]);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!stationId || !name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        stationId,
        keyId: row?.key.id,
        name: name.trim(),
        group: group || null,
        customKey: !row && useCustomKey ? customKey.trim() || null : null,
        quota: quota.trim() ? Number(quota) : null,
        expiresInDays: enableExpiration && expiresInDays.trim() ? Number(expiresInDays) : null,
        status: row && status === initialStatus ? null : status,
        ipWhitelist: enableIpRestriction ? whitelist.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) : null,
        ipBlacklist: enableIpRestriction ? blacklist.split(/[\n,]/).map((value) => value.trim()).filter(Boolean) : null,
        rateLimit5h: enableRateLimit && rateLimit5h.trim() ? Number(rateLimit5h) : null,
        rateLimit1d: enableRateLimit && rateLimit1d.trim() ? Number(rateLimit1d) : null,
        rateLimit7d: enableRateLimit && rateLimit7d.trim() ? Number(rateLimit7d) : null,
      };
      await apiKeyApi.save(payload, Boolean(row));
      await onSaved();
    } catch (reason) { setError(String(reason)); } finally { setSaving(false); }
  };
  const setExpirationPreset = (days: string) => { setExpiresInDays(days); setEnableExpiration(true); };
  return <FormDialog title={row ? "编辑 API 密钥" : "创建 API 密钥"} ariaLabel={row ? "编辑 API 密钥" : "创建 API 密钥"} onClose={onClose} onSubmit={submit} className="sub2-source-key-dialog" contentClassName="sub2-dialog-body" footer={<><button className="button-secondary form-dialog-cancel" type="button" onClick={onClose} disabled={saving}>取消</button><button className="button-primary form-dialog-submit" disabled={saving || !stationId || !name.trim()}>{saving ? <RefreshCw size={16} className="sub2-spin" /> : null}{row ? "保存" : "创建"}</button></>}>
    {!row && <label>来源站点<select value={stationId} disabled={saving} onChange={(event) => { setStationId(event.target.value); setGroup(""); }}>{stations.map((station) => <option value={station.id} key={station.id}>{station.name} · {station.baseUrl}</option>)}</select></label>}
    <label>密钥名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="请输入密钥名称" /></label>
    <label>分组<select value={group} onChange={(event) => setGroup(event.target.value)}><option value="">请选择分组</option>{groups.map((entry) => <option key={entry}>{entry}</option>)}</select></label>
    {!row && !isNewApi && <section className="sub2-editor-section"><ToggleRow label="自定义密钥" checked={useCustomKey} onChange={setUseCustomKey} />{useCustomKey && <><input value={customKey} onChange={(event) => setCustomKey(event.target.value)} className="sub2-mono-input" placeholder="请输入自定义密钥" /><small>至少 8 个字符，仅允许字母、数字、连字符和下划线。</small></>}</section>}
    {row && <label>状态<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">启用</option><option value="inactive">停用</option></select></label>}
    <section className="sub2-editor-section"><ToggleRow label="IP 限制" checked={enableIpRestriction} onChange={setEnableIpRestriction} />{enableIpRestriction && <div className="sub2-editor-stack"><label>IP 白名单<textarea value={whitelist} onChange={(event) => setWhitelist(event.target.value)} placeholder="每行一个 IP 地址" /></label>{!isNewApi && <label>IP 黑名单<textarea value={blacklist} onChange={(event) => setBlacklist(event.target.value)} placeholder="每行一个 IP 地址" /></label>}{isNewApi && <small>该 NewAPI 站点仅支持 IP 白名单。</small>}</div>}</section>
    <section className="sub2-editor-section"><label>额度上限<div className="sub2-money-input"><span>额度</span><input value={quota} inputMode="decimal" onChange={(event) => setQuota(event.target.value)} placeholder="0" /></div><small>填写 0 或留空表示不限制额度。</small></label>{row?.key.usedQuota != null && <div className="sub2-editor-readonly"><span>已用额度</span><strong>{formatMoney(row.key.usedQuota)} / {formatMoney((row.key.usedQuota ?? 0) + (row.key.remainingQuota ?? 0))}</strong></div>}</section>
    {!isNewApi && <section className="sub2-editor-section"><ToggleRow label="费率限制" checked={enableRateLimit} onChange={setEnableRateLimit} />{enableRateLimit && <div className="sub2-editor-rate-grid"><label>5 小时<div className="sub2-money-input"><span>额度</span><input value={rateLimit5h} inputMode="decimal" onChange={(event) => setRateLimit5h(event.target.value)} placeholder="0" /></div></label><label>1 天<div className="sub2-money-input"><span>额度</span><input value={rateLimit1d} inputMode="decimal" onChange={(event) => setRateLimit1d(event.target.value)} placeholder="0" /></div></label><label>7 天<div className="sub2-money-input"><span>额度</span><input value={rateLimit7d} inputMode="decimal" onChange={(event) => setRateLimit7d(event.target.value)} placeholder="0" /></div></label></div>}</section>}
    <section className="sub2-editor-section"><ToggleRow label="过期时间" checked={enableExpiration} onChange={setEnableExpiration} />{enableExpiration && <div className="sub2-editor-stack"><div className="sub2-expiration-presets">{["7", "30", "90"].map((days) => <button type="button" className={expiresInDays === days ? "active" : ""} onClick={() => setExpirationPreset(days)} key={days}>{days} 天</button>)}<button type="button" className={!['7', '30', '90'].includes(expiresInDays) ? "active" : ""} onClick={() => setExpiresInDays("")}>自定义</button></div><label>有效期（天）<input value={expiresInDays} inputMode="numeric" onChange={(event) => setExpiresInDays(event.target.value)} placeholder="请输入天数" /></label></div>}</section>
  </FormDialog>;
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="sub2-toggle-row"><span>{label}</span><button className={checked ? "active" : ""} type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}><i /></button></div>;
}
