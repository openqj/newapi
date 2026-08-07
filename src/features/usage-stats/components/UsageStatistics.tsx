import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  BarChart3,
  Bot,
  CalendarDays,
  ChevronDown,
  Coins,
  Database,
  Download,
  Grid2X2,
  Info,
  Leaf,
  ListFilter,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Square,
  Trash2,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";
import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartOptions,
} from "chart.js";
import { Line } from "react-chartjs-2";
import { isTauri } from "../../../lib/platform";
import { errorMessage } from "../../../lib/errors";
import { Button, Drawer, EmptyState, IconButton, Pagination, SelectField, TextField, useToast } from "../../../components/ui";
import { localUsageApi } from "../api";
import type {
  LocalModelPricing,
  LocalUsageDashboard,
  LocalUsageLogDetail,
  LocalUsageQuery,
} from "../types";
import "./UsageStatistics.css";

ChartJS.register(CategoryScale, Filler, Legend, LinearScale, LineElement, PointElement, Tooltip);

type RangePreset = "today" | "1d" | "7d" | "14d" | "30d" | "custom";
type StatsTab = "logs" | "providers" | "models";
type AppFilter = "all" | "claude" | "codex" | "gemini" | "grokbuild" | "opencode" | "openai";

const REFRESH_OPTIONS = [0, 5_000, 10_000, 30_000, 60_000] as const;
const PAGE_SIZE = 20;
const NUMBER_FORMATTER = new Intl.NumberFormat("zh-CN");
const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
const HOURLY_TREND_FORMATTER = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit" });
const DAILY_TREND_FORMATTER = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" });
const APP_FILTERS: Array<{ id: AppFilter; label: string }> = [
  { id: "all", label: "全部来源" },
  { id: "claude", label: "Claude" },
  { id: "codex", label: "Codex" },
  { id: "gemini", label: "Gemini" },
  { id: "grokbuild", label: "Grok Build" },
  { id: "opencode", label: "OpenCode" },
  { id: "openai", label: "OpenAI" },
];

const CACHE_INCLUSIVE_APP_TYPES = new Set(["codex", "gemini", "grokbuild", "openai"]);
type CacheWriteState = "ok" | "partial" | "na";

function deriveCacheWriteState(appTypes: string[]): CacheWriteState {
  if (appTypes.length === 0) return "ok";
  const inclusiveCount = appTypes.filter((value) => CACHE_INCLUSIVE_APP_TYPES.has(value)).length;
  if (inclusiveCount === appTypes.length) return "na";
  if (inclusiveCount === 0) return "ok";
  return "partial";
}

const EMPTY_DASHBOARD: LocalUsageDashboard = {
  summary: {
    totalRequests: 0,
    totalCost: "0.000000",
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    successRate: 0,
    realTotalTokens: 0,
    cacheHitRate: 0,
  },
  trends: [],
  providerStats: [],
  modelStats: [],
  logs: [],
  totalLogs: 0,
  providers: [],
  models: [],
  appTypes: [],
};

function appIcon(app: AppFilter) {
  if (app === "all") return <Grid2X2 size={16} />;
  if (app === "claude") return <WandSparkles size={16} />;
  if (app === "codex" || app === "openai") return <Bot size={16} />;
  if (app === "gemini") return <Sparkles size={16} />;
  if (app === "grokbuild") return <Square size={15} />;
  return <Leaf size={16} />;
}

function formatNumber(value: number) {
  return NUMBER_FORMATTER.format(Math.max(0, Math.round(value)));
}

function formatCompactTokens(value: number, decimals = 1) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(decimals)} 亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(decimals)} 万`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(decimals)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(decimals)}K`;
  return formatNumber(value);
}

function formatCost(value: string | number, digits = 4) {
  const number = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(number) ? `$${number.toFixed(digits)}` : "$0.0000";
}

function formatDateTime(timestamp: number) {
  return DATE_TIME_FORMATTER.format(timestamp * 1000);
}

function formatTrendDate(value: string, hourly: boolean) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return (hourly ? HOURLY_TREND_FORMATTER : DAILY_TREND_FORMATTER).format(date);
}

function dateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return Math.floor(value.getTime() / 1000);
}

