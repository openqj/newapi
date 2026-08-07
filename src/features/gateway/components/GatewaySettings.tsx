import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDown, ArrowUp, CheckCircle2, CircleAlert, Loader2, Plus, Power, RefreshCw, RotateCcw, Save, Server, Trash2 } from "lucide-react";
import { Button, EmptyState, FormField, IconButton, InlineAlert, List, ListItem, Panel, SelectField, TextField, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { isTauri } from "../../../lib/platform";
import type { KeyRow } from "../../api-keys";
import { gatewayApi } from "../api";
import type { ConnectionMode, GatewayRouteHealth, GatewayRouteSelection, GatewayStatus, RoutingMode } from "../types";
import "./GatewaySettings.css";

type BusyAction = "mode" | "port" | "routes" | "gateway" | "health" | null;

function routeKey(route: GatewayRouteSelection) {
  return `${route.stationId}\u0000${route.keyId}`;
}

function rowRoute(row: KeyRow): GatewayRouteSelection {
  return { stationId: row.stationId, keyId: row.key.id };
}

function formatCooldown(milliseconds: number) {
  if (milliseconds <= 0) return "可立即探测";
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return `${Math.ceil(milliseconds / 1000)} 秒`;
}

function formatLastFailure(value?: string | null) {
  if (!value) return "暂无";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { dateStyle: "short", timeStyle: "medium" });
}

function healthLabel(health?: GatewayRouteHealth) {
  if (!health || health.state === "closed") return "正常";
  if (health.state === "halfOpen") return "半开探测";
  return "熔断中";
}

function currentRouteLabel(status: GatewayStatus | null, keyRows: KeyRow[]) {
  if (!status?.hasActiveRoute || !status.activeStationId || !status.activeKeyId) return "暂无成功路由";
  const row = keyRows.find((item) => item.stationId === status.activeStationId && item.key.id === status.activeKeyId);
  return row ? `${row.stationName} / ${row.key.name || row.key.id}` : `${status.activeStationId} / ${status.activeKeyId}`;
}

