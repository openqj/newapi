import { useState } from "react";
import { Plus, RefreshCw, Search, Server, TriangleAlert } from "lucide-react";
import { DataTable } from "../../../components/ui";
import type { Station } from "../../stations";
import type { AccountRow } from "../types";
import "../../../components/Sub2ApiPages.css";

const formatMoney = (value?: number) => value == null ? "-" : `${value.toFixed(4)} \u989d\u5ea6`;
const formatNumber = (value?: number) => new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value ?? 0);
const formatTime = (value?: number) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value * 1000) : "\u5c1a\u672a\u540c\u6b65";
const statusLabel = (value: string) => (({ online: "\u6b63\u5e38", partial: "\u90e8\u5206\u53ef\u7528", error: "\u5f02\u5e38", connecting: "\u8fde\u63a5\u4e2d" })[value] ?? value) || "\u672a\u77e5";
function StatusBadge({ status }: { status: string }) { const tone = status === "online" ? "good" : status === "error" ? "bad" : "warn"; return <span className={`sub2-status sub2-status-${tone}`}><i />{statusLabel(status)}</span>; }
function EmptyState({ message }: { message: string }) { return <div className="sub2-empty"><TriangleAlert size={22} /><span>{message}</span></div>; }

export function AccountsPage({ rows, stations, onRefresh, onOpenStation, onAdd }: { rows: AccountRow[]; stations: Station[]; onRefresh: () => Promise<void>; onOpenStation: (url: string) => Promise<void> | void; onAdd: () => void }) {
  const [query, setQuery] = useState("");
  const [station, setStation] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const filtered = rows.filter((row) =>
    (station === "all" || row.stationId === station) &&
    `${row.stationName} ${row.account.username} ${row.account.displayName} ${row.account.email ?? ""} ${row.account.group ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  const refresh = async () => {
    setRefreshing(true);
    try { await onRefresh(); }
    finally { setRefreshing(false); }
  };
  return <div className="sub2-page sub2-keys-page">
    <section className="sub2-key-page-toolbar">
      <div className="sub2-key-filters"><label className="sub2-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索站点账户、站点、邮箱或分组" /></label><select aria-label="站点筛选" value={station} onChange={(event) => setStation(event.target.value)}><option value="all">全部站点</option>{stations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></div>
      <div className="sub2-key-actions"><button className="button-secondary" title="刷新站点账户" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "sub2-spin" : ""} /><span>刷新</span></button><button className="button-primary" onClick={onAdd}><Plus size={16} />添加站点</button></div>
    </section>
    <DataTable className="sub2-panel sub2-table-panel">
      <div className="sub2-desktop-table sub2-key-data-table"><table><thead><tr><th>中转站</th><th>账户</th><th>邮箱</th><th>分组</th><th>角色</th><th>账户状态</th><th>站点余额</th><th>今日请求</th><th>总请求</th><th>同步状态</th><th>同步时间</th><th>操作</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.stationId}><td className="sub2-key-station"><strong>{row.stationName}</strong><small>{row.stationUrl}</small></td><td><strong>{row.account.displayName || row.account.username || "未命名账户"}</strong><small>{row.account.id ? `ID: ${row.account.id}` : "-"}</small></td><td>{row.account.email || "-"}</td><td>{row.account.group || "-"}</td><td>{row.account.role || "-"}</td><td>{row.account.status || "-"}</td><td>{formatMoney(row.account.balance)}</td><td>{formatNumber(row.usage.todayRequests)}</td><td>{formatNumber(row.usage.totalRequests)}</td><td><StatusBadge status={row.syncStatus} /></td><td>{formatTime(row.lastSyncedAt)}</td><td><button className="button-secondary whitespace-nowrap" onClick={() => void onOpenStation(row.stationUrl)}><Server size={15} />打开站点</button></td></tr>)}{!filtered.length && <tr><td colSpan={12}><EmptyState message="暂无已同步的站点账户。请先刷新站点。" /></td></tr>}</tbody></table></div>
      <div className="sub2-mobile-cards">{filtered.map((row) => <article className="sub2-record-card" key={row.stationId}><div><strong>{row.account.displayName || row.account.username || "未命名账户"}</strong><StatusBadge status={row.syncStatus} /></div><small>{row.stationName}</small><dl><div><dt>邮箱</dt><dd>{row.account.email || "-"}</dd></div><div><dt>分组</dt><dd>{row.account.group || "-"}</dd></div><div><dt>角色</dt><dd>{row.account.role || "-"}</dd></div><div><dt>余额</dt><dd>{formatMoney(row.account.balance)}</dd></div><div><dt>今日请求</dt><dd>{formatNumber(row.usage.todayRequests)}</dd></div></dl><div className="sub2-card-actions"><button className="button-secondary" onClick={() => void onOpenStation(row.stationUrl)}><Server size={16} />打开站点</button></div></article>)}{!filtered.length && <EmptyState message="暂无已同步的站点账户。请先刷新站点。" />}</div>
    </DataTable>
  </div>;
}

