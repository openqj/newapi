import { useRef, useState } from "react";
import type React from "react";
import { Activity, ChevronLeft, ChevronRight, LayoutDashboard, RefreshCw, Settings2, Timer } from "lucide-react";
import {
  ArcElement,
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { Doughnut, Line } from "react-chartjs-2";
import { DataTable, EmptyState, PageHeader } from "../../../components/ui";
import type { Station } from "../../stations";
import type { UsageLog } from "../types";
import { type UsageColumns, UsageRecordsDesktop, UsageRecordsMobile } from "../components/UsageRecordsTable";
import "../../../components/Sub2ApiPages.css";
import { useOutsideDismiss } from "../../../lib/useOutsideDismiss";
import "./UsagePage.css";

ChartJS.register(ArcElement, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip);

const formatMoney = (value?: number) => value == null ? "-" : `${value.toFixed(4)} 额度`;
const formatNumber = (value?: number) =>
  new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value ?? 0);
const formatTime = (value?: number) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value * 1000)
    : "尚未同步";

function StatCard({ icon, label, value, note }: { icon: React.ReactNode; label: string; value: string; note: string }) {
  return <article className="sub2-stat-card"><span className="sub2-stat-icon">{icon}</span><p>{label}</p><strong>{value}</strong><small>{note}</small></article>;
}