export function GatewaySettings({ keyRows }: { keyRows: KeyRow[] }) {
  const { notify } = useToast();
  const draftDirtyRef = useRef(false);
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [draftRoutes, setDraftRoutes] = useState<GatewayRouteSelection[]>([]);
  const [candidate, setCandidate] = useState("");
  const [portDraft, setPortDraft] = useState("");
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const applyStatus = useCallback((next: GatewayStatus, syncRoutes = false) => {
    setStatus(next);
    setPortDraft(String(next.port));
    if (syncRoutes || !draftDirtyRef.current) setDraftRoutes(next.routeQueue);
  }, []);

  const refresh = useCallback(async (showLoading = false) => {
    if (!isTauri()) {
      setLoading(false);
      return;
    }
    if (showLoading) setLoading(true);
    try {
      applyStatus(await gatewayApi.status());
      setError(null);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [applyStatus]);

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  useEffect(() => {
    if (!status?.running) return;
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, [refresh, status?.running]);

  const availableRows = useMemo(
    () => keyRows.filter((row) => !draftRoutes.some((route) => route.stationId === row.stationId && route.keyId === row.key.id)),
    [draftRoutes, keyRows],
  );

  useEffect(() => {
    if (!availableRows.some((row) => routeKey(rowRoute(row)) === candidate)) setCandidate(availableRows[0] ? routeKey(rowRoute(availableRows[0])) : "");
  }, [availableRows, candidate]);

  const markDraft = (next: GatewayRouteSelection[]) => {
    draftDirtyRef.current = true;
    setDraftRoutes(next);
  };

  const run = async (action: Exclude<BusyAction, null>, request: () => Promise<GatewayStatus>, successMessage?: string, syncRoutes = false) => {
    setBusyAction(action);
    setError(null);
    try {
      const next = await request();
      if (syncRoutes) {
        draftDirtyRef.current = false;
        setDraftRoutes(next.routeQueue);
      }
      applyStatus(next, syncRoutes);
      if (successMessage) notify(successMessage, "success");
    } catch (reason) {
      const message = errorMessage(reason);
      setError(message);
      notify(message, "error");
    } finally {
      setBusyAction(null);
    }
  };

  const switchMode = (mode: RoutingMode) => {
    if (!status || busyAction || (mode === status.mode && status.connectionMode !== "disabled")) return;
    void run("mode", () => gatewayApi.setMode(mode), mode === "localGateway" ? "已切换到本地路由" : "已切换到直转", true);
  };

  const savePort = () => {
    const port = Number.parseInt(portDraft, 10);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("本地路由端口必须是 1 到 65535 之间的整数");
      return;
    }
    void run("port", () => gatewayApi.setPort(port), "本地路由端口已保存");
  };

  const saveRoutes = () => {
    if (status?.mode !== "localGateway") {
      setError("请先切换到本地路由模式，再保存路由池");
      return;
    }
    if (!draftRoutes.length) {
      setError("至少保留一条本地路由");
      return;
    }
    void run("routes", () => gatewayApi.setRoutes(draftRoutes), "本地路由池已保存", true);
  };

  const toggleGateway = () => {
    if (!status || status.mode !== "localGateway") return;
    void run("gateway", status.running ? gatewayApi.stop : gatewayApi.start, status.running ? "本地路由已停止" : "本地路由已启动");
  };

  const addRoute = () => {
    const row = availableRows.find((item) => routeKey(rowRoute(item)) === candidate);
    if (!row) return;
    markDraft([...draftRoutes, rowRoute(row)]);
  };

  const moveRoute = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draftRoutes.length) return;
    const next = [...draftRoutes];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    markDraft(next);
  };

  const removeRoute = (route: GatewayRouteSelection) => {
    if (draftRoutes.length <= 1) return;
    markDraft(draftRoutes.filter((item) => routeKey(item) !== routeKey(route)));
  };

  const resetHealth = (route: GatewayRouteSelection) => {
    void run("health", () => gatewayApi.resetRouteHealth(route.stationId, route.keyId), "路由健康状态已恢复");
  };

  const healthByRoute = useMemo(() => new Map((status?.routeHealth ?? []).map((health) => [routeKey(health), health])), [status?.routeHealth]);
  const configuredRow = (route: GatewayRouteSelection) => keyRows.find((row) => row.stationId === route.stationId && row.key.id === route.keyId);
  const isTauriApp = isTauri();
  const connectionMode: ConnectionMode = status?.connectionMode
    ?? (status?.mode === "localGateway" ? "localRouting" : status ? "direct" : "disabled");

  return <div className="gateway-settings">
    <Panel className="settings-panel gateway-panel" title="本地路由" description="让 ChatGPT / Codex 连接固定本地地址，再由 RelayHub 按优先级和健康状态选择上游。">
      {!isTauriApp && <InlineAlert kind="info">本地路由仅在 RelayHub 桌面应用中运行。</InlineAlert>}
      {error && <InlineAlert onDismiss={() => setError(null)}>{error}</InlineAlert>}
      <div className="gateway-topline">
        <div>
          <span className="gateway-eyebrow">路由入口</span>
          <div className="gateway-mode-switch" role="group" aria-label="本地路由模式">
            <Button variant="test" className={`is-status ${connectionMode === "disabled" ? "active" : ""}`} aria-pressed={connectionMode === "disabled"} disabled title="Codex 当前使用本地配置，RelayHub 未接管">未开启</Button>
            <Button variant="test" className={connectionMode === "direct" ? "active" : ""} aria-pressed={connectionMode === "direct"} disabled={!status || Boolean(busyAction) || !isTauriApp} onClick={() => switchMode("ccSwitch")}>直转</Button>
            <Button variant="test" className={connectionMode === "localRouting" ? "active" : ""} aria-pressed={connectionMode === "localRouting"} disabled={!status || Boolean(busyAction) || !isTauriApp} onClick={() => switchMode("localGateway")}>本地路由</Button>
          </div>
          <p className="gateway-helper">直转写入站点地址和 API 密钥；本地路由写入下方固定地址，由本地路由负责转发。</p>
        </div>
        <div className="gateway-running-actions">
          <span className={`gateway-running-badge ${connectionMode === "disabled" || !status?.running ? "offline" : "online"}`}><i />{connectionMode === "disabled" ? "未接管" : status?.running ? "运行中" : "已停止"}</span>
          <Button variant="secondary" disabled={!status || status.mode !== "localGateway" || Boolean(busyAction) || !isTauriApp} onClick={toggleGateway}><Power size={15} />{busyAction === "gateway" ? "处理中" : status?.running ? "停止本地路由" : "启动本地路由"}</Button>
          <IconButton variant="secondary" label="刷新本地路由状态" disabled={loading || Boolean(busyAction) || !isTauriApp} onClick={() => void refresh(true)} icon={<RefreshCw size={15} className={loading ? "gateway-spin" : ""} />} />
        </div>
      </div>

      <div className="gateway-overview-grid">
        <div className="gateway-overview-card">
          <span>固定 Base URL</span>
          <code>{status?.baseUrl ?? "http://127.0.0.1:18765/v1"}</code>
          <small>客户端只需配置一次，后续切换由 RelayHub 完成。</small>
        </div>
        <div className="gateway-overview-card gateway-port-card">
          <FormField label="本地端口" hint="仅监听 127.0.0.1，不暴露到局域网。"><div className="gateway-inline-field"><TextField type="number" min="1" max="65535" inputMode="numeric" value={portDraft} onChange={(event) => setPortDraft(event.target.value)} disabled={!isTauriApp || Boolean(busyAction)} /><Button variant="secondary" disabled={!status || Boolean(busyAction) || !isTauriApp} onClick={savePort}>{busyAction === "port" ? "保存中" : "保存端口"}</Button></div></FormField>
        </div>
        <div className="gateway-overview-card">
          <span>当前生效路由</span>
          <strong>{currentRouteLabel(status, keyRows)}</strong>
          <small>{status?.hasActiveRoute ? "最近一次成功请求使用的上游" : "尚未成功转发请求"}</small>
        </div>
      </div>
    </Panel>

    <Panel className="settings-panel gateway-panel" title="路由池" description="按顺序尝试路由；失败路由会进入冷却，恢复后自动半开探测。">
      <div className="gateway-route-adder">
        <FormField label="添加站点 / API 密钥" hint={keyRows.length ? "密钥只显示脱敏值，不会写入前端状态或日志。" : "请先在 API 密钥页面添加可用密钥。"}>
          <div className="gateway-inline-field gateway-route-add-field"><SelectField value={candidate} onChange={(event) => setCandidate(event.target.value)} disabled={!availableRows.length || Boolean(busyAction) || !isTauriApp}><option value="">选择站点 / API 密钥</option>{availableRows.map((row) => <option key={routeKey(rowRoute(row))} value={routeKey(rowRoute(row))}>{row.stationName} / {row.key.name || row.key.id} · {row.key.maskedKey}</option>)}</SelectField><Button variant="primary" disabled={!candidate || !availableRows.length || Boolean(busyAction) || !isTauriApp} onClick={addRoute}><Plus size={15} />添加路由</Button></div>
        </FormField>
      </div>

      {loading && !status ? <div className="gateway-loading"><Loader2 size={18} className="gateway-spin" />正在读取本地路由状态…</div> : draftRoutes.length === 0 ? <EmptyState title="还没有本地路由" description="添加至少一条站点 / API 密钥后，保存路由池即可启用动态转发。" /> : <List className="gateway-route-list" aria-live="polite">{draftRoutes.map((route, index) => {
        const row = configuredRow(route);
        const health = healthByRoute.get(routeKey(route));
        const active = status?.activeStationId === route.stationId && status.activeKeyId === route.keyId;
        return <ListItem as="article" className={`gateway-route-row ${active ? "active" : ""}`} key={routeKey(route)}>
          <div className="gateway-route-priority" aria-label={`优先级 ${index + 1}`}><strong>{index + 1}</strong><span>优先级</span></div>
          <div className="gateway-route-details"><div className="gateway-route-title"><Server size={16} /><strong>{row ? row.stationName : route.stationId}</strong>{active && <span className="gateway-active-badge">当前生效</span>}</div><div className="gateway-route-meta"><span>{row?.key.name || route.keyId}</span><span>{row?.key.maskedKey || "已保存密钥"}</span>{row?.stationUrl && <span title={row.stationUrl}>{row.stationUrl}</span>}</div></div>
          <div className={`gateway-health gateway-health-${health?.state ?? "closed"}`}><span className="gateway-health-title">{health?.state === "open" ? <CircleAlert size={15} /> : health?.state === "halfOpen" ? <Activity size={15} /> : <CheckCircle2 size={15} />}{healthLabel(health)}</span><small>{health?.state === "open" ? `冷却剩余 ${formatCooldown(health.cooldownRemainingMs)}` : `失败 ${health?.failedRequests ?? 0} 次 · 连续 ${health?.consecutiveFailures ?? 0} 次`}</small><small>最近失败：{formatLastFailure(health?.lastFailureAt)}</small></div>
          <div className="gateway-route-actions"><IconButton variant="secondary" label={`上移 ${row?.stationName || route.stationId} 路由`} disabled={index === 0 || Boolean(busyAction) || !isTauriApp} onClick={() => moveRoute(index, -1)} icon={<ArrowUp size={15} />} /><IconButton variant="secondary" label={`下移 ${row?.stationName || route.stationId} 路由`} disabled={index === draftRoutes.length - 1 || Boolean(busyAction) || !isTauriApp} onClick={() => moveRoute(index, 1)} icon={<ArrowDown size={15} />} />{health && health.state !== "closed" && <IconButton variant="secondary" label={`恢复 ${row?.stationName || route.stationId} 路由`} disabled={Boolean(busyAction) || !isTauriApp} onClick={() => resetHealth(route)} icon={<RotateCcw size={15} />} />}<IconButton variant="secondary" label={`移除 ${row?.stationName || route.stationId} 路由`} disabled={draftRoutes.length <= 1 || Boolean(busyAction) || !isTauriApp} onClick={() => removeRoute(route)} icon={<Trash2 size={15} />} /></div>
        </ListItem>;
      })}</List>}

      <footer className="gateway-route-footer"><span>{draftRoutes.length} 条路由 · 当前顺序决定失败转移优先级</span><Button variant="primary" disabled={!status || status.mode !== "localGateway" || !draftRoutes.length || !draftDirtyRef.current || Boolean(busyAction) || !isTauriApp} onClick={saveRoutes}><Save size={15} />{busyAction === "routes" ? "保存中" : "保存路由池"}</Button></footer>
      {connectionMode === "disabled" ? <p className="gateway-mode-hint">当前 Codex 使用本地配置，请选择直转或本地路由后由 RelayHub 接管。</p> : status?.mode !== "localGateway" && <p className="gateway-mode-hint">当前为直转模式。切换到本地路由后，路由池才会参与转发。</p>}
    </Panel>
  </div>;
}
