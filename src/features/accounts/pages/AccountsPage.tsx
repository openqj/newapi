import { type FormEvent, useEffect, useState } from "react";
import { Pencil, Plus, RefreshCw, Search, Server, TicketCheck, Trash2 } from "lucide-react";
import { DataTable, EmptyState, FormDialog, FormField, StatusBadge, TextField, useConfirm, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import type { Station } from "../../stations";
import { accountApi } from "../api";
import type { AccountRow } from "../types";
import "../../../components/Sub2ApiPages.css";
import "../../../components/TablePage.css";
import "./AccountsPage.css";

const formatMoney = (value?: number) => value == null ? "-" : `${value.toFixed(4)} 元`;
const formatNumber = (value?: number) => new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value ?? 0);
const formatTime = (value?: number) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value * 1000) : "尚未同步";

export function AccountsPage({
  rows,
  stations,
  onRefresh,
  onUpdated,
  onRefreshStation,
  onOpenStation,
  onAdd,
  onEdit,
  autoRedeemStationId,
  onAutoRedeemOpened,
}: {
  rows: AccountRow[];
  stations: Station[];
  onRefresh: () => Promise<void>;
  onUpdated: () => Promise<void>;
  onRefreshStation: (stationId: string) => Promise<void>;
  onOpenStation: (url: string) => Promise<void> | void;
  onAdd: () => void;
  onEdit: (row: AccountRow) => void;
  autoRedeemStationId?: string | null;
  onAutoRedeemOpened?: () => void;
}) {
  const confirm = useConfirm();
  const { notify } = useToast();
  const [query, setQuery] = useState("");
  const [station, setStation] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingStationId, setRefreshingStationId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [redeemRow, setRedeemRow] = useState<AccountRow | null>(null);
  useEffect(() => {
    if (!autoRedeemStationId) return;
    const row = rows.find((item) => item.stationId === autoRedeemStationId);
    if (!row) return;
    setRedeemRow(row);
    onAutoRedeemOpened?.();
  }, [autoRedeemStationId, onAutoRedeemOpened, rows]);
  const filtered = rows.filter((row) => (
    (station === "all" || row.stationId === station)
    && `${row.stationName} ${row.account.username} ${row.account.displayName} ${row.account.email ?? ""} ${row.account.group ?? ""}`.toLowerCase().includes(query.toLowerCase())
  ));
  const allFilteredSelected = filtered.length > 0 && filtered.every((row) => selectedIds.includes(row.stationId));
  const selectedRows = rows.filter((row) => selectedIds.includes(row.stationId));
  const toggleSelected = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  };
  const toggleAllSelected = () => {
    const visibleIds = filtered.map((row) => row.stationId);
    setSelectedIds((current) => allFilteredSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : [...new Set([...current, ...visibleIds])]);
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  const refreshLogin = async (row: AccountRow) => {
    if (refreshingStationId) return;
    setRefreshingStationId(row.stationId);
    try {
      await onRefreshStation(row.stationId);
      notify(`${row.stationName} 登录状态已刷新`, "success");
    } catch (reason) {
      notify(errorMessage(reason, "刷新站点登录状态失败，请稍后重试。"), "error");
    } finally {
      setRefreshingStationId(null);
    }
  };
  const remove = async (row: AccountRow) => {
    const approved = await confirm({
      title: "删除站点账号",
      description: `确定删除“${row.stationName}”的本地站点账号吗？这会移除本地站点记录及已保存的登录凭据。`,
      confirmLabel: "删除",
      destructive: true,
    });
    if (!approved) return;
    setDeleting(row.stationId);
    try {
      await accountApi.remove(row.stationId);
      setSelectedIds((current) => current.filter((id) => id !== row.stationId));
      await onUpdated();
      notify("站点账号已删除", "success");
    } catch (reason) {
      notify(errorMessage(reason, "删除站点账号失败，请稍后重试。"), "error");
    } finally {
      setDeleting(null);
    }
  };
  const removeSelected = async () => {
    if (!selectedRows.length || bulkDeleting || deleting) return;
    const approved = await confirm({
      title: "批量删除站点账号",
      description: `确定删除已选的 ${selectedRows.length} 个站点账号吗？这会移除本地站点记录及已保存的登录凭据。`,
      confirmLabel: "批量删除",
      destructive: true,
    });
    if (!approved) return;
    setBulkDeleting(true);
    try {
      const results = await Promise.allSettled(selectedRows.map((row) => accountApi.remove(row.stationId)));
      const failedRows = selectedRows.filter((_, index) => results[index].status === "rejected");
      const succeededIds = selectedRows.filter((_, index) => results[index].status === "fulfilled").map((row) => row.stationId);
      setSelectedIds(failedRows.map((row) => row.stationId));
      if (succeededIds.length) await onUpdated();
      if (failedRows.length) {
        notify(`${succeededIds.length} 个账号已删除，${failedRows.length} 个删除失败`, "error");
      } else {
        notify(`${succeededIds.length} 个站点账号已删除`, "success");
      }
    } catch (reason) {
      notify(errorMessage(reason, "批量删除站点账号失败，请稍后重试。"), "error");
    } finally {
      setBulkDeleting(false);
    }
  };

  return <div className="sub2-page sub2-keys-page accounts-page">
    <section className="table-page-toolbar">
      <div className="table-page-filters">
        <label className="sub2-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索站点账号、站点、邮箱或分组" /></label>
        <select aria-label="站点筛选" value={station} onChange={(event) => setStation(event.target.value)}>
          <option value="all">全部站点</option>
          {stations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
        </select>
      </div>
      <div className="table-page-actions">
        <button className="button-secondary" title="刷新站点账号" aria-label="刷新站点账号" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "sub2-spin" : ""} /></button>
        <button className="button-primary" onClick={onAdd}><Plus size={16} />添加站点</button>
      </div>
    </section>
    <div className="accounts-bulk-actions">
      <button className="button-primary" type="button" disabled={!selectedRows.length || bulkDeleting || Boolean(deleting)} onClick={() => void removeSelected()}><Trash2 size={16} />{bulkDeleting ? "删除中" : "批量删除"}</button>
    </div>
    <DataTable
      className="sub2-panel sub2-table-panel"
      ariaLabel="站点账号"
      isEmpty={filtered.length === 0}
      empty={<EmptyState message="暂无已同步的站点账号，请先刷新站点。" />}
      desktop={<div className="sub2-desktop-table table-page-data-table"><table><thead><tr>
        <th className="table-page-select-cell"><input type="checkbox" aria-label="全选站点账号" checked={allFilteredSelected} onChange={toggleAllSelected} /></th>
        <th>中转站</th><th>账户</th><th>邮箱</th><th>角色</th><th>账户状态</th><th>站点余额</th><th>今日请求</th><th>总请求</th><th>同步状态</th><th>同步时间</th><th>操作</th>
      </tr></thead><tbody>{filtered.map((row) => <tr key={row.stationId}>
        <td className="table-page-select-cell"><input type="checkbox" aria-label={`选择站点账号 ${row.stationName}`} checked={selectedIds.includes(row.stationId)} onChange={() => toggleSelected(row.stationId)} /></td>
        <td><button type="button" className="table-page-station account-station-link" title={`打开 ${row.stationName}`} onClick={() => void onOpenStation(row.stationUrl)}><strong>{row.stationName}</strong><small>{row.stationUrl}</small></button></td>
        <td><strong className="account-name">{row.account.displayName || row.account.username || "未命名账户"}</strong></td>
        <td>{row.account.email || "-"}</td><td>{row.account.role || "-"}</td><td>{row.account.status || "-"}</td>
        <td><span className={`account-balance${row.account.balance == null ? " missing" : ""}`}>{formatMoney(row.account.balance)}</span></td>
        <td>{formatNumber(row.usage.todayRequests)}</td><td>{formatNumber(row.usage.totalRequests)}</td><td><StatusBadge status={row.syncStatus} /></td><td>{formatTime(row.lastSyncedAt)}</td>
        <td><div className="account-row-actions"><button type="button" className="button-secondary" title={`刷新 ${row.stationName} 登录状态`} aria-label={`刷新 ${row.stationName} 登录状态`} disabled={refreshingStationId !== null} onClick={() => void refreshLogin(row)}><RefreshCw size={15} className={refreshingStationId === row.stationId ? "sub2-spin" : ""} /><span>刷新</span></button><button type="button" className="redeem" title="兑换额度" onClick={() => setRedeemRow(row)}><TicketCheck size={15} /><span>兑换</span></button><button type="button" className="edit" title="编辑站点账号" onClick={() => onEdit(row)}><Pencil size={15} /><span>编辑</span></button><button type="button" className="delete" title="删除站点账号" disabled={deleting === row.stationId} onClick={() => void remove(row)}><Trash2 size={15} /><span>删除</span></button></div></td>
      </tr>)}</tbody></table></div>}
      mobile={<div className="sub2-mobile-cards">{filtered.map((row) => <article className="sub2-record-card" key={row.stationId}>
        <div className="sub2-record-card-heading"><label className="table-page-mobile-select"><input type="checkbox" aria-label={`选择站点账号 ${row.stationName}`} checked={selectedIds.includes(row.stationId)} onChange={() => toggleSelected(row.stationId)} /><strong>{row.account.displayName || row.account.username || "未命名账户"}</strong></label><StatusBadge status={row.syncStatus} /></div>
        <small>{row.stationName}</small>
        <dl><div><dt>邮箱</dt><dd>{row.account.email || "-"}</dd></div><div><dt>角色</dt><dd>{row.account.role || "-"}</dd></div><div><dt>余额</dt><dd><span className={`account-balance${row.account.balance == null ? " missing" : ""}`}>{formatMoney(row.account.balance)}</span></dd></div><div><dt>今日请求</dt><dd>{formatNumber(row.usage.todayRequests)}</dd></div></dl>
        <div className="sub2-card-actions"><button type="button" className="button-secondary" title={`刷新 ${row.stationName} 登录状态`} aria-label={`刷新 ${row.stationName} 登录状态`} disabled={refreshingStationId !== null} onClick={() => void refreshLogin(row)}><RefreshCw size={16} className={refreshingStationId === row.stationId ? "sub2-spin" : ""} />刷新</button><button className="button-secondary" onClick={() => setRedeemRow(row)}><TicketCheck size={16} />兑换</button><button className="button-secondary" onClick={() => void onOpenStation(row.stationUrl)}><Server size={16} />打开站点</button><button className="button-secondary" onClick={() => onEdit(row)}><Pencil size={16} />编辑</button><button type="button" className="sub2-icon-action sub2-danger-action" aria-label="删除站点账号" disabled={deleting === row.stationId} onClick={() => void remove(row)}><Trash2 size={16} /></button></div>
      </article>)}</div>}
    />
    {redeemRow && <RedeemCodeDialog row={redeemRow} onClose={() => setRedeemRow(null)} onRedeemed={onUpdated} />}
  </div>;
}

