import { useState } from "react";
import { ArrowDown, ArrowDownUp, ArrowUp, Columns3, RefreshCw, Search } from "lucide-react";
import { DataTable, EmptyState, StatusBadge } from "../../../components/ui";
import type { Station } from "../../stations";
import type { RateRow } from "../types";
import "../../../components/Sub2ApiPages.css";
import "../../../components/TablePage.css";
import "./RatesPage.css";

const formatTime = (value?: number) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value * 1000) : "尚未同步";
type RateTableColumn = "model" | "station" | "group" | "multiplier" | "input" | "output" | "synced";
type RateSortKey = "model" | "multiplier" | "input" | "output" | "synced";
const rateTableColumns: ReadonlyArray<{ key: RateTableColumn; label: string }> = [{ key: "model", label: "模型" }, { key: "station", label: "中转站" }, { key: "group", label: "分组" }, { key: "multiplier", label: "计费倍率" }, { key: "input", label: "输入倍率" }, { key: "output", label: "输出倍率" }, { key: "synced", label: "同步时间" }];
const isDefaultRate = (row: RateRow) => row.rate.model === "全部模型";
const rateModelLabel = (row: RateRow) => isDefaultRate(row) ? "全模型默认" : row.rate.model;
const formatRatePrice = (value?: number) => value == null ? "-" : `$${new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(value)}/M`;

