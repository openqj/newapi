import { useState } from "react";
import { Activity, ArrowRight, Clock3, Database, DollarSign, Gauge, KeyRound, LayoutDashboard, RefreshCw, TriangleAlert, Zap } from "lucide-react";
import { ArcElement, CategoryScale, Chart as ChartJS, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip } from "chart.js";
import { Doughnut, Line } from "react-chartjs-2";
import type { AccountRow } from "../../accounts";
import type { KeyRow } from "../../api-keys";
import type { Station } from "../../stations";
import type { UsageLog, UsageSummary } from "../../usage";
import "../../../components/Sub2ApiPages.css";
import "./DashboardPage.css";

ChartJS.register(ArcElement, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip);

type DashboardView = "overview" | "keys" | "usage";
type DashboardUsageSummary = UsageSummary & { costsAreIsolated?: boolean };

const formatMoney = (value?: number) =>
  value == null ? "-" : `${value.toFixed(4)} 额度`;
const formatNumber = (value?: number) =>
  new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value ?? 0);
const formatTime = (value?: number) =>
  value
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value * 1000)
    : "尚未同步";
const todayInput = (date: Date) => date.toISOString().slice(0, 10);
const beginOfDay = (date: string) => new Date(`${date}T00:00:00`).getTime() / 1000;
const endOfDay = (date: string) => new Date(`${date}T23:59:59`).getTime() / 1000;
const compactDuration = (value?: number) => value == null ? "-" : value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`;
function DashboardStatCard({ icon, label, value, detail, tone }: { icon: React.ReactNode; label: string; value: string; detail: string; tone: string }) {
  return <article className={`sub2-dashboard-stat sub2-dashboard-stat-${tone}`}><span className="sub2-dashboard-stat-icon">{icon}</span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>;
}
export function DashboardPage({ stations, keys, accountRows, summary, usageRows, onRefresh, onNavigate }: { stations: Station[]; keys: KeyRow[]; accountRows: AccountRow[]; summary: DashboardUsageSummary; usageRows: UsageLog[]; onRefresh: () => Promise<void>; onNavigate: (view: DashboardView) => void }) {
  const [startDate, setStartDate] = useState(todayInput(new Date(Date.now() - 6 * 86_400_000)));
  const [endDate, setEndDate] = useState(todayInput(new Date()));
  const [granularity, setGranularity] = useState<"day" | "hour">("day");
  const online = stations.filter((station) => station.status === "online").length;
  const balances = accountRows.flatMap((row) => row.account.balance == null ? [] : [row.account.balance]);
  const totalBalance = balances.reduce((total, balance) => total + balance, 0);
  const latest = [...usageRows].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const records = usageRows.filter((row) => row.createdAt >= beginOfDay(startDate) && row.createdAt <= endOfDay(endDate));
  const totalTokens = records.reduce((total, row) => total + row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens, 0);
  const averageLatency = records.reduce((total, row) => total + (row.durationMs ?? 0), 0) / Math.max(1, records.filter((row) => row.durationMs != null).length);
  const modelMap = records.reduce((map, row) => {
    const model = row.model || "未知模型";
    const current = map.get(model) ?? { requests: 0, tokens: 0, cost: 0 };
    current.requests += 1;
    current.tokens += row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens;
    current.cost += row.actualCost;
    map.set(model, current);
    return map;
  }, new Map<string, { requests: number; tokens: number; cost: number }>());
  const models = [...modelMap.entries()].map(([model, value]) => ({ model, ...value })).sort((a, b) => b.tokens - a.tokens).slice(0, 8);
  const buckets = records.reduce((map, row) => {
    const date = new Date(row.createdAt * 1000);
    const key = granularity === "hour" ? `${date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" })} ${String(date.getHours()).padStart(2, "0")}:00` : date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
    map.set(key, (map.get(key) ?? 0) + row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens);
    return map;
  }, new Map<string, number>());
  const trend = [...buckets.entries()].map(([label, tokens]) => ({ label, tokens })).slice(-18);
  const setRange = (days: number) => { setStartDate(todayInput(new Date(Date.now() - (days - 1) * 86_400_000))); setEndDate(todayInput(new Date())); };
  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];
  return <div className="sub2-page sub2-dashboard-page">
    <section className="sub2-dashboard-stat-grid">
      <DashboardStatCard icon={<DollarSign size={18} />} label="余额" value={balances.length ? formatMoney(totalBalance) : "-"} detail={balances.length ? `已汇总 ${balances.length}/${stations.length} 个站点余额` : "暂无已同步的站点余额"} tone="blue" />
      <DashboardStatCard icon={<KeyRound size={18} />} label="API 密钥" value={String(keys.length)} detail={`${stations.length} 个已连接站点`} tone="emerald" />
      <DashboardStatCard icon={<Activity size={18} />} label="今日请求" value={formatNumber(summary.todayRequests)} detail={`累计 ${formatNumber(summary.totalRequests)} 次`} tone="amber" />
      <DashboardStatCard icon={<LayoutDashboard size={18} />} label="今日站点额度" value={formatMoney(summary.todaySpent)} detail={summary.costsAreIsolated ? "不同站点额度单位不汇总" : `累计 ${formatMoney(summary.totalSpent)}`} tone="purple" />
    </section>
    <section className="sub2-dashboard-stat-grid sub2-dashboard-stat-grid-secondary">
      <DashboardStatCard icon={<Database size={18} />} label="今日 Tokens" value={formatNumber((summary.todayInputTokens ?? 0) + (summary.todayOutputTokens ?? 0))} detail={`输入 ${formatNumber(summary.todayInputTokens)} / 输出 ${formatNumber(summary.todayOutputTokens)}`} tone="cyan" />
      <DashboardStatCard icon={<Database size={18} />} label="区间 Tokens" value={formatNumber(totalTokens)} detail={`${startDate} 至 ${endDate}`} tone="indigo" />
      <DashboardStatCard icon={<Gauge size={18} />} label="运行站点" value={`${online}/${stations.length}`} detail={online === stations.length ? "所有站点运行正常" : "存在需要处理的站点"} tone="violet" />
      <DashboardStatCard icon={<Clock3 size={18} />} label="平均响应" value={records.some((row) => row.durationMs != null) ? compactDuration(Math.round(averageLatency)) : "-"} detail="基于当前筛选使用记录" tone="rose" />
    </section>
    <section className="sub2-dashboard-controls">
      <div className="sub2-dashboard-date-fields"><label>开始日期<input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>结束日期<input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>
      <div className="sub2-dashboard-control-actions"><div className="sub2-quick-range"><button onClick={() => setRange(1)}>今天</button><button onClick={() => setRange(7)}>7 天</button><button onClick={() => setRange(30)}>30 天</button></div><label className="sub2-granularity">粒度<select value={granularity} onChange={(event) => setGranularity(event.target.value as "day" | "hour")}><option value="day">按天</option><option value="hour">按小时</option></select></label><button className="button-secondary" title="刷新数据" aria-label="刷新数据" onClick={() => void onRefresh()}><RefreshCw size={16} /></button></div>
    </section>
    <section className="sub2-dashboard-chart-grid">
      <article className="sub2-panel sub2-dashboard-chart-card"><div className="sub2-panel-heading"><div><h2>模型用量</h2><p>所选时间范围内的模型分布</p></div></div><div className="sub2-dashboard-distribution">{models.length ? <div className="sub2-dashboard-doughnut"><Doughnut data={{ labels: models.map((item) => item.model), datasets: [{ data: models.map((item) => item.tokens), backgroundColor: colors, borderWidth: 0 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} /></div> : <div className="sub2-dashboard-no-chart">暂无可用数据</div>}<div className="sub2-dashboard-model-table"><table><thead><tr><th>模型</th><th>请求</th><th>Tokens</th><th>实际费用</th></tr></thead><tbody>{models.map((item, index) => <tr key={item.model}><td><i style={{ background: colors[index] }} />{item.model}</td><td>{formatNumber(item.requests)}</td><td>{formatNumber(item.tokens)}</td><td>{formatMoney(item.cost)}</td></tr>)}{!models.length && <tr><td colSpan={4}>暂无使用记录</td></tr>}</tbody></table></div></div></article>
      <article className="sub2-panel sub2-dashboard-chart-card"><div className="sub2-panel-heading"><div><h2>Token 使用趋势</h2><p>{granularity === "day" ? "按天" : "按小时"}汇总</p></div></div><div className="sub2-dashboard-line">{trend.length ? <Line data={{ labels: trend.map((item) => item.label), datasets: [{ data: trend.map((item) => item.tokens), fill: true, borderColor: "#2563eb", backgroundColor: "rgba(37, 99, 235, .10)", pointRadius: 2, tension: .35 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } }, y: { beginAtZero: true, ticks: { callback: (value) => formatNumber(Number(value)) } } } }} /> : <div className="sub2-dashboard-no-chart">暂无可用数据</div>}</div></article>
    </section>
    <section className="sub2-dashboard-bottom-grid"><article className="sub2-panel sub2-dashboard-recent"><div className="sub2-panel-heading"><h2>最近使用记录</h2><span className="sub2-muted">最近 7 天</span></div><div className="sub2-dashboard-recent-list">{latest.map((row) => <div key={row.id} className="sub2-dashboard-recent-row"><span className="sub2-dashboard-recent-icon"><Zap size={18} /></span><div><strong>{row.model || "未知模型"}</strong><small>{formatTime(row.createdAt)}</small></div><div><strong>{formatMoney(row.actualCost)}</strong><small>{formatNumber(row.inputTokens + row.outputTokens)} Tokens</small></div></div>)}{!latest.length && <EmptyState message="暂无使用记录。" />}</div><button className="sub2-dashboard-link" onClick={() => onNavigate("usage")}>查看全部使用记录 <ArrowRight size={16} /></button></article><article className="sub2-panel sub2-dashboard-actions"><div className="sub2-panel-heading"><h2>快捷操作</h2></div><div><button onClick={() => onNavigate("keys")}><span className="sub2-dashboard-action-icon key"><KeyRound size={20} /></span><span><strong>创建 API 密钥</strong><small>生成并管理新的访问密钥</small></span><ArrowRight size={17} /></button><button onClick={() => onNavigate("usage")}><span className="sub2-dashboard-action-icon usage"><Activity size={20} /></span><span><strong>查看使用记录</strong><small>检查详细的调用和费用</small></span><ArrowRight size={17} /></button></div></article></section>
  </div>;
}

function EmptyState({ message }: { message: string }) { return <div className="sub2-empty"><TriangleAlert size={22} /><span>{message}</span></div>; }