function RedeemCodeDialog({ row, onClose, onRedeemed }: { row: AccountRow; onClose: () => void; onRedeemed: () => Promise<void> }) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    setResult(null);
    try {
      const message = await accountApi.redeem(row.stationId, code.trim());
      setResult({ type: "success", message });
      setCode("");
      await onRedeemed();
    } catch (reason) {
      setResult({ type: "error", message: errorMessage(reason, "兑换失败，请检查兑换码后重试。") });
    } finally {
      setSubmitting(false);
    }
  };
  return <FormDialog title="兑换站点额度" description={`兑换码将提交到 ${row.stationName}，成功后自动刷新账户余额。`} ariaLabel="兑换站点额度" onClose={onClose} onSubmit={submit} footer={<><button type="button" className="button-secondary" onClick={onClose} disabled={submitting}>关闭</button><button type="submit" className="button-primary" disabled={submitting || !code.trim()}>{submitting ? "兑换中" : "立即兑换"}</button></>}>
    <FormField label="兑换码" required>
      <TextField autoFocus value={code} onChange={(event) => { setCode(event.target.value); setResult(null); }} autoComplete="off" aria-invalid={result?.type === "error"} aria-describedby="redeem-code-result" placeholder="请输入兑换码" />
      <p id="redeem-code-result" className={`redeem-code-result ${result?.type ?? ""}`} aria-live="polite">{result?.message ?? " "}</p>
    </FormField>
  </FormDialog>;
}