export function RatesPage({ rows, stations, unavailableStationCount, onRefresh, onOpenStation }: { rows: RateRow[]; stations: Station[]; unavailableStationCount: number; onRefresh: () => Promise<void>; onOpenStation: (url: string) => void | Promise<void> }) {
  const [query, setQuery] = useState("");
  const [station, setStation] = useState("all");
  const [group, setGroup] = useState("all");
  const [sort, setSort] = useState<RateSortKey>("model");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [showColumns, setShowColumns] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [visible, setVisible] = useState<Record<RateTableColumn, boolean>>({ model: true, station: true, group: true, multiplier: true, input: true, output: true, synced: true });
  const hasSplitMultiplier = rows.some((row) => row.rate.inputMultiplier != null || row.rate.outputMultiplier != null);
  const groups = Array.from(new Set(rows.map((row) => row.rate.group))).sort((left, right) => left.localeCompare(right, "zh-CN"));
  const filtered = rows.filter((row) => (station === "all" || row.stationId === station) && (group === "all" || row.rate.group === group) && rateModelLabel(row).toLowerCase().includes(query.toLowerCase()));
  const sorted = [...filtered].sort((left, right) => {
    if (sort === "model") return Number(isDefaultRate(left)) - Number(isDefaultRate(right)) || rateModelLabel(left).localeCompare(rateModelLabel(right), "zh-CN") || left.rate.multiplier - right.rate.multiplier || left.stationName.localeCompare(right.stationName, "zh-CN");
    const leftValue = sort === "multiplier" ? left.rate.multiplier : sort === "input" ? left.rate.inputMultiplier : sort === "output" ? left.rate.outputMultiplier : left.lastSyncedAt;
    const rightValue = sort === "multiplier" ? right.rate.multiplier : sort === "input" ? right.rate.inputMultiplier : sort === "output" ? right.rate.outputMultiplier : right.lastSyncedAt;
    const compared = leftValue == null ? (rightValue == null ? 0 : 1) : rightValue == null ? -1 : leftValue - rightValue;
    return compared * (sortDirection === "asc" ? 1 : -1) || rateModelLabel(left).localeCompare(rateModelLabel(right), "zh-CN");
  });
  const tableColumns = rateTableColumns.filter(({ key }) => hasSplitMultiplier || (key !== "input" && key !== "output"));
  const hiddenColumns = tableColumns.filter(({ key }) => !visible[key]).map(({ key }) => `sub2-rate-column-hidden-${key}`).join(" ");
  const refresh = async () => { setRefreshing(true); try { await onRefresh(); } finally { setRefreshing(false); } };
  const selectSort = (key: RateSortKey) => { setSortDirection((direction) => sort === key ? (direction === "asc" ? "desc" : "asc") : "asc"); setSort(key); };
  const sortIcon = (key: RateSortKey) => sort !== key ? <ArrowDownUp size={14} /> : sortDirection === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
  const empty = <EmptyState message="没有符合筛选条件的倍率数据。" />;

  return <div className="sub2-page sub2-keys-page sub2-rates-page">
    <header className="sub2-rate-header"><div><h1>模型倍率</h1><p>已同步 {new Set(rows.map((row) => row.stationId)).size} 个站点 / {rows.length} 条记录</p></div>{unavailableStationCount > 0 && <p className="sub2-rate-unavailable">{unavailableStationCount} 个站点暂无可用倍率数据</p>}</header>
    <section className="table-page-toolbar"><div className="table-page-filters"><select aria-label="站点筛选" value={station} onChange={(event) => setStation(event.target.value)}><option value="all">全部站点</option>{stations.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><select aria-label="分组筛选" value={group} onChange={(event) => setGroup(event.target.value)}><option value="all">全部分组</option>{groups.map((item) => <option value={item} key={item}>{item}</option>)}</select><label className="sub2-search"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型" /></label><select aria-label="排序" value={sort} onChange={(event) => { setSort(event.target.value as RateSortKey); setSortDirection("asc"); }}><option value="model">模型，再按倍率从低到高</option><option value="multiplier">计费倍率从低到高</option><option value="input">输入价格从低到高</option><option value="output">输出价格从低到高</option><option value="synced">同步时间最早</option></select></div><div className="table-page-actions"><button className="button-secondary" title="刷新" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "sub2-spin" : ""} /></button><div className="sub2-column-menu"><button className="button-secondary" title="列设置" onClick={() => setShowColumns((value) => !value)}><Columns3 size={16} /><span>列设置</span></button>{showColumns && <div className="sub2-menu">{tableColumns.map(({ key, label }) => <label key={key}><input type="checkbox" checked={visible[key]} onChange={() => setVisible((current) => ({ ...current, [key]: !current[key] }))} />{label}</label>)}</div>}</div></div></section>
    <DataTable
      className="sub2-panel sub2-table-panel"
      ariaLabel="模型倍率"
      isEmpty={sorted.length === 0}
      empty={empty}
      desktop={<div className={`sub2-desktop-table table-page-data-table sub2-rate-data-table ${hiddenColumns}`}><table><thead><tr>{tableColumns.map(({ key, label }) => { const sortable = key === "multiplier" || key === "input" || key === "output"; return <th key={key} aria-sort={sort === key ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}>{sortable ? <button className="sub2-rate-sort-button" onClick={() => selectSort(key)} title={`按${label}排序`}><span>{label}</span>{sortIcon(key)}</button> : label}</th>; })}</tr></thead><tbody>{sorted.map((row) => <tr key={`${row.stationId}-${row.rate.group}-${row.rate.model}`}><td><strong>{rateModelLabel(row)}</strong></td><td><button className="sub2-rate-station" title={row.stationUrl} onClick={() => void onOpenStation(row.stationUrl)}><strong>{row.stationName}</strong><small>{row.stationUrl}</small></button></td><td><span className="sub2-request-type">{row.rate.group}</span></td><td className="sub2-rate-value">{row.rate.multiplier.toFixed(3)}x</td>{hasSplitMultiplier && <><td className="sub2-rate-value">{formatRatePrice(row.rate.inputMultiplier)}</td><td className="sub2-rate-value">{formatRatePrice(row.rate.outputMultiplier)}</td></>}<td><StatusBadge status={row.syncStatus ?? "partial"} /><small>{formatTime(row.lastSyncedAt)}</small></td></tr>)}</tbody></table></div>}
      mobile={<div className="sub2-mobile-cards">{sorted.map((row) => <article className="sub2-record-card" key={`${row.stationId}-${row.rate.group}-${row.rate.model}`}><div><strong>{rateModelLabel(row)}</strong><span className="sub2-request-type">{row.rate.group}</span></div><small>{row.stationName}</small><dl><div><dt>计费倍率</dt><dd>{row.rate.multiplier.toFixed(3)}x</dd></div>{hasSplitMultiplier && <><div><dt>输入</dt><dd>{formatRatePrice(row.rate.inputMultiplier)}</dd></div><div><dt>输出</dt><dd>{formatRatePrice(row.rate.outputMultiplier)}</dd></div></>}<div><dt>同步时间</dt><dd>{formatTime(row.lastSyncedAt)}</dd></div></dl></article>)}</div>}
    />
  </div>;
}
