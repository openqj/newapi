import { useState } from "react";
import { Pencil, Plus, RefreshCw, Search, Server, Trash2 } from "lucide-react";
import { DataTable, EmptyState, StatusBadge, useConfirm, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import type { Station } from "../../stations";
import { accountApi } from "../api";
import type { AccountRow } from "../types";
import "../../../components/Sub2ApiPages.css";
import "../../../components/TablePage.css";
import "./AccountsPage.css";

const formatMoney = (value?: number) => value == null ? "-" : `${value.toFixed(4)} 额度`;
const formatNumber = (value?: number) => new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value ?? 0);
const formatTime = (value?: number) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value * 1000) : "尚未同步";

export function AccountsPage({ rows, stations, onRefresh, onUpdated, onOpenStation, onAdd, onEdit }: { rows: AccountRow[]; stations: Station[]; onRefresh: () => Promise<void>; onUpdated: () => Promise<void>; onOpenStation: (url: string) => Promise<void> | void; onAdd: () => void; onEdit: (row: AccountRow) => void }) {
  const confirm = useConfirm();
  const { notify } = useToast();
  const [query, setQuery] = useState("");
  const [station, setStation] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const filtered = rows.filter((row) => (
    (station === "all" || row.stationId === station)
    && `${row.stationName} ${row.account.username} ${row.account.displayName} ${row.account.email ?? ""} ${row.account.group ?? ""}`.toLowerCase().includes(query.toLowerCase())
  ));
  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  const empty = <EmptyState message="暂无已同步的站点账户。请先刷新站点。" />;
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
      await onUpdated();
      notify("站点账号已删除", "success");
    } catch (reason) {
      notify(errorMessage(reason, "删除站点账号失败，请稍后重试。"), "error");
    } finally {
      setDeleting(null);
    }
  };

  return <div className="sub2-page sub2-keys-page accounts-page">
    <section className="table-page-toolbar">
      <div className="table-page-filters"><label className="sub2-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索站点账户、站点、邮箱或分组" /></label><select aria-label="站点筛选" value={station} onChange={(event) => setStation(event.target.value)}><option value="all">全部站点</option>{stations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div>
      <div className="table-page-actions"><button className="button-secondary" title="刷新站点账户" aria-label="刷新站点账户" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "sub2-spin" : ""} /></button><button className="button-primary" onClick={onAdd}><Plus size={16} />添加站点</button></div>
    </section>
    <DataTable
      className="sub2-panel sub2-table-panel"
      ariaLabel="站点账户"
      isEmpty={filtered.length === 0}
      empty={empty}
      desktop={<div className="sub2-desktop-table table-page-data-table"><table><thead><tr><th>中转站</th><th>账户</th><th>邮箱</th><th>角色</th><th>账户状态</th><th>站点余额</th><th>今日请求</th><th>总请求</th><th>同步状态</th><th>同步时间</th><th>操作</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.stationId}><td><button type="button" className="table-page-station account-station-link" title={`打开 ${row.stationName}`} onClick={() => void onOpenStation(row.stationUrl)}><strong>{row.stationName}</strong><small>{row.stationUrl}</small></button></td><td><strong className="account-name">{row.account.displayName || row.account.username || "未命名账户"}</strong></td><td>{row.account.email || "-"}</td><td>{row.account.role || "-"}</td><td>{row.account.status || "-"}</td><td><span className={`account-balance${row.account.balance == null ? " missing" : ""}`}>{formatMoney(row.account.balance)}</span></td><td>{formatNumber(row.usage.todayRequests)}</td><td>{formatNumber(row.usage.totalRequests)}</td><td><StatusBadge status={row.syncStatus} /></td><td>{formatTime(row.lastSyncedAt)}</td><td><div className="account-row-actions"><button type="button" className="edit" title="编辑站点账号" onClick={() => onEdit(row)}><Pencil size={15} /><span>编辑</span></button><button type="button" className="delete" title="删除站点账号" disabled={deleting === row.stationId} onClick={() => void remove(row)}><Trash2 size={15} /><span>删除</span></button></div></td></tr>)}</tbody></table></div>}
      mobile={<div className="sub2-mobile-cards">{filtered.map((row) => <article className="sub2-record-card" key={row.stationId}><div><strong>{row.account.displayName || row.account.username || "未命名账户"}</strong><StatusBadge status={row.syncStatus} /></div><small>{row.stationName}</small><dl><div><dt>邮箱</dt><dd>{row.account.email || "-"}</dd></div><div><dt>角色</dt><dd>{row.account.role || "-"}</dd></div><div><dt>余额</dt><dd><span className={`account-balance${row.account.balance == null ? " missing" : ""}`}>{formatMoney(row.account.balance)}</span></dd></div><div><dt>今日请求</dt><dd>{formatNumber(row.usage.todayRequests)}</dd></div></dl><div className="sub2-card-actions"><button className="button-secondary" onClick={() => void onOpenStation(row.stationUrl)}><Server size={16} />打开站点</button><button className="button-secondary" onClick={() => onEdit(row)}><Pencil size={16} />编辑</button><button type="button" className="sub2-icon-action sub2-danger-action" aria-label="删除站点账号" disabled={deleting === row.stationId} onClick={() => void remove(row)}><Trash2 size={16} /></button></div></article>)}</div>}
    />
  </div>;
}
