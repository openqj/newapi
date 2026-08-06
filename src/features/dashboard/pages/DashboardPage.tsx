import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  ArrowRight,
  Database,
  DollarSign,
  FileText,
  Gauge,
  LayoutDashboard,
  Package,
  RefreshCw,
  ServerCog,
  Zap,
} from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import { ArcElement, CategoryScale, Chart as ChartJS, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip } from "chart.js";
import { Doughnut, Line } from "react-chartjs-2";
import packageInfo from "../../../../package.json";
import { isTauri } from "../../../lib/platform";
import { apiKeyApi } from "../../api-keys/api";
import { GroupRateSelect } from "../../api-keys/components/GroupRateSelect";
import type { KeyRow } from "../../api-keys";
import { gatewayApi } from "../../gateway/api";
import type { GatewayRouteHealth, GatewayStatus } from "../../gateway/types";
import { settingsApi } from "../../settings/api";
import type { PendingDesktopUpdate } from "../../settings/types";
import type { DashboardPageProps } from "../types";
import "../../../components/Sub2ApiPages.css";
import "../../api-keys/pages/ApiKeysPage.css";
import "./DashboardPage.css";

ChartJS.register(ArcElement, CategoryScale, Filler, Legend, LineElement, LinearScale, PointElement, Tooltip);

type ConnectionMode = "direct" | "localRouting";

const formatMoney = (value?: number) =>
  value == null ? "-" : `${value.toFixed(4)} 额度`;
const formatRemaining = (value?: number) =>
  value == null ? "-" : `$${value.toFixed(2)}`;
const keyRowId = (row: KeyRow) => `${row.stationId}:${row.key.id}`;
const formatNumber = (value?: number) =>
  new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value ?? 0);
const todayInput = (date: Date) => date.toISOString().slice(0, 10);
const beginOfDay = (date: string) => new Date(`${date}T00:00:00`).getTime() / 1000;
const endOfDay = (date: string) => new Date(`${date}T23:59:59`).getTime() / 1000;
const gatewayRouteStateLabel = (state?: GatewayRouteHealth["state"]) =>
  state === "open" ? "冷却中" : state === "halfOpen" ? "探测中" : "可用";
const gatewayRouteStateClass = (state?: GatewayRouteHealth["state"]) =>
  state === "open" ? "is-open" : state === "halfOpen" ? "is-half-open" : "is-closed";
