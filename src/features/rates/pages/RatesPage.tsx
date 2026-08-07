import { useState } from "react";
import { ArrowUpDown, RefreshCw, Search } from "lucide-react";
import { Button, ColumnVisibilityMenu, DataTable, EmptyState, IconButton, SelectField, StatusBadge } from "../../../components/ui";
import type { Station } from "../../stations";
import type { RateRow } from "../types";
import "../../../components/Sub2ApiPages.css";
import "../../../components/TablePage.css";
import { presentGroup } from "../../../lib/groupPresentation";
import "./RatesPage.css";

const groupPresentation = (row: RateRow) => presentGroup({ name: row.rate.group, description: row.rate.groupDescription });

const formatTime = (value?: number) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value * 1000) : "尚未同步";
type RateTableColumn = "station" | "group" | "multiplier" | "input" | "output" | "synced";
const rateTableColumns: ReadonlyArray<{ key: RateTableColumn; label: string }> = [{ key: "station", label: "中转站" }, { key: "group", label: "分组" }, { key: "multiplier", label: "计费倍率" }, { key: "input", label: "输入倍率" }, { key: "output", label: "输出倍率" }, { key: "synced", label: "同步时间" }];
const formatRatePrice = (value?: number) => value == null ? "-" : `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value)}/M`;

export function RatesPage({ rows, stations, unavailableStationCount, onRefresh, onOpenStation }: { rows: RateRow[]; stations: Station[]; unavailableStationCount: number; onRefresh: () => Promise<void>; onOpenStation: (url: string) => void | Promise<void> }) {
  const [query, setQuery] = useState("");
  const [station, setStation] = useState("all");
  const [group, setGroup] = useState("all");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [showColumns, setShowColumns] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [visible, setVisible] = useState<Record<RateTableColumn, boolean>>({ station: true, group: true, multiplier: true, input: true, output: true, synced: true });
  const hasSplitMultiplier = rows.some((row) => row.rate.inputMultiplier != null || row.rate.outputMultiplier != null);
  const groups = Array.from(new Set(rows.map((row) => row.rate.group))).sort((left, right) => left.localeCompare(right, "zh-CN"));
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = rows.filter((row) => (station === "all" || row.stationId === station) && (group === "all" || row.rate.group === group) && `${row.rate.group} ${row.rate.groupDescription ?? ""}`.toLowerCase().includes(normalizedQuery));
  const sorted = [...filtered].sort((left, right) => (left.rate.multiplier - right.rate.multiplier) * (sortDirection === "asc" ? 1 : -1) || left.rate.group.localeCompare(right.rate.group, "zh-CN") || left.stationName.localeCompare(right.stationName, "zh-CN")).map((row) => {
    const presentation = groupPresentation(row);
    return presentation.name === row.rate.group && presentation.description === row.rate.groupDescription
      ? row
      : { ...row, rate: { ...row.rate, group: presentation.name, groupDescription: presentation.description } };
  });
  const tableColumns = rateTableColumns.filter(({ key }) => hasSplitMultiplier || (key !== "input" && key !== "output"));
  const hiddenColumns = tableColumns.filter(({ key }) => !visible[key]).map(({ key }) => `sub2-rate-column-hidden-${key}`).join(" ");
  const refresh = async () => { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } };
  const selectSort = () => setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
  const sortIcon = <ArrowUpDown size={14} aria-hidden="true" />;
  const empty = <EmptyState message="没有符合筛选条件的倍率数据。" />;

  return <div className="sub2-page sub2-keys-page sub2-rates-page">
    <header className="sub2-rate-header"><div><h1>分组倍率</h1><p>已同步 {new Set(rows.map((row) => row.stationId)).size} 个站点 / {rows.length} 条记录</p></div>{unavailableStationCount > 0 && <p className="sub2-rate-unavailable">{unavailableStationCount} 个站点暂无可用倍率数据</p>}</header>
    <section className="table-page-toolbar"><div className="table-page-filters"><SelectField aria-label="站点筛选" value={station} onChange={(event) => setStation(event.target.value)}><option value="all">全部站点</option>{stations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</SelectField><SelectField aria-label="分组筛选" value={group} onChange={(event) => setGroup(event.target.value)}><option value="all">全部分组</option>{groups.map((item) => <option value={item} key={item}>{item}</option>)}</SelectField><label className="sub2-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索分组" /></label><SelectField aria-label="排序" value={sortDirection} onChange={(event) => setSortDirection(event.target.value as "asc" | "desc")}><option value="asc">计费倍率从低到高</option><option value="desc">计费倍率从高到低</option></SelectField></div><div className="table-page-actions"><IconButton variant="secondary" label="刷新" onClick={() => void refresh()} disabled={refreshing} icon={<RefreshCw size={16} className={refreshing ? "sub2-spin" : ""} />} /><ColumnVisibilityMenu columns={tableColumns} visible={visible} open={showColumns} onOpenChange={setShowColumns} onToggle={(key) => setVisible((current) => ({ ...current, [key]: !current[key] }))} /></div></section>
    <DataTable
      className="sub2-panel sub2-table-panel"
      ariaLabel="分组倍率"
      isEmpty={sorted.length === 0}
      empty={empty}
      desktop={<div className={`sub2-desktop-table table-page-data-table sub2-rate-data-table ${hiddenColumns}`}><table><thead><tr>{tableColumns.map(({ key, label }) => <th key={key} aria-sort={key === "multiplier" ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}>{key === "multiplier" ? <Button variant="ghost" className="sub2-rate-sort-button" onClick={selectSort} title="按计费倍率排序"><span>{label}</span>{sortIcon}</Button> : label}</th>)}</tr></thead><tbody>{sorted.map((row) => <tr key={`${row.stationId}-${row.rate.group}-${row.rate.model}`}><td><Button variant="ghost" className="sub2-rate-station" title={row.stationUrl} onClick={() => void onOpenStation(row.stationUrl)}><strong>{row.stationName}</strong><small>{row.stationUrl}</small></Button></td><td><div className="sub2-rate-group"><span className="sub2-request-type">{row.rate.group}</span>{row.rate.groupDescription && <small title={row.rate.groupDescription}>{row.rate.groupDescription}</small>}</div></td><td className="sub2-rate-value">{row.rate.multiplier.toFixed(3)}x</td>{hasSplitMultiplier && <><td className="sub2-rate-value">{formatRatePrice(row.rate.inputMultiplier)}</td><td className="sub2-rate-value">{formatRatePrice(row.rate.outputMultiplier)}</td></>}<td><StatusBadge status={row.syncStatus ?? "partial"} /><small>{formatTime(row.lastSyncedAt)}</small></td></tr>)}</tbody></table></div>}
      mobile={<div className="sub2-mobile-cards">{sorted.map((row) => <article className="sub2-record-card" key={`${row.stationId}-${row.rate.group}-${row.rate.model}`}><div className="sub2-rate-group"><span className="sub2-request-type">{row.rate.group}</span>{row.rate.groupDescription && <small title={row.rate.groupDescription}>{row.rate.groupDescription}</small>}</div><small>{row.stationName}</small><dl><div><dt>计费倍率</dt><dd>{row.rate.multiplier.toFixed(3)}x</dd></div>{hasSplitMultiplier && <><div><dt>输入</dt><dd>{formatRatePrice(row.rate.inputMultiplier)}</dd></div><div><dt>输出</dt><dd>{formatRatePrice(row.rate.outputMultiplier)}</dd></div></>}<div><dt>同步时间</dt><dd>{formatTime(row.lastSyncedAt)}</dd></div></dl></article>)}</div>}
    />
  </div>;
}