type UsageMetric = "tokens" | "cost";
const todayInput = (date: Date) => date.toISOString().slice(0, 10);
const beginOfDay = (date: string) => new Date(`${date}T00:00:00`).getTime() / 1000;
const endOfDay = (date: string) => new Date(`${date}T23:59:59`).getTime() / 1000;
const compactDuration = (value?: number) => value == null ? "-" : value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`;
const optionValues = (values: Array<string | undefined>) => Array.from(new Set(values.filter((value): value is string => Boolean(value)))).sort();

export function UsagePage({ rows, stations, onRefresh }: { rows: UsageLog[]; stations: Station[]; onRefresh: () => Promise<void> }) {
  const now = new Date();
  const [startDate, setStartDate] = useState(todayInput(new Date(now.getTime() - 86_400_000)));
  const [endDate, setEndDate] = useState(todayInput(now));
  const [granularity, setGranularity] = useState<"hour" | "day">("hour");
  const [stationId, setStationId] = useState("all");
  const [apiKey, setApiKey] = useState("all");
  const [model, setModel] = useState("all");
  const [group, setGroup] = useState("all");
  const [requestType, setRequestType] = useState("all");
  const [billingType, setBillingType] = useState("all");
  const [billingMode, setBillingMode] = useState("all");
  const [metric, setMetric] = useState<Record<"model" | "group" | "endpoint", UsageMetric>>({ model: "tokens", group: "tokens", endpoint: "tokens" });
  const [showColumns, setShowColumns] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState<UsageColumns>({ key: true, model: true, reasoning: true, endpoint: true, ip: true, source: true, group: true, type: true, billing: true, tokens: true, cost: true, latency: true, time: true });
  const [page, setPage] = useState(1);
  useOutsideDismiss(columnMenuRef, showColumns, () => setShowColumns(false));
  const pageSize = 20;
  const filtered = rows.filter((row) => row.createdAt >= beginOfDay(startDate) && row.createdAt <= endOfDay(endDate) && (stationId === "all" || row.stationId === stationId) && (apiKey === "all" || row.apiKeyName === apiKey) && (model === "all" || row.model === model) && (group === "all" || row.groupName === group) && (requestType === "all" || row.requestType === requestType) && (billingType === "all" || row.billingType === billingType) && (billingMode === "all" || row.billingMode === billingMode));
  const totals = filtered.reduce((value, row) => ({ requests: value.requests + 1, input: value.input + row.inputTokens, output: value.output + row.outputTokens, cacheCreate: value.cacheCreate + row.cacheCreationTokens, cacheRead: value.cacheRead + row.cacheReadTokens, cost: value.cost + row.actualCost, duration: value.duration + (row.durationMs ?? 0), timed: value.timed + Number(row.durationMs != null) }), { requests: 0, input: 0, output: 0, cacheCreate: 0, cacheRead: 0, cost: 0, duration: 0, timed: 0 });
  const totalTokens = totals.input + totals.output + totals.cacheCreate + totals.cacheRead;
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const activePage = Math.min(page, pages);
  const pageRows = filtered.slice((activePage - 1) * pageSize, activePage * pageSize);
  const reset = () => { setStationId("all"); setApiKey("all"); setModel("all"); setGroup("all"); setRequestType("all"); setBillingType("all"); setBillingMode("all"); setPage(1); };
  const exportCsv = () => {
    const headings = ["API 密钥", "模型", "推理强度", "端点", "IP", "来源站点", "来源网址", "分组", "类型", "计费类型", "计费模式", "输入 Token", "输出 Token", "缓存创建", "缓存读取", "费用", "延迟(ms)", "时间"];
    const quote = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = filtered.map((row) => [row.apiKeyName, row.model, row.reasoningEffort, row.endpoint, row.ipAddress, row.stationName, row.stationUrl, row.groupName, row.requestType, row.billingType, row.billingMode, row.inputTokens, row.outputTokens, row.cacheCreationTokens, row.cacheReadTokens, row.actualCost, row.durationMs, formatTime(row.createdAt)].map(quote).join(","));
    const file = new Blob([`\ufeff${headings.map(quote).join(",")}\n${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(file); const link = document.createElement("a"); link.href = url; link.download = `usage_${startDate}_${endDate}.csv`; link.click(); URL.revokeObjectURL(url);
  };
  const selectProps = (value: string, setValue: (value: string) => void) => ({ value, onChange: (event: React.ChangeEvent<HTMLSelectElement>) => { setValue(event.target.value); setPage(1); } });
  return <div className="sub2-page sub2-usage-page">
    <PageHeader title="使用记录" description="按时间、来源站点及请求属性分析已同步的 API 调用。" actions={<button className="button-secondary" title="刷新" aria-label="刷新" onClick={() => void onRefresh()}><RefreshCw size={16} /></button>} />
    <section className="sub2-stat-grid sub2-usage-stat-grid"><StatCard icon={<Activity size={18} />} label="总请求数" value={formatNumber(totals.requests)} note="所选范围内" /><StatCard icon={<LayoutDashboard size={18} />} label="总 Token" value={formatNumber(totalTokens)} note={`输入 ${formatNumber(totals.input)} / 输出 ${formatNumber(totals.output)}`} /><StatCard icon={<Activity size={18} />} label="总消费" value={formatMoney(totals.cost)} note="实际消费" /><StatCard icon={<Timer size={18} />} label="平均耗时" value={compactDuration(totals.timed ? totals.duration / totals.timed : undefined)} note="有延迟记录的请求" /></section>
    <section className="sub2-panel sub2-range-bar"><div className="sub2-range-controls"><label>时间范围<input type="date" value={startDate} max={endDate} onChange={(event) => { setStartDate(event.target.value); setPage(1); }} /></label><span>至</span><label className="sr-only">结束日期<input type="date" value={endDate} min={startDate} onChange={(event) => { setEndDate(event.target.value); setPage(1); }} /></label><div className="sub2-quick-range">{[[1, "近 24 小时"], [7, "近 7 天"], [30, "近 30 天"]].map(([days, label]) => <button key={String(days)} onClick={() => { const end = new Date(); setEndDate(todayInput(end)); setStartDate(todayInput(new Date(end.getTime() - (Number(days) - 1) * 86_400_000))); setGranularity(Number(days) <= 1 ? "hour" : "day"); setPage(1); }}>{label}</button>)}</div></div><label className="sub2-granularity">粒度<select value={granularity} onChange={(event) => setGranularity(event.target.value as "hour" | "day")}><option value="hour">按小时</option><option value="day">按天</option></select></label></section>
    <section className="sub2-chart-grid"><UsageDistribution title="模型分布" rows={filtered} resolve={(row) => row.model || "未知模型"} metric={metric.model} onMetric={(value) => setMetric((current) => ({ ...current, model: value }))} /><UsageDistribution title="分组使用分布" rows={filtered} resolve={(row) => row.groupName || "未标注分组"} metric={metric.group} onMetric={(value) => setMetric((current) => ({ ...current, group: value }))} /><UsageDistribution title="端点分布" rows={filtered} resolve={(row) => row.endpoint || "未标注端点"} metric={metric.endpoint} onMetric={(value) => setMetric((current) => ({ ...current, endpoint: value }))} /><UsageTrend rows={filtered} granularity={granularity} /></section>
    <section className="sub2-panel sub2-filter-panel"><div className="sub2-filter-grid"><FilterSelect label="来源站点" {...selectProps(stationId, setStationId)}><option value="all">全部站点</option>{stations.map((station) => <option value={station.id} key={station.id}>{station.name}</option>)}</FilterSelect><FilterSelect label="API 密钥" {...selectProps(apiKey, setApiKey)}><option value="all">全部 API 密钥</option>{optionValues(rows.map((row) => row.apiKeyName)).map((value) => <option key={value}>{value}</option>)}</FilterSelect><FilterSelect label="模型" {...selectProps(model, setModel)}><option value="all">全部模型</option>{optionValues(rows.map((row) => row.model)).map((value) => <option key={value}>{value}</option>)}</FilterSelect><FilterSelect label="分组" {...selectProps(group, setGroup)}><option value="all">全部分组</option>{optionValues(rows.map((row) => row.groupName)).map((value) => <option key={value}>{value}</option>)}</FilterSelect><FilterSelect label="类型" {...selectProps(requestType, setRequestType)}><option value="all">全部类型</option>{optionValues(rows.map((row) => row.requestType)).map((value) => <option key={value}>{value}</option>)}</FilterSelect><FilterSelect label="计费类型" {...selectProps(billingType, setBillingType)}><option value="all">全部计费类型</option>{optionValues(rows.map((row) => row.billingType)).map((value) => <option key={value}>{value}</option>)}</FilterSelect><FilterSelect label="计费模式" {...selectProps(billingMode, setBillingMode)}><option value="all">全部计费模式</option>{optionValues(rows.map((row) => row.billingMode)).map((value) => <option key={value}>{value}</option>)}</FilterSelect></div><div className="sub2-filter-actions"><button className="button-secondary" title="刷新" aria-label="刷新" onClick={() => void onRefresh()}><RefreshCw size={16} /></button><button className="button-secondary" onClick={reset}>重置</button><div className="sub2-column-menu" ref={columnMenuRef}><button className="button-secondary" onClick={() => setShowColumns((value) => !value)}><Settings2 size={16} />列设置</button>{showColumns && <div className="sub2-menu">{Object.entries({ key: "API 密钥", model: "模型", reasoning: "推理强度", endpoint: "端点", ip: "IP", source: "来源", group: "分组", type: "类型", billing: "计费", tokens: "Token", cost: "费用", latency: "延迟", time: "时间" }).map(([key, label]) => <label key={key}><input type="checkbox" checked={columns[key as keyof UsageColumns]} onChange={() => setColumns((current) => ({ ...current, [key]: !current[key as keyof UsageColumns] }))} />{label}</label>)}</div>}</div><button className="button-primary" onClick={exportCsv}>导出 CSV</button></div></section>
    <DataTable className="sub2-panel sub2-table-panel" ariaLabel="使用记录" header={<div className="sub2-result-line">共 <strong>{filtered.length}</strong> 条记录</div>} isEmpty={filtered.length === 0} empty={<EmptyState message="没有符合筛选条件的使用记录。" />} desktop={<UsageRecordsDesktop rows={pageRows} columns={columns} />} mobile={<UsageRecordsMobile rows={pageRows} columns={columns} />} footer={<Pagination page={activePage} pages={pages} onChange={setPage} />} />
  </div>;
}