const formatCooldown = (milliseconds: number) => `${Math.max(1, Math.ceil(milliseconds / 1000))} 秒`;

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
  const [previewKeyId, setPreviewKeyId] = useState<string | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [gatewayError, setGatewayError] = useState<string | null>(null);
  const [enablingKeyId, setEnablingKeyId] = useState<string | null>(null);
  const [groupSavingKeyId, setGroupSavingKeyId] = useState<string | null>(null);
  const [groupDrafts, setGroupDrafts] = useState<Record<string, string>>({});
  const [keyActionError, setKeyActionError] = useState<string | null>(null);
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
  const routeBalance = routeKey
    ? routeKey.stationBalance ?? accountByStation.get(routeKey.stationId)?.account.balance
    : undefined;
  const gatewayRouteRows = (gatewayStatus?.routeQueue ?? []).map((route, index) => ({
    index,
    route,
    keyRow: keys.find((row) => row.stationId === route.stationId && row.key.id === route.keyId),
    health: gatewayStatus?.routeHealth.find((item) => item.stationId === route.stationId && item.keyId === route.keyId),
  }));
  const activeKeyRowId = gatewayStatus?.activeStationId && gatewayStatus.activeKeyId
    ? `${gatewayStatus.activeStationId}:${gatewayStatus.activeKeyId}`
    : previewKeyId;
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
  const openCodexFile = async (fileName: "auth.json" | "config.toml") => {
    setGatewayError(null);
    try {
      if (!isTauri()) throw new Error("配置文件只能在桌面应用中打开");
      const { configDirectory } = await settingsApi.codexIntegration();
      const separator = configDirectory.includes("\\") ? "\\" : "/";
      const directory = configDirectory.replace(/[\\/]+$/, "");
      await openPath(`${directory}${separator}${fileName}`);
    } catch (reason) {
      setGatewayError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const enableKey = async (row: KeyRow) => {
    const id = keyRowId(row);
    if (enablingKeyId || activeKeyRowId === id) return;
    setEnablingKeyId(id);
    setKeyActionError(null);
    try {
      if (isTauri()) setGatewayStatus(await gatewayApi.setRoute(row.stationId, row.key.id));
      else setPreviewKeyId(id);
    } catch (reason) {
      setKeyActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setEnablingKeyId(null);
    }
  };
  const changeKeyGroup = async (row: KeyRow, group: string) => {
    const id = keyRowId(row);
    const previous = groupDrafts[id] ?? row.key.group ?? "default";
    if (group === previous || groupSavingKeyId) return;
    setGroupDrafts((current) => ({ ...current, [id]: group }));
    setGroupSavingKeyId(id);
    setKeyActionError(null);
    let updated = false;
    try {
      if (isTauri()) {
        await apiKeyApi.updateGroup(row.stationId, row.key.id, group);
        updated = true;
        await onRefresh();
      }
    } catch (reason) {
      if (!updated) setGroupDrafts((current) => ({ ...current, [id]: previous }));
      setKeyActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setGroupSavingKeyId(null);
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
        title="站点与密匙"
        description={`${keys.length} 个 API 密匙 · ${online}/${stations.length} 个站点正常运行`}
        action={<button type="button" className="button-secondary sub2-dashboard-icon-action" title="同步站点" aria-label="同步站点" onClick={() => void onRefresh()}><RefreshCw size={15} /></button>}
      >
        <div className="sub2-dashboard-key-list">
          {keys.map((row) => {
            const id = keyRowId(row);
            const groupValue = groupDrafts[id] ?? row.key.group ?? "default";
            const groups = row.groups.length ? row.groups : [{ name: groupValue }];
            const busy = enablingKeyId === id || groupSavingKeyId === id;
            const enabled = activeKeyRowId === id;
            const balance = row.stationBalance ?? accountByStation.get(row.stationId)?.account.balance;
            return <div className="sub2-dashboard-key-row" key={id}>
              <div className="sub2-dashboard-key-content">
                <div className="sub2-dashboard-key-station"><strong>{row.stationName}</strong><span>剩余：{formatRemaining(balance)}</span></div>
                <div className="sub2-dashboard-key-meta">
                  <strong className="sub2-dashboard-key-name" title={row.key.name || row.key.id}>{row.key.name || "未命名密钥"}</strong>
                  <GroupRateSelect className="sub2-dashboard-key-group" value={groupValue} groups={groups} disabled={busy} onChange={(group) => void changeKeyGroup(row, group)} />
                </div>
              </div>
              <button type="button" className="button-primary sub2-dashboard-key-enable" aria-pressed={enabled} title={enabled ? "当前已启用" : "启用此 API 密钥"} disabled={busy || enabled} onClick={() => void enableKey(row)}>{enabled ? "已启用" : enablingKeyId === id ? "启用中" : "启用"}</button>
            </div>;
          })}
          {!keys.length && <div className="sub2-dashboard-empty">尚未添加 API 密钥</div>}
        </div>
        {keyActionError && <p className="sub2-dashboard-key-error" role="alert">{keyActionError}</p>}
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
        {connectionMode === "localRouting" ? (
          <section className="sub2-dashboard-route-pool" aria-label="本地路由池">
            <div className="sub2-dashboard-route-pool-heading">
              <div><span>本地路由池</span><strong>{gatewayRouteRows.length} 条路由</strong></div>
              <span>{online}/{stations.length} 个站点可用</span>
            </div>
            <div className="sub2-dashboard-route-list" role="list">
              {gatewayRouteRows.map(({ index, route, keyRow, health }) => {
                const stationName = keyRow?.stationName ?? route.stationId;
                const keyName = keyRow?.key.name || keyRow?.key.id || route.keyId;
                const state = health?.state;
                const cooldown = state === "open" && (health?.cooldownRemainingMs ?? 0) > 0
                  ? ` · 冷却 ${formatCooldown(health?.cooldownRemainingMs ?? 0)}`
                  : "";
                return <div className="sub2-dashboard-route-row" role="listitem" key={`${route.stationId}:${route.keyId}`}>
                  <span className="sub2-dashboard-route-order" aria-hidden="true">{index + 1}</span>
                  <div className="sub2-dashboard-route-content">
                    <div className="sub2-dashboard-route-title"><strong title={stationName}>{stationName}</strong><span title={keyName}>{keyName}</span></div>
                    <small>{health ? `${formatNumber(health.totalRequests)} 次请求 · 失败 ${formatNumber(health.failedRequests)}` : "等待健康数据"}</small>
                  </div>
                  <span className={`sub2-dashboard-route-state ${gatewayRouteStateClass(state)}`}>{gatewayRouteStateLabel(state)}{cooldown}</span>
                </div>;
              })}
              {!gatewayRouteRows.length && <div className="sub2-dashboard-route-empty"><strong>本地路由池暂无路由</strong><span>添加可用路由后会显示在这里</span></div>}
            </div>
          </section>
        ) : (
          <>
            <div className="sub2-dashboard-config-grid">
              <button type="button" className="sub2-dashboard-config-file" title="使用默认程序打开 auth.json" aria-label="打开 auth.json" onClick={() => void openCodexFile("auth.json")}><span>认证文件</span><code><FileText size={13} aria-hidden="true" />auth.json</code></button>
              <button type="button" className="sub2-dashboard-config-file" title="使用默认程序打开 config.toml" aria-label="打开 config.toml" onClick={() => void openCodexFile("config.toml")}><span>路由文件</span><code><FileText size={13} aria-hidden="true" />config.toml</code></button>
            </div>
            <div className="sub2-dashboard-detail-grid">
              <div>
                <span>API 密钥</span>
                <strong title={routeKey?.key.name || routeKey?.key.id}>{routeKey ? routeKey.key.name || routeKey.key.id : "尚未选择"}</strong>
                {routeKey && <code title={routeKey.key.maskedKey}>{routeKey.key.maskedKey || "已隐藏"}</code>}
                {routeKey && <small>分组：{routeKey.key.group || "default"}</small>}
              </div>
              <div>
                <span>当前中转站</span>
                <strong title={routeKey?.stationName}>{routeKey ? routeKey.stationName : "尚未选择"}</strong>
                {routeKey && <code title={routeKey.stationUrl}>{routeKey.stationUrl}</code>}
                {routeKey && <small>剩余：{formatRemaining(routeBalance)}</small>}
              </div>
            </div>
          </>
        )}
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