function resolveRange(preset: RangePreset, customStart: string, customEnd: string) {
  const now = new Date();
  const end = Math.floor(now.getTime() / 1000);
  if (preset === "today") return { startDate: startOfDay(now), endDate: end };
  if (preset === "1d") return { startDate: end - 86_400, endDate: end };
  if (preset === "custom") {
    const start = customStart ? new Date(`${customStart}T00:00:00`) : new Date(now.getTime() - 86_400_000);
    const finish = customEnd ? new Date(`${customEnd}T23:59:59`) : now;
    return { startDate: Math.floor(start.getTime() / 1000), endDate: Math.floor(finish.getTime() / 1000) };
  }
  const days = preset === "7d" ? 7 : preset === "14d" ? 14 : 30;
  const start = new Date(now);
  start.setDate(start.getDate() - (days - 1));
  return { startDate: startOfDay(start), endDate: end };
}

function rangeLabel(preset: RangePreset, customStart: string, customEnd: string) {
  if (preset === "today") return "当天";
  if (preset === "custom") return customStart && customEnd ? `${customStart} - ${customEnd}` : "自定义";
  return preset;
}

function makeDemoDashboard(): LocalUsageDashboard {
  const now = new Date();
  const base = startOfDay(now);
  const hours = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  const curve = [4, 21, 39, 51, 6, 18, 0, 0, 0, 10, 28, 12, 136, 73, 82, 67, 52, 31, 14];
  const trends = hours.map((hour, index) => ({
    date: new Date((base + hour * 3_600) * 1000).toISOString(),
    requestCount: index + 1,
    totalCost: (curve[index] / 3.1).toFixed(6),
    totalTokens: curve[index] * 1000,
    totalInputTokens: curve[index] * 180,
    totalOutputTokens: curve[index] * 75,
    totalCacheCreationTokens: index % 6 === 0 ? curve[index] * 20 : 0,
    totalCacheReadTokens: curve[index] * 720,
  }));
  const logs: LocalUsageLogDetail[] = ([
    ["claude", "claude-3-5-sonnet", "Relay A", 200, 200, 200],
    ["codex", "gpt-4o", "Relay A", 200, 540, 1_200],
    ["gemini", "gemini-2.5-pro", "Relay B", 200, 320, 860],
    ["claude", "claude-sonnet-4", "Relay A", 429, 0, 0],
    ["codex", "gpt-4.1-mini", "Relay C", 200, 210, 420],
  ] as Array<[AppFilter, string, string, number, number, number]>).map(([appType, model, providerName, statusCode, outputTokens, totalTokens], index) => ({
    requestId: `demo-${index + 1}`,
    providerId: providerName.toLowerCase().replace(/ /g, "-"),
    providerName,
    appType,
    model,
    requestModel: model,
    inputTokens: Math.max(0, totalTokens - outputTokens - 200),
    outputTokens,
    cacheReadTokens: 200,
    cacheCreationTokens: appType === "claude" ? 80 : 0,
    totalTokens,
    inputCostUsd: "0.002000",
    outputCostUsd: "0.005000",
    cacheReadCostUsd: "0.000100",
    cacheCreationCostUsd: "0.000200",
    totalCostUsd: statusCode === 200 ? "0.007300" : "0.000000",
    isStreaming: index % 2 === 0,
    latencyMs: 620 + index * 90,
    firstTokenMs: index % 2 === 0 ? 220 + index * 16 : undefined,
    durationMs: 920 + index * 110,
    statusCode,
    errorMessage: statusCode === 429 ? "上游返回 HTTP 429" : undefined,
    endpoint: appType === "claude" ? "/v1/messages" : "/v1/chat/completions",
    keyId: "demo-key",
    createdAt: Math.floor((base + (18 - index) * 3_600) / 1),
    dataSource: "local_gateway",
  }));
  return {
    summary: {
      totalRequests: 6_073,
      totalCost: "19.8939",
      totalInputTokens: 40_629_000,
      totalOutputTokens: 3_243_000,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 804_100_000,
      successRate: 99.4,
      realTotalTokens: 848_213_331,
      cacheHitRate: 0.952,
    },
    trends,
    providerStats: [
      { providerId: "relay-a", providerName: "Relay A", requestCount: 3_880, totalTokens: 569_100_000, totalCost: "12.4012", successRate: 99.7, avgLatencyMs: 648 },
      { providerId: "relay-b", providerName: "Relay B", requestCount: 1_444, totalTokens: 188_700_000, totalCost: "4.8021", successRate: 98.9, avgLatencyMs: 812 },
      { providerId: "relay-c", providerName: "Relay C", requestCount: 749, totalTokens: 90_413_331, totalCost: "2.6906", successRate: 99.2, avgLatencyMs: 590 },
    ],
    modelStats: [
      { model: "claude-3-5-sonnet", requestCount: 2_812, totalTokens: 404_200_000, totalCost: "10.3412", avgCostPerRequest: "0.003678" },
      { model: "gpt-4o", requestCount: 1_920, totalTokens: 273_400_000, totalCost: "6.9282", avgCostPerRequest: "0.003608" },
      { model: "gemini-2.5-pro", requestCount: 1_341, totalTokens: 170_613_331, totalCost: "2.6245", avgCostPerRequest: "0.001957" },
    ],
    logs,
    totalLogs: logs.length,
    providers: ["Relay A", "Relay B", "Relay C"],
    models: ["claude-3-5-sonnet", "gpt-4o", "gemini-2.5-pro", "claude-sonnet-4", "gpt-4.1-mini"],
    appTypes: ["claude", "codex", "gemini"],
  };
}