function FilterSelect({ label, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; children: React.ReactNode }) { return <label className="sub2-filter-select">{label}<select {...props}>{children}</select></label>; }

function UsageDistribution({ title, rows, resolve, metric, onMetric }: { title: string; rows: UsageLog[]; resolve: (row: UsageLog) => string; metric: UsageMetric; onMetric: (value: UsageMetric) => void }) {
  const values = new Map<string, { requests: number; tokens: number; cost: number }>();
  rows.forEach((row) => { const key = resolve(row); const current = values.get(key) ?? { requests: 0, tokens: 0, cost: 0 }; current.requests += 1; current.tokens += row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens; current.cost += row.actualCost; values.set(key, current); });
  const items = Array.from(values.entries()).map(([label, value]) => ({ label, ...value })).sort((a, b) => (metric === "tokens" ? b.tokens - a.tokens : b.cost - a.cost)).slice(0, 8);
  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ef4444", "#84cc16", "#ec4899"];
  return <article className="sub2-panel sub2-chart-card"><div className="sub2-panel-heading"><h2>{title}</h2><div className="sub2-chart-toggle"><button className={metric === "tokens" ? "active" : ""} onClick={() => onMetric("tokens")}>按 Token</button><button className={metric === "cost" ? "active" : ""} onClick={() => onMetric("cost")}>按实际消费</button></div></div><div className="sub2-distribution"><div className="sub2-doughnut">{items.length ? <Doughnut data={{ labels: items.map((item) => item.label), datasets: [{ data: items.map((item) => metric === "tokens" ? item.tokens : item.cost), backgroundColor: colors, borderWidth: 0, hoverOffset: 3 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, cutout: "57%" }} /> : <span>暂无数据</span>}</div><div className="sub2-breakdown"><table><thead><tr><th>项目</th><th>请求</th><th>Token</th><th>实际</th></tr></thead><tbody>{items.map((item, index) => <tr key={item.label}><td><i style={{ backgroundColor: colors[index] }} />{item.label}</td><td>{item.requests}</td><td>{formatNumber(item.tokens)}</td><td>{formatMoney(item.cost)}</td></tr>)}{!items.length && <tr><td colSpan={4}>暂无数据</td></tr>}</tbody></table></div></div></article>;
}

function UsageTrend({ rows, granularity }: { rows: UsageLog[]; granularity: "hour" | "day" }) {
  const buckets = new Map<string, { input: number; output: number; create: number; read: number }>();
  rows.forEach((row) => { const date = new Date(row.createdAt * 1000); const label = granularity === "hour" ? `${todayInput(date)} ${String(date.getHours()).padStart(2, "0")}:00` : todayInput(date); const current = buckets.get(label) ?? { input: 0, output: 0, create: 0, read: 0 }; current.input += row.inputTokens; current.output += row.outputTokens; current.create += row.cacheCreationTokens; current.read += row.cacheReadTokens; buckets.set(label, current); });
  const entries = Array.from(buckets.entries()).sort(([left], [right]) => left.localeCompare(right));
  const source = (label: string, color: string, values: (entry: { input: number; output: number; create: number; read: number }) => number) => ({ label, data: entries.map(([, value]) => values(value)), borderColor: color, backgroundColor: color, pointRadius: 2, tension: .32, fill: false });
  return <article className="sub2-panel sub2-chart-card sub2-trend-card"><div className="sub2-panel-heading"><div><h2>Token 使用趋势</h2><p>按所选粒度汇总</p></div></div><div className="sub2-trend"><Line data={{ labels: entries.map(([label]) => label), datasets: [source("Input", "#3b82f6", (value) => value.input), source("Output", "#10b981", (value) => value.output), source("Cache Creation", "#f59e0b", (value) => value.create), source("Cache Read", "#06b6d4", (value) => value.read)] }} options={{ responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, scales: { y: { beginAtZero: true, ticks: { callback: (value) => formatNumber(Number(value)) }, grid: { color: "#eef0f3" } }, x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } } }, plugins: { legend: { position: "top", labels: { usePointStyle: true, boxWidth: 8 } } } }} /></div></article>;
}

function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (value: number) => void }) {
  if (pages <= 1) return null;
  return <nav className="sub2-pagination" aria-label="分页"><button className="sub2-icon-action" disabled={page === 1} onClick={() => onChange(page - 1)}><ChevronLeft size={17} /></button><span>第 {page} / {pages} 页</span><button className="sub2-icon-action" disabled={page === pages} onClick={() => onChange(page + 1)}><ChevronRight size={17} /></button></nav>;
}
