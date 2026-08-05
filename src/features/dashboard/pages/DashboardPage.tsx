import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Database,
  DollarSign,
  Gauge,
  LayoutDashboard,
  Package,
  RefreshCw,
  ServerCog,
  Zap,
} from "lucide-react";
import { ArcElement, CategoryScale, Chart as ChartJS, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip } from "chart.js";
import { Doughnut, Line } from "react-chartjs-2";
import packageInfo from "../../../../package.json";
import { isTauri } from "../../../lib/platform";
import { gatewayApi } from "../../gateway/api";
import type { GatewayStatus } from "../../gateway/types";
import { settingsApi } from "../../settings/api";
import type { PendingDesktopUpdate } from "../../settings/types";
import type { DashboardPageProps } from "../types";
import "../../../components/Sub2ApiPages.css";
import "./DashboardPage.css";

ChartJS.register(ArcElement, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip);

type ConnectionMode = "direct" | "localRouting";

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

function statusKind(status: string) {
  return status === "online" ? "good" : status === "partial" ? "warn" : "bad";
}

function statusLabel(status: string) {
  return status === "online" ? "正常" : status === "partial" ? "部分可用" : "异常";
}

function UsageMetric({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  detail: ReactNode;
  tone: string;
}) {
  return (
    <div className={`sub2-dashboard-usage-metric sub2-dashboard-usage-metric-${tone}`}>
      <span className="sub2-dashboard-usage-metric-icon" aria-hidden="true">{icon}</span>
      <div className="sub2-dashboard-usage-metric-content">
        <span className="sub2-dashboard-usage-metric-label">{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}

function OverviewCard({
  icon,
  title,
  description,
  action,
  className,
  children,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article className={`sub2-dashboard-overview-card ${className ?? ""}`}>
      <header className="sub2-dashboard-card-heading">
        <span className="sub2-dashboard-card-icon" aria-hidden="true">{icon}</span>
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {action}
      </header>
      <div className="sub2-dashboard-card-body">{children}</div>
    </article>
  );
}

function VersionValue({
  label,
  version,
  updateAvailable = false,
  updateTitle,
  onUpdate,
}: {
  label: string;
  version: string;
  updateAvailable?: boolean;
  updateTitle?: string;
  onUpdate?: () => void;
}) {
  return <div className="sub2-dashboard-info-value">
    <strong title={updateTitle ?? version}>{version}</strong>
    {updateAvailable && onUpdate && <button
      type="button"
      className="button-secondary sub2-dashboard-version-update"
      title={`更新 ${label}`}
      aria-label={`更新 ${label}`}
      onClick={onUpdate}
    ><RefreshCw size={13} />更新</button>}
  </div>;
}

export function DashboardPage({
  stations,
  keys,
  remoteServers,
  accountRows,
  summary,
  usageRows,
  onRefresh,
  onNavigate,
  onOpenUpdates,
}: DashboardPageProps) {
  const [startDate, setStartDate] = useState(todayInput(new Date(Date.now() - 6 * 86_400_000)));
  const [endDate, setEndDate] = useState(todayInput(new Date()));
  const [granularity, setGranularity] = useState<"day" | "hour">("day");
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);
  const [previewMode, setPreviewMode] = useState<ConnectionMode>("direct");
  const [switchingMode, setSwitchingMode] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [relayhubVersion, setRelayhubVersion] = useState(packageInfo.version);
  const [relayhubUpdate, setRelayhubUpdate] = useState<PendingDesktopUpdate | null>(null);
  const online = stations.filter((station) => station.status === "online").length;
  const accountByStation = useMemo(() => new Map(accountRows.map((row) => [row.stationId, row])), [accountRows]);
  const balances = accountRows.filter((row) => row.account.balance != null);
  const totalBalance = balances.reduce((total, row) => total + (row.account.balance ?? 0), 0);
  const codexVersionDetails = useMemo(() => {
    const versions = [...new Set(remoteServers.map((server) => server.codexVersion).filter((version): version is string => Boolean(version)))];
    const latestVersions = [...new Set(remoteServers.map((server) => server.codexLatestVersion).filter((version): version is string => Boolean(version)))];
    return {
      version: versions.length === 0 ? "未检测" : versions.length === 1 ? versions[0] : `${versions.length} 个版本`,
      title: versions.length > 1 ? versions.join("、") : latestVersions.length ? `最新版本 ${latestVersions.join("、")}` : undefined,
      updateAvailable: remoteServers.some((server) => server.codexUpdateAvailable),
    };
  }, [remoteServers]);
  const connectionMode: ConnectionMode = gatewayStatus?.mode === "localGateway" ? "localRouting" : gatewayStatus ? "direct" : previewMode;
  const selectedKey = gatewayStatus?.activeStationId && gatewayStatus.activeKeyId
    ? keys.find((row) => row.stationId === gatewayStatus.activeStationId && row.key.id === gatewayStatus.activeKeyId)
    : undefined;
  const routeKey = selectedKey ?? keys.find((row) => {
    const route = gatewayStatus?.routeQueue[0];
    return route && route.stationId === row.stationId && route.keyId === row.key.id;
  }) ?? keys[0];
  const tokenTotals = useMemo(() => usageRows.reduce((totals, row) => {
    const inputTokens = row.inputTokens + row.cacheCreationTokens + row.cacheReadTokens;
    totals.input += inputTokens;
    totals.output += row.outputTokens;
    totals.total += inputTokens + row.outputTokens;
    return totals;
  }, { input: 0, output: 0, total: 0 }), [usageRows]);
  const records = usageRows.filter((row) => row.createdAt >= beginOfDay(startDate) && row.createdAt <= endOfDay(endDate));
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
  const todayTokens = (summary.todayInputTokens ?? 0) + (summary.todayOutputTokens ?? 0);
  const todayElapsedMinutes = Math.max(1, (Date.now() - beginOfDay(todayInput(new Date())) * 1000) / 60_000);
  const performanceRpm = (summary.todayRequests ?? 0) / todayElapsedMinutes;
  const performanceTpm = todayTokens / todayElapsedMinutes;
  const setRange = (days: number) => {
    setStartDate(todayInput(new Date(Date.now() - (days - 1) * 86_400_000)));
    setEndDate(todayInput(new Date()));
  };
  useEffect(() => {
    if (!isTauri()) return;
    let mounted = true;
    const refreshGateway = async () => {
      try {
        const next = await gatewayApi.status();
        if (mounted) {
          setGatewayStatus(next);
          setGatewayError(null);
        }
      } catch (reason) {
        if (mounted) setGatewayError(reason instanceof Error ? reason.message : String(reason));
      }
    };
    void refreshGateway();
    const timer = window.setInterval(() => void refreshGateway(), 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let mounted = true;
    void Promise.all([settingsApi.appVersion(), settingsApi.checkForUpdate()])
      .then(([version, update]) => {
        if (!mounted) return;
        if (version) setRelayhubVersion(version);
        setRelayhubUpdate(update);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);
  const switchConnectionMode = async (nextMode: ConnectionMode) => {
    if (switchingMode || nextMode === connectionMode) return;
    if (!isTauri()) {
      setPreviewMode(nextMode);
      return;
    }
    setSwitchingMode(true);
    setGatewayError(null);
    try {
      if (routeKey) await gatewayApi.setRoute(routeKey.stationId, routeKey.key.id);
      setGatewayStatus(await gatewayApi.setMode(nextMode === "localRouting" ? "localGateway" : "ccSwitch"));
    } catch (reason) {
      setGatewayError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSwitchingMode(false);
    }
  };
  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

  return <div className="sub2-page sub2-dashboard-page">
    <section className="sub2-dashboard-overview-grid">
      <OverviewCard
        className="sub2-dashboard-usage-card"
        icon={<Activity size={18} />}
        title="今日使用"
        description="所有已同步站点的今日汇总"
        action={<button type="button" className="button-secondary sub2-dashboard-icon-action" title="查看使用记录" aria-label="查看使用记录" onClick={() => onNavigate("usage")}><ArrowRight size={15} /></button>}
      >
        <div className="sub2-dashboard-usage-metrics">
          <UsageMetric tone="green" icon={<DollarSign size={18} />} label="余额" value={balances.length ? formatMoney(totalBalance) : "-"} detail="可用" />
          <UsageMetric tone="blue" icon={<Activity size={18} />} label="今日请求" value={formatNumber(summary.todayRequests)} detail={`总计: ${formatNumber(summary.totalRequests)}`} />
          <UsageMetric tone="purple" icon={<DollarSign size={18} />} label="今日消费" value={`${formatMoney(summary.todaySpent)} / ${formatMoney(summary.todayLimit)}`} detail={`总计: ${formatMoney(summary.totalSpent)} / ${formatMoney(summary.totalLimit)}`} />
          <UsageMetric tone="amber" icon={<Package size={18} />} label="今日 Token" value={formatNumber(todayTokens)} detail={`输入: ${formatNumber(summary.todayInputTokens)} / 输出: ${formatNumber(summary.todayOutputTokens)}`} />
          <UsageMetric tone="indigo" icon={<Database size={18} />} label="累计 Token" value={formatNumber(tokenTotals.total)} detail={`输入: ${formatNumber(tokenTotals.input)} / 输出: ${formatNumber(tokenTotals.output)}`} />
          <UsageMetric tone="violet" icon={<Zap size={18} />} label="性能指标" value={`${formatNumber(performanceRpm)} RPM`} detail={`${formatNumber(performanceTpm)} TPM`} />
        </div>
      </OverviewCard>

      <OverviewCard
        className="sub2-dashboard-station-card"
        icon={<Gauge size={18} />}
        title="站点与账户"
        description={`${online}/${stations.length} 个站点正常运行`}
        action={<button type="button" className="button-secondary sub2-dashboard-icon-action" title="同步站点" aria-label="同步站点" onClick={() => void onRefresh()}><RefreshCw size={15} /></button>}
      >
        <div className="sub2-dashboard-station-list">
          {stations.slice(0, 4).map((station) => {
            const account = accountByStation.get(station.id);
            return <div className="sub2-dashboard-station-row" key={station.id}>
              <span className={`sub2-status sub2-status-${statusKind(station.status)}`}><i />{statusLabel(station.status)}</span>
              <div className="sub2-dashboard-station-main"><strong>{station.name}</strong><small>{account?.account.username || station.baseUrl}</small></div>
              <div className="sub2-dashboard-station-balance"><strong>{account?.account.balance == null ? "-" : formatMoney(account.account.balance)}</strong><small>{formatTime(station.lastSyncedAt)}</small></div>
            </div>;
          })}
          {!stations.length && <div className="sub2-dashboard-empty">尚未添加站点账户</div>}
        </div>
      </OverviewCard>

      <OverviewCard
        className="sub2-dashboard-routing-card"
        icon={<ServerCog size={18} />}
        title="中转方式"
        description="直转使用站点 API 密钥，本地路由通过本地 Gateway 转发"
      >
        <div className="sub2-dashboard-routing-switch" role="group" aria-label="中转方式">
          <button type="button" className={`test-mode-button ${connectionMode === "direct" ? "active" : ""}`} aria-pressed={connectionMode === "direct"} disabled={switchingMode} onClick={() => void switchConnectionMode("direct")}>直转</button>
          <button type="button" className={`test-mode-button ${connectionMode === "localRouting" ? "active" : ""}`} aria-pressed={connectionMode === "localRouting"} disabled={switchingMode} onClick={() => void switchConnectionMode("localRouting")}>本地路由</button>
        </div>
        <div className="sub2-dashboard-routing-status">
          <span className={`sub2-status ${connectionMode === "localRouting" && gatewayStatus && !gatewayStatus.running ? "sub2-status-warn" : "sub2-status-good"}`}><i />{switchingMode ? "正在切换" : connectionMode === "direct" ? "直转已启用" : gatewayStatus && !gatewayStatus.running ? "本地路由已停止" : "本地路由已启用"}</span>
        </div>
        <div className="sub2-dashboard-config-grid">
          <div><span>认证文件</span><code>auth.json</code></div>
          <div><span>路由文件</span><code>config.toml</code></div>
        </div>
        <div className="sub2-dashboard-detail-grid">
          <div><span>{connectionMode === "direct" ? "API 密钥" : "路由来源"}</span><strong>{connectionMode === "direct" ? (routeKey ? routeKey.key.name || routeKey.key.id : "尚未选择") : "本地路由池"}</strong></div>
          <div><span>{connectionMode === "direct" ? "当前中转站" : "可用路由池"}</span><strong>{connectionMode === "direct" ? (routeKey ? routeKey.stationName : "尚未选择") : `${gatewayStatus?.routeQueue.length ?? 0} 条路由 · ${online}/${stations.length} 个站点可用`}</strong></div>
        </div>
        {gatewayError && <p className="sub2-dashboard-routing-error" role="alert">{gatewayError}</p>}
      </OverviewCard>

      <OverviewCard
        className="sub2-dashboard-info-card"
        icon={<LayoutDashboard size={18} />}
        title="RelayHub 信息"
        description="当前前端已加载的资源状态"
      >
        <div className="sub2-dashboard-info-grid">
          <div><span>运行环境</span><strong>{isTauri() ? "桌面应用" : "Web 预览"}</strong></div>
          <div><span>连接站点</span><strong>{online}/{stations.length}</strong></div>
          <div><span>API 密钥</span><strong>{keys.length}</strong></div>
          <div><span>Codex CLI 版本</span><VersionValue label="Codex CLI" version={codexVersionDetails.version} updateTitle={codexVersionDetails.title} updateAvailable={codexVersionDetails.updateAvailable} onUpdate={() => onNavigate("remote")} /></div>
          <div><span>ChatGPT 版本</span><VersionValue label="ChatGPT" version="未检测" /></div>
          <div><span>RelayHub 版本</span><VersionValue label="RelayHub" version={relayhubVersion} updateAvailable={Boolean(relayhubUpdate)} onUpdate={onOpenUpdates} /></div>
        </div>
      </OverviewCard>
    </section>

    <section className="sub2-dashboard-controls">
      <div className="sub2-dashboard-date-fields"><label>开始日期<input type="date" value={startDate} max={endDate} onChange={(event) => setStartDate(event.target.value)} /></label><label>结束日期<input type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} /></label></div>
      <div className="sub2-dashboard-control-actions"><div className="sub2-quick-range"><button onClick={() => setRange(1)}>今天</button><button onClick={() => setRange(7)}>7 天</button><button onClick={() => setRange(30)}>30 天</button></div><label className="sub2-granularity">粒度<select value={granularity} onChange={(event) => setGranularity(event.target.value as "day" | "hour")}><option value="day">按天</option><option value="hour">按小时</option></select></label><button className="button-secondary" title="刷新数据" aria-label="刷新数据" onClick={() => void onRefresh()}><RefreshCw size={16} /></button></div>
    </section>
    <section className="sub2-dashboard-chart-grid">
      <article className="sub2-panel sub2-dashboard-chart-card"><div className="sub2-panel-heading"><div><h2>模型用量</h2><p>所选时间范围内的模型分布</p></div></div><div className="sub2-dashboard-distribution">{models.length ? <div className="sub2-dashboard-doughnut"><Doughnut data={{ labels: models.map((item) => item.model), datasets: [{ data: models.map((item) => item.tokens), backgroundColor: colors, borderWidth: 0 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} /></div> : <div className="sub2-dashboard-no-chart">暂无可用数据</div>}<div className="sub2-dashboard-model-table"><table><thead><tr><th>模型</th><th>请求</th><th>Tokens</th><th>实际费用</th></tr></thead><tbody>{models.map((item, index) => <tr key={item.model}><td><i style={{ background: colors[index] }} />{item.model}</td><td>{formatNumber(item.requests)}</td><td>{formatNumber(item.tokens)}</td><td>{formatMoney(item.cost)}</td></tr>)}{!models.length && <tr><td colSpan={4}>暂无使用记录</td></tr>}</tbody></table></div></div></article>
      <article className="sub2-panel sub2-dashboard-chart-card"><div className="sub2-panel-heading"><div><h2>Token 使用趋势</h2><p>{granularity === "day" ? "按天" : "按小时"}汇总</p></div></div><div className="sub2-dashboard-line">{trend.length ? <Line data={{ labels: trend.map((item) => item.label), datasets: [{ data: trend.map((item) => item.tokens), fill: true, borderColor: "#2563eb", backgroundColor: "rgba(37, 99, 235, .10)", pointRadius: 2, tension: .35 }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 6 } }, y: { beginAtZero: true, ticks: { callback: (value) => formatNumber(Number(value)) } } } }} /> : <div className="sub2-dashboard-no-chart">暂无可用数据</div>}</div></article>
    </section>
  </div>;
}