export function UsageStatistics() {
  const { notify } = useToast();
  const [range, setRange] = useState<RangePreset>("today");
  const [customStart, setCustomStart] = useState(dateInputValue(new Date(Date.now() - 86_400_000)));
  const [customEnd, setCustomEnd] = useState(dateInputValue(new Date()));
  const [appType, setAppType] = useState<AppFilter>("all");
  const [providerName, setProviderName] = useState("all");
  const [model, setModel] = useState("all");
  const [refreshInterval, setRefreshInterval] = useState(30_000);
  const [dashboard, setDashboard] = useState<LocalUsageDashboard>(() => isTauri() ? EMPTY_DASHBOARD : makeDemoDashboard());
  const [pricing, setPricing] = useState<LocalModelPricing[]>([]);
  const [loading, setLoading] = useState(false);
  const [dateMenuOpen, setDateMenuOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<StatsTab>("logs");
  const [page, setPage] = useState(1);
  const [selectedLog, setSelectedLog] = useState<LocalUsageLogDetail | null>(null);
  const requestSequence = useRef(0);
  const requestInFlight = useRef(false);

  const buildQuery = useCallback((nextPage = page): LocalUsageQuery => {
    const resolved = resolveRange(range, customStart, customEnd);
    return {
      ...resolved,
      appType: appType === "all" ? undefined : appType,
      providerName: providerName === "all" ? undefined : providerName,
      model: model === "all" ? undefined : model,
      page: nextPage,
      pageSize: PAGE_SIZE,
    };
  }, [appType, customEnd, customStart, model, page, providerName, range]);

  const loadDashboard = useCallback(async (showError = true, skipIfBusy = false) => {
    if (!isTauri()) {
      setDashboard(makeDemoDashboard());
      return;
    }
    if (skipIfBusy && requestInFlight.current) return;
    const sequence = ++requestSequence.current;
    requestInFlight.current = true;
    setLoading(true);
    try {
      const nextDashboard = await localUsageApi.dashboard(buildQuery());
      if (sequence === requestSequence.current) setDashboard(nextDashboard);
    } catch (reason) {
      if (sequence !== requestSequence.current) return;
      if (showError) notify(errorMessage(reason, "加载本地使用统计失败。"), "error");
    } finally {
      if (sequence === requestSequence.current) {
        requestInFlight.current = false;
        setLoading(false);
      }
    }
  }, [buildQuery, notify]);

  useEffect(() => {
    if (!isTauri()) return;
    void localUsageApi.refreshInterval().then(setRefreshInterval).catch(() => undefined);
    void localUsageApi.pricing().then(setPricing).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (document.visibilityState === "hidden") return;
    void loadDashboard(false);
  }, [loadDashboard]);

  useEffect(() => {
    if (!isTauri() || refreshInterval <= 0) return;
    const refresh = () => {
      if (document.visibilityState === "visible") void loadDashboard(false, true);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void loadDashboard(false, true);
    };
    const timer = window.setInterval(refresh, refreshInterval);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadDashboard, refreshInterval]);

  const updateRange = (next: RangePreset) => {
    setRange(next);
    setPage(1);
    if (next !== "custom") setDateMenuOpen(false);
  };

  const updateApp = (next: AppFilter) => {
    setAppType(next);
    setProviderName("all");
    setModel("all");
    setPage(1);
  };

  const saveRefreshInterval = async (value: number) => {
    setRefreshInterval(value);
    if (!isTauri()) return;
    try {
      setRefreshInterval(await localUsageApi.saveRefreshInterval(value));
    } catch (reason) {
      notify(errorMessage(reason, "保存自动刷新设置失败。"), "error");
    }
  };

  const reloadPricing = async () => {
    if (!isTauri()) return;
    setPricing(await localUsageApi.pricing());
    await loadDashboard(false);
  };

  const clearLogs = async () => {
    if (!isTauri() || !window.confirm("确定清空本地使用统计吗？此操作不可撤销。")) return;
    try {
      await localUsageApi.clearLogs();
      await loadDashboard();
      notify("本地使用统计已清空。", "success");
    } catch (reason) {
      notify(errorMessage(reason, "清空本地使用统计失败。"), "error");
    }
  };

  const summary = dashboard.summary;
  const resolvedRange = resolveRange(range, customStart, customEnd);
  const hourly = resolvedRange.endDate - resolvedRange.startDate <= 86_400;
  const totalPages = Math.max(1, Math.ceil(dashboard.totalLogs / PAGE_SIZE));
  const cacheWriteState = deriveCacheWriteState(dashboard.appTypes);
  const cacheWriteUnavailable = cacheWriteState === "na";
  const cacheWriteTooltip = cacheWriteState === "na"
    ? "OpenAI 协议不区分缓存写入，仅上报缓存命中"
    : cacheWriteState === "partial"
      ? "部分协议不单独上报缓存写入，数值可能偏低"
      : undefined;
  const dateLabel = rangeLabel(range, customStart, customEnd);

  const trendData = useMemo(() => ({
    labels: dashboard.trends.map((item) => formatTrendDate(item.date, hourly)),
    datasets: [
      { label: "成本", data: dashboard.trends.map((item) => Number.parseFloat(item.totalCost)), borderColor: "#fb7185", backgroundColor: "#fb7185", borderDash: [4, 4], borderWidth: 2, pointRadius: 1, tension: 0.35, yAxisID: "cost", fill: false },
      { label: "缓存创建", data: dashboard.trends.map((item) => item.totalCacheCreationTokens), borderColor: "#f97316", backgroundColor: "rgba(249, 115, 22, .08)", borderWidth: 1.7, pointRadius: 1, tension: 0.35, yAxisID: "tokens", fill: false },
      { label: "缓存命中", data: dashboard.trends.map((item) => item.totalCacheReadTokens), borderColor: "#a855f7", backgroundColor: "rgba(168, 85, 247, .14)", borderWidth: 2, pointRadius: 1, tension: 0.35, yAxisID: "tokens", fill: true },
      { label: "输入", data: dashboard.trends.map((item) => item.totalInputTokens), borderColor: "#3b82f6", backgroundColor: "#3b82f6", borderWidth: 1.8, pointRadius: 1, tension: 0.35, yAxisID: "tokens", fill: false },
      { label: "输出", data: dashboard.trends.map((item) => item.totalOutputTokens), borderColor: "#10b981", backgroundColor: "#10b981", borderWidth: 1.8, pointRadius: 1, tension: 0.35, yAxisID: "tokens", fill: false },
    ],
  }), [dashboard.trends, hourly]);

  const trendOptions = useMemo<ChartOptions<"line">>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8, padding: 16, color: "#64748b" } },
      tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${context.dataset.yAxisID === "cost" ? formatCost(Number(context.raw), 4) : formatNumber(Number(context.raw))}` } },
    },
    scales: {
      tokens: { type: "linear", position: "left", beginAtZero: true, grid: { color: "#eef2f7" }, ticks: { color: "#64748b", callback: (value) => formatCompactTokens(Number(value)) } },
      cost: { type: "linear", position: "right", beginAtZero: true, grid: { drawOnChartArea: false }, ticks: { color: "#64748b", callback: (value) => `$${Number(value).toFixed(0)}` } },
      x: { grid: { display: false }, ticks: { color: "#64748b", maxTicksLimit: 10 } },
    },
  }), []);

  return <div className="local-usage-page">
    <header className="local-usage-heading">
      <div>
        <h2>使用统计</h2>
        <p>查看 AI 模型的使用情况和成本统计</p>
      </div>
      <span className="local-usage-source"><i />本地 Gateway 数据</span>
    </header>

    <div className="local-usage-toolbar">
      <div className="local-usage-app-filter" role="group" aria-label="应用筛选">
        {APP_FILTERS.map((app) => <Button
          key={app.id}
          type="button"
          className={appType === app.id ? "active" : ""}
          title={app.label}
          aria-label={app.label}
          aria-pressed={appType === app.id}
          onClick={() => updateApp(app.id)}
        >{appIcon(app.id)}</Button>)}
      </div>
      <SelectField aria-label="来源筛选" value={providerName} onChange={(event) => { setProviderName(event.target.value); setModel("all"); setPage(1); }}>
        <option value="all">全部来源</option>
        {dashboard.providers.map((value) => <option key={value} value={value}>{value}</option>)}
      </SelectField>
      <SelectField aria-label="模型筛选" value={model} onChange={(event) => { setModel(event.target.value); setPage(1); }}>
        <option value="all">全部模型</option>
        {dashboard.models.map((value) => <option key={value} value={value}>{value}</option>)}
      </SelectField>
      <SelectField className="local-usage-refresh-select" aria-label="自动刷新间隔" value={refreshInterval} onChange={(event) => void saveRefreshInterval(Number(event.target.value))}>
        {REFRESH_OPTIONS.map((value) => <option key={value} value={value}>{value === 0 ? "关闭刷新" : `${value / 1000}s`}</option>)}
      </SelectField>
      <div className="local-usage-date-control">
        <Button type="button" variant="secondary" aria-expanded={dateMenuOpen} onClick={() => setDateMenuOpen((value) => !value)}><CalendarDays size={15} />{dateLabel}<ChevronDown size={14} /></Button>
        {dateMenuOpen && <div className="local-usage-date-menu">
          <div className="local-usage-date-presets">
            {(["today", "1d", "7d", "14d", "30d"] as RangePreset[]).map((value) => <Button key={value} type="button" className={range === value ? "active" : ""} onClick={() => updateRange(value)}>{value === "today" ? "当天" : value}</Button>)}
          </div>
          <div className="local-usage-date-fields">
            <label>开始日期<TextField type="date" value={customStart} onChange={(event) => { setCustomStart(event.target.value); setRange("custom"); }} /></label>
            <label>结束日期<TextField type="date" value={customEnd} onChange={(event) => { setCustomEnd(event.target.value); setRange("custom"); }} /></label>
          </div>
          <Button type="button" variant="primary" onClick={() => { setPage(1); setDateMenuOpen(false); }}>应用日期</Button>
        </div>}
      </div>
      <IconButton type="button" variant="secondary" className="local-usage-refresh-button" label="刷新本地统计" onClick={() => void loadDashboard()} disabled={loading} icon={<RefreshCw size={15} className={loading ? "local-usage-spin" : ""} />} />
    </div>

    <section className="local-usage-hero">
      <div className="local-usage-hero-top">
        <div className="local-usage-total">
          <span className="local-usage-total-icon"><Zap size={21} /></span>
          <div><span className="local-usage-eyebrow">真实消耗 Tokens</span><div className="local-usage-total-value"><strong>{formatNumber(summary.realTotalTokens)}</strong><small>≈ {formatCompactTokens(summary.realTotalTokens, 2)}</small></div></div>
        </div>
        <div className="local-usage-hero-kpis">
          <div><span>总请求数</span><strong><Activity size={14} />{formatNumber(summary.totalRequests)}</strong></div>
          <div><span>总成本</span><strong className="is-cost">{formatCost(summary.totalCost, 4)}</strong></div>
          <div><span>成功率</span><strong>{summary.successRate.toFixed(1)}%</strong></div>
        </div>
      </div>
      <div className="local-usage-mini-grid">
        <MiniMetric icon={<ArrowDownToLine size={14} />} label="新增输入" value={formatCompactTokens(summary.totalInputTokens)} tone="blue" />
        <MiniMetric icon={<ArrowUpFromLine size={14} />} label="Output" value={formatCompactTokens(summary.totalOutputTokens)} tone="violet" />
        <MiniMetric icon={<Database size={14} />} label="创建" value={cacheWriteUnavailable ? "N/A" : formatCompactTokens(summary.totalCacheCreationTokens)} tone="orange" muted={cacheWriteUnavailable} tooltip={cacheWriteTooltip} />
        <MiniMetric icon={<Sparkles size={14} />} label="命中" value={formatCompactTokens(summary.totalCacheReadTokens)} tone="green" />
        <div className="local-usage-hit-rate"><div><span>缓存命中率</span><strong>{(summary.cacheHitRate * 100).toFixed(1)}%</strong></div><div className="local-usage-progress"><i style={{ width: `${Math.min(100, summary.cacheHitRate * 100)}%` }} /></div></div>
      </div>
    </section>

    <section className="local-usage-panel local-usage-trend-panel">
      <div className="local-usage-panel-heading"><div><h3>使用趋势</h3><p>{dateLabel}</p></div><span className="local-usage-trend-note">{hourly ? "按小时聚合" : "按日期聚合"}</span></div>
      <div className="local-usage-chart">{dashboard.trends.length ? <Line data={trendData} options={trendOptions} /> : <EmptyState className="local-usage-empty" message="暂无本地统计数据" />}</div>
    </section>

    <section className="local-usage-results">
      <div className="local-usage-tabs" role="tablist" aria-label="统计明细">
        <Button type="button" variant="ghost" role="tab" aria-selected={activeTab === "logs"} className={activeTab === "logs" ? "active" : ""} onClick={() => setActiveTab("logs")}><ListFilter size={15} />请求日志</Button>
        <Button type="button" variant="ghost" role="tab" aria-selected={activeTab === "providers"} className={activeTab === "providers" ? "active" : ""} onClick={() => setActiveTab("providers")}><Activity size={15} />来源统计</Button>
        <Button type="button" variant="ghost" role="tab" aria-selected={activeTab === "models"} className={activeTab === "models" ? "active" : ""} onClick={() => setActiveTab("models")}><BarChart3 size={15} />模型统计</Button>
      </div>
      {activeTab === "logs" && <RequestLogs logs={dashboard.logs} total={dashboard.totalLogs} page={page} totalPages={totalPages} onPage={setPage} onSelect={setSelectedLog} />}
      {activeTab === "providers" && <ProviderStats rows={dashboard.providerStats} />}
      {activeTab === "models" && <ModelStats rows={dashboard.modelStats} />}
    </section>

    <details className="local-usage-disclosure">
      <summary><span><Coins size={17} /><strong>定价配置</strong><small>按模型设置每百万 Tokens 成本</small></span><ChevronDown size={16} /></summary>
      <PricingPanel pricing={pricing} onChanged={() => void reloadPricing()} onNotify={notify} />
    </details>
    <details className="local-usage-disclosure">
      <summary><span><Database size={17} /><strong>维护</strong><small>清理本地 Gateway 统计数据</small></span><ChevronDown size={16} /></summary>
      <div className="local-usage-maintenance"><p>本地统计只保存经过 RelayHub Gateway 的请求，不会影响中转站使用记录。</p><Button type="button" variant="secondary" onClick={() => void clearLogs()}><Trash2 size={15} />清空本地统计</Button></div>
    </details>

    {selectedLog && <LogDetail log={selectedLog} onClose={() => setSelectedLog(null)} />}
  </div>;
}

function MiniMetric({ icon, label, value, tone, muted = false, tooltip }: { icon: React.ReactNode; label: string; value: string; tone: string; muted?: boolean; tooltip?: string }) {
  return <div className={`local-usage-mini-metric tone-${tone} ${muted ? "is-muted" : ""}`} title={tooltip}><span>{icon}<em>{label}</em>{tooltip && <Info size={12} aria-label={tooltip} />}</span><strong>{value}</strong></div>;
}

const RequestLogs = memo(function RequestLogs({ logs, total, page, totalPages, onPage, onSelect }: { logs: LocalUsageLogDetail[]; total: number; page: number; totalPages: number; onPage: (page: number) => void; onSelect: (log: LocalUsageLogDetail) => void }) {
  return <div className="local-usage-table-panel">
    <div className="local-usage-table-toolbar"><span>共 <strong>{formatNumber(total)}</strong> 条记录</span><span className="local-usage-table-hint">点击行查看详情</span></div>
    {logs.length ? <div className="local-usage-table-scroll"><table className="local-usage-table"><thead><tr><th>时间</th><th>应用</th><th>来源</th><th>模型</th><th>状态</th><th className="align-right">Tokens</th><th className="align-right">成本</th><th className="align-right">延迟</th></tr></thead><tbody>{logs.map((log) => <tr key={log.requestId} tabIndex={0} onClick={() => onSelect(log)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(log); } }}>
      <td><strong>{formatDateTime(log.createdAt)}</strong><small>{log.isStreaming ? "流式" : "非流式"}</small></td>
      <td><span className="local-usage-app-chip">{log.appType}</span></td>
      <td>{log.providerName}<small>{log.keyId || "本地路由"}</small></td>
      <td><code>{log.model}</code></td>
      <td><span className={`local-usage-status ${log.statusCode >= 200 && log.statusCode < 400 ? "is-good" : "is-error"}`}><i />{log.statusCode || "--"}</span></td>
      <td className="align-right"><strong>{formatCompactTokens(log.totalTokens)}</strong><small>输入 {formatCompactTokens(log.inputTokens)}</small></td>
      <td className="align-right">{formatCost(log.totalCostUsd)}</td>
      <td className="align-right">{log.latencyMs}ms</td>
    </tr>)}</tbody></table></div> : <EmptyState className="local-usage-empty" message="暂无符合条件的本地请求" />}
    <Pagination page={page} pageCount={totalPages} onPageChange={onPage} ariaLabel="本地请求分页" className="local-usage-pagination" />
  </div>;
});

const ProviderStats = memo(function ProviderStats({ rows }: { rows: LocalUsageDashboard["providerStats"] }) {
  return <div className="local-usage-table-panel"><div className="local-usage-table-scroll"><table className="local-usage-table compact"><thead><tr><th>来源</th><th className="align-right">请求数</th><th className="align-right">Tokens</th><th className="align-right">成本</th><th className="align-right">成功率</th><th className="align-right">平均延迟</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.providerId}><td><strong>{row.providerName}</strong><small>{row.providerId}</small></td><td className="align-right">{formatNumber(row.requestCount)}</td><td className="align-right">{formatCompactTokens(row.totalTokens)}</td><td className="align-right">{formatCost(row.totalCost)}</td><td className="align-right">{row.successRate.toFixed(1)}%</td><td className="align-right">{row.avgLatencyMs}ms</td></tr>) : <tr><td colSpan={6}><EmptyState className="local-usage-empty" message="暂无数据" /></td></tr>}</tbody></table></div></div>;
});

const ModelStats = memo(function ModelStats({ rows }: { rows: LocalUsageDashboard["modelStats"] }) {
  return <div className="local-usage-table-panel"><div className="local-usage-table-scroll"><table className="local-usage-table compact"><thead><tr><th>模型</th><th className="align-right">请求数</th><th className="align-right">Tokens</th><th className="align-right">总成本</th><th className="align-right">平均成本</th></tr></thead><tbody>{rows.length ? rows.map((row) => <tr key={row.model}><td><code>{row.model}</code></td><td className="align-right">{formatNumber(row.requestCount)}</td><td className="align-right">{formatCompactTokens(row.totalTokens)}</td><td className="align-right">{formatCost(row.totalCost)}</td><td className="align-right">{formatCost(row.avgCostPerRequest, 6)}</td></tr>) : <tr><td colSpan={5}><EmptyState className="local-usage-empty" message="暂无数据" /></td></tr>}</tbody></table></div></div>;
});

function LogDetail({ log, onClose }: { log: LocalUsageLogDetail; onClose: () => void }) {
  return <Drawer
    ariaLabel="请求详情"
    onClose={onClose}
    className="local-usage-drawer"
    contentClassName="local-usage-drawer-body"
    header={<div><h3>请求详情</h3><p>{log.requestId}</p></div>}
  >
    <div className="local-usage-detail-banner"><span className={`local-usage-status ${log.statusCode >= 200 && log.statusCode < 400 ? "is-good" : "is-error"}`}><i />HTTP {log.statusCode}</span><span>{formatDateTime(log.createdAt)}</span></div><dl>
      <dt>应用</dt><dd>{log.appType}</dd><dt>来源</dt><dd>{log.providerName}</dd><dt>模型</dt><dd><code>{log.model}</code></dd><dt>请求模型</dt><dd>{log.requestModel || "--"}</dd><dt>端点</dt><dd><code>{log.endpoint || "--"}</code></dd><dt>输入</dt><dd>{formatNumber(log.inputTokens)}</dd><dt>输出</dt><dd>{formatNumber(log.outputTokens)}</dd><dt>缓存读取</dt><dd>{formatNumber(log.cacheReadTokens)}</dd><dt>缓存创建</dt><dd>{formatNumber(log.cacheCreationTokens)}</dd><dt>真实消耗</dt><dd>{formatNumber(log.totalTokens)}</dd><dt>成本</dt><dd>{formatCost(log.totalCostUsd, 6)}</dd><dt>首 Token</dt><dd>{log.firstTokenMs == null ? "--" : `${log.firstTokenMs}ms`}</dd><dt>总耗时</dt><dd>{log.durationMs == null ? `${log.latencyMs}ms` : `${log.durationMs}ms`}</dd>
    </dl>{log.errorMessage && <p className="local-usage-detail-error">{log.errorMessage}</p>}
  </Drawer>;
}

function PricingPanel({ pricing, onChanged, onNotify }: { pricing: LocalModelPricing[]; onChanged: () => void; onNotify: (message: string, tone: "success" | "error") => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<LocalModelPricing | null>(null);
  const [adding, setAdding] = useState(false);
  const emptyDraft = (): LocalModelPricing => ({ modelId: "", displayName: "", inputCostPerMillion: 0, outputCostPerMillion: 0, cacheReadCostPerMillion: 0, cacheCreationCostPerMillion: 0 });
  const save = async (value: LocalModelPricing) => {
    if (!value.modelId.trim() || !value.displayName.trim() || [value.inputCostPerMillion, value.outputCostPerMillion, value.cacheReadCostPerMillion, value.cacheCreationCostPerMillion].some((item) => !Number.isFinite(item) || item < 0)) {
      onNotify("模型定价填写不完整。", "error");
      return;
    }
    if (!isTauri()) { setAdding(false); setEditing(null); return; }
    try {
      await localUsageApi.savePricing(value);
      setAdding(false);
      setEditing(null);
      setDraft(null);
      onChanged();
      onNotify("模型定价已保存。", "success");
    } catch (reason) {
      onNotify(errorMessage(reason, "保存模型定价失败。"), "error");
    }
  };
  const remove = async (modelId: string) => {
    if (!isTauri() || !window.confirm(`删除 ${modelId} 的定价吗？`)) return;
    try {
      await localUsageApi.deletePricing(modelId);
      onChanged();
      onNotify("模型定价已删除。", "success");
    } catch (reason) {
      onNotify(errorMessage(reason, "删除模型定价失败。"), "error");
    }
  };
  const input = (value: LocalModelPricing, field: keyof LocalModelPricing, label: string) => <label className="local-usage-pricing-field"><span>{label}</span><TextField aria-label={label} type="number" min="0" step="0.0001" value={value[field] as number} onChange={(event) => setDraft({ ...value, [field]: Number(event.target.value) })} /></label>;
  return <div className="local-usage-pricing"><div className="local-usage-pricing-heading"><p>价格单位：USD / 1M Tokens</p><Button type="button" variant="primary" onClick={() => { setAdding(true); setDraft(emptyDraft()); }}><Plus size={15} />新增定价</Button></div>
    {adding && draft && <div className="local-usage-pricing-editor"><label>模型 ID<TextField value={draft.modelId} onChange={(event) => setDraft({ ...draft, modelId: event.target.value })} placeholder="例如 claude-3-5-sonnet" /></label><label>显示名称<TextField value={draft.displayName} onChange={(event) => setDraft({ ...draft, displayName: event.target.value })} placeholder="例如 Claude 3.5 Sonnet" /></label>{input(draft, "inputCostPerMillion", "输入")} {input(draft, "outputCostPerMillion", "输出")} {input(draft, "cacheReadCostPerMillion", "缓存读取")} {input(draft, "cacheCreationCostPerMillion", "缓存创建")}<div className="local-usage-pricing-editor-actions"><Button type="button" variant="secondary" onClick={() => setAdding(false)}>取消</Button><Button type="button" variant="primary" onClick={() => void save(draft)}>保存</Button></div></div>}
    <div className="local-usage-pricing-table-scroll"><table className="local-usage-pricing-table"><thead><tr><th>模型</th><th>输入</th><th>输出</th><th>缓存读取</th><th>缓存创建</th><th /></tr></thead><tbody>{pricing.map((item) => editing === item.modelId && draft ? <tr key={item.modelId}><td><strong>{item.displayName}</strong><small>{item.modelId}</small></td><td>{input(draft, "inputCostPerMillion", "输入")}</td><td>{input(draft, "outputCostPerMillion", "输出")}</td><td>{input(draft, "cacheReadCostPerMillion", "缓存读取")}</td><td>{input(draft, "cacheCreationCostPerMillion", "缓存创建")}</td><td><div className="local-usage-inline-actions"><IconButton type="button" variant="primary" label="保存" onClick={() => void save(draft)} icon={<Download size={14} />} /><IconButton type="button" variant="secondary" label="取消" onClick={() => { setEditing(null); setDraft(null); }} icon={<X size={14} />} /></div></td></tr> : <tr key={item.modelId}><td><strong>{item.displayName}</strong><small>{item.modelId}</small></td><td>{item.inputCostPerMillion}</td><td>{item.outputCostPerMillion}</td><td>{item.cacheReadCostPerMillion}</td><td>{item.cacheCreationCostPerMillion}</td><td><div className="local-usage-inline-actions"><IconButton type="button" variant="secondary" label="编辑" onClick={() => { setEditing(item.modelId); setDraft({ ...item }); }} icon={<Pencil size={14} />} /><IconButton type="button" variant="secondary" label="删除" disabled={item.modelId === "*"} onClick={() => void remove(item.modelId)} icon={<Trash2 size={14} />} /></div></td></tr>)}</tbody></table></div>
  </div>;
}
