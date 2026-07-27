import { useEffect, useState } from "react";
import { InlineAlert, usePrompt } from "./components/ui";
import { ApiDetectionPage } from "./features/api-detection";
import {
  ApiKeysPage,
  apiKeyApi,
  type KeyInfo,
  type KeyRow,
} from "./features/api-keys";
import { accountApi, AccountsPage, type AccountRow } from "./features/accounts";
import { DashboardPage } from "./features/dashboard";
import { OffersPage, type Offer } from "./features/offers";
import { MessagesDialog } from "./features/notifications";
import { AppSidebar } from "./components/AppSidebar";
import {
  remoteApi,
  RemoteConfigPage,
  type RemoteServer,
} from "./features/remote";
import { LoginProfilesPage, type LoginProfile } from "./features/profiles";
import { rateApi, RatesPage, type Rate, type RateRow } from "./features/rates";
import { SettingsPage } from "./features/settings";
import {
  AddStationWithProfiles,
  EmptyWorkspace,
  stationApi,
  type Station,
} from "./features/stations";
import {
  UsagePage,
  usageApi,
  type UsageLog,
  type UsageSummary,
} from "./features/usage";
import { type AppView } from "./app/routes";
import { isTauri } from "./lib/platform";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Bell,
  Minimize2,
  Minus,
  Square,
  X,
} from "lucide-react";
import "./App.css";

type SyncProgress = { operationId: string; completed: number; total: number; currentStation?: string; status: string };
type Snapshot = {
  stationBalance?: number;
  rates: Rate[];
  apiKeys: KeyInfo[];
  offers: Offer[];
  unavailable: string[];
  usage?: UsageSummary;
};
type SyncResult = {
  station: Station;
  snapshot: Snapshot;
  changed: boolean;
  changeSummary: string[];
};
const emptySnapshot: Snapshot = {
  rates: [],
  apiKeys: [],
  offers: [],
  unavailable: [],
};
const emptyUsageSummary: UsageSummary = {};
const demoTime = Math.floor(Date.now() / 1000);
const demoStations: Station[] = [
  {
    id: "demo-alpha",
    name: "Alpha Gateway",
    baseUrl: "https://alpha.example.com",
    kind: "newapi",
    status: "online",
    lastSyncedAt: demoTime - 90,
  },
  {
    id: "demo-orbit",
    name: "Orbit API",
    baseUrl: "https://orbit.example.com",
    kind: "sub2api",
    status: "online",
    lastSyncedAt: demoTime - 260,
  },
  {
    id: "demo-nova",
    name: "Nova Relay",
    baseUrl: "https://nova.example.com",
    kind: "newapi",
    status: "partial",
    lastSyncedAt: demoTime - 780,
    lastError: "优惠公告接口未公开",
  },
];
const demoUsageSummary: UsageSummary = {
  todayInputTokens: 1_300_000,
  todayOutputTokens: 539_600,
  todayRequests: 264,
  totalRequests: 570,
  todaySpent: 1.1064,
  todayLimit: 14.7522,
  totalSpent: 1.9554,
  totalLimit: 25.241,
};
const demoLoginProfiles: LoginProfile[] = [
  { id: "demo-profile", name: "常用中转站账号", username: "relay@example.com" },
];
const demoUsageLogs: UsageLog[] = [
  {
    id: "usage-1",
    stationId: "demo-alpha",
    stationName: "Alpha Gateway",
    stationUrl: "https://alpha.example.com",
    apiKeyName: "alpha-team",
    groupName: "default",
    endpoint: "/v1/chat/completions",
    ipAddress: "198.51.100.24",
    reasoningEffort: "medium",
    billingType: "按量",
    billingMode: "standard",
    model: "gpt-4o",
    inputTokens: 12480,
    outputTokens: 2340,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    actualCost: 0.0314,
    requestType: "stream",
    durationMs: 1840,
    createdAt: demoTime - 720,
  },
  {
    id: "usage-2",
    stationId: "demo-orbit",
    stationName: "Orbit API",
    stationUrl: "https://orbit.example.com",
    apiKeyName: "orbit-research",
    groupName: "codex | 快速通道",
    endpoint: "/v1/responses",
    ipAddress: "203.0.113.18",
    reasoningEffort: "high",
    billingType: "按量",
    billingMode: "standard",
    model: "claude-3-7-sonnet",
    inputTokens: 8060,
    outputTokens: 1620,
    cacheCreationTokens: 0,
    cacheReadTokens: 1024,
    actualCost: 0.0218,
    requestType: "sync",
    durationMs: 1240,
    createdAt: demoTime - 2140,
  },
  {
    id: "usage-3",
    stationId: "demo-alpha",
    stationName: "Alpha Gateway",
    stationUrl: "https://alpha.example.com",
    apiKeyName: "alpha-team",
    groupName: "default",
    endpoint: "/v1/chat/completions",
    ipAddress: "198.51.100.24",
    reasoningEffort: "low",
    billingType: "按量",
    billingMode: "standard",
    model: "gemini-2.5-pro",
    inputTokens: 32400,
    outputTokens: 4890,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    actualCost: 0.0942,
    requestType: "stream",
    durationMs: 3150,
    createdAt: demoTime - 5100,
  },
];
const demoRemoteServers: RemoteServer[] = [
  {
    id: "remote-1",
    name: "新加坡中转机",
    host: "203.0.113.18",
    port: 22,
    username: "root",
    authType: "key",
    privateKeyPath: "C:\\Users\\me\\.ssh\\relayhub",
    codexVersion: "codex 0.93.0",
    codexLatestVersion: "0.93.0",
    codexUpdateAvailable: false,
    relayUrl: "https://alpha.example.com/v1",
    relayKeySource: "Alpha Gateway / alpha-key-1",
    relayKeyMasked: "sk-...a8Qw",
    updatedAt: demoTime - 300,
  },
];
const demoSnapshots: Record<string, Snapshot> = {
  "demo-alpha": {
    stationBalance: 14.7522,
    rates: [
      {
        group: "default",
        model: "gpt-4o",
        multiplier: 1,
        inputMultiplier: 1,
        outputMultiplier: 1,
      },
      {
        group: "default",
        model: "claude-3-7-sonnet",
        multiplier: 1.08,
        inputMultiplier: 1.05,
        outputMultiplier: 1.12,
      },
      {
        group: "vip",
        model: "gpt-4.1",
        multiplier: 0.92,
        inputMultiplier: 0.92,
        outputMultiplier: 0.96,
      },
      {
        group: "vip",
        model: "gemini-2.5-pro",
        multiplier: 1.15,
        inputMultiplier: 1.1,
        outputMultiplier: 1.2,
      },
    ],
    apiKeys: [
      {
        id: "alpha-key-1",
        name: "开发环境",
        maskedKey: "sk-...a8Qw",
        group: "default",
        status: "有效",
        remainingQuota: 12.8,
        currentConcurrency: 2,
        usedQuota: 1.1064,
        todaySpent: 0.1383,
        last30DaysSpent: 0.4637,
        expiresAt: demoTime + 86_400 * 28,
        createdAt: demoTime - 86_400 * 14,
      },
      {
        id: "alpha-key-2",
        name: "Codex",
        maskedKey: "sk-...M3xP",
        group: "vip",
        status: "有效",
        remainingQuota: 8.42,
        currentConcurrency: 1,
        usedQuota: 0.849,
        expiresAt: demoTime + 86_400 * 8,
        createdAt: demoTime - 86_400 * 3,
      },
    ],
    offers: [
      {
        id: "alpha-offer",
        title: "Claude 系列本周倍率优惠",
        summary: "Claude Sonnet 在 VIP 分组享受限时倍率调整，活动截至本周日。",
        sourceUrl: "https://alpha.example.com",
        publishedAt: demoTime - 86_400,
      },
      {
        id: "alpha-price",
        title: "新套餐：专业版月付",
        summary: "新增专业版套餐，包含更多高并发额度与优先模型通道。",
        sourceUrl: "https://alpha.example.com",
        publishedAt: demoTime - 86_400 * 3,
      },
    ],
    unavailable: [],
    usage: {
      todayInputTokens: 820_000,
      todayOutputTokens: 312_400,
      todayRequests: 161,
      totalRequests: 360,
      todaySpent: 0.7024,
      todayLimit: 9.7522,
      totalSpent: 1.211,
      totalLimit: 16.0,
    },
  },
  "demo-orbit": {
    stationBalance: 8.19,
    rates: [
      {
        group: "standard",
        model: "gpt-4o-mini",
        multiplier: 0.65,
        inputMultiplier: 0.65,
        outputMultiplier: 0.7,
      },
      {
        group: "standard",
        model: "deepseek-v3",
        multiplier: 0.72,
        inputMultiplier: 0.72,
        outputMultiplier: 0.72,
      },
    ],
    apiKeys: [
      {
        id: "orbit-key-1",
        name: "自动化",
        maskedKey: "sk-...7Lx2",
        group: "standard",
        status: "有效",
        remainingQuota: 6.7,
        currentConcurrency: 3,
        usedQuota: 0.404,
        expiresAt: demoTime + 86_400 * 17,
        createdAt: demoTime - 86_400 * 20,
      },
    ],
    offers: [
      {
        id: "orbit-offer",
        title: "Gemini 2.5 模型上新",
        summary: "标准分组现已开放 Gemini 2.5 Flash，按最新价格计划结算。",
        sourceUrl: "https://orbit.example.com",
        publishedAt: demoTime - 86_400 * 2,
      },
    ],
    unavailable: [],
    usage: {
      todayInputTokens: 480_000,
      todayOutputTokens: 227_200,
      todayRequests: 103,
      totalRequests: 210,
      todaySpent: 0.404,
      todayLimit: 5.0,
      totalSpent: 0.7444,
      totalLimit: 9.241,
    },
  },
  "demo-nova": {
    stationBalance: 2.1,
    rates: [],
    apiKeys: [],
    offers: [],
    unavailable: ["分组倍率未公开或当前账户无权限", "优惠公告不可获取"],
    usage: {
      todayInputTokens: 0,
      todayOutputTokens: 0,
      todayRequests: 0,
      totalRequests: 0,
    },
  },
};
const demoKeyRows: KeyRow[] = demoStations.flatMap((station) =>
  (demoSnapshots[station.id]?.apiKeys ?? []).map((key) => ({
    stationId: station.id,
    stationName: station.name,
    stationUrl: station.baseUrl,
    stationBalance: demoSnapshots[station.id]?.stationBalance,
    groups: Array.from(
      new Map(
        (demoSnapshots[station.id]?.rates ?? []).map((rate) => [
          rate.group,
          { name: rate.group, multiplier: rate.multiplier },
        ]),
      ).values(),
    ),
    models: [
      ...new Set(
        (demoSnapshots[station.id]?.rates ?? []).map((rate) => rate.model),
      ),
    ],
    key,
  })),
);
const demoRateRows: RateRow[] = demoStations.flatMap((station) =>
  (demoSnapshots[station.id]?.rates ?? []).map((rate) => ({
    stationId: station.id,
    stationName: station.name,
    stationUrl: station.baseUrl,
    lastSyncedAt: station.lastSyncedAt,
    syncStatus: station.status,
    rate,
  })),
);
const demoAccountRows: AccountRow[] = demoStations.map((station, index) => ({
  stationId: station.id,
  stationName: station.name,
  stationUrl: station.baseUrl,
  kind: station.kind,
  syncStatus: station.status,
  lastSyncedAt: station.lastSyncedAt,
  account: {
    id: String(index + 1),
    username: ["alpha", "orbit", "nova"][index] ?? "account",
    displayName: ["Alpha 团队", "Orbit 团队", "Nova 团队"][index] ?? "账户",
    email: ["alpha@example.com", "orbit@example.com", "nova@example.com"][index],
    group: index === 1 ? "standard" : "default",
    role: "user",
    status: "active",
    balance: demoSnapshots[station.id]?.stationBalance,
  },
  usage: demoSnapshots[station.id]?.usage ?? emptyUsageSummary,
}));
const statusText = (status: string) =>
  ({
    online: "在线",
    partial: "部分可用",
    error: "需要处理",
    connecting: "连接中",
  })[status] ?? "未同步";
const openStationUrl = (url: string) =>
  isTauri() ? openUrl(url) : window.open(url, "_blank", "noopener");
function App() {
  const prompt = usePrompt();
  const [stations, setStations] = useState<Station[]>(() =>
    isTauri() ? [] : demoStations,
  );
  const [selectedId, setSelectedId] = useState<string | undefined>(() =>
    isTauri() ? undefined : demoStations[0].id,
  );
  const [snapshot, setSnapshot] = useState<Snapshot>(() =>
    isTauri() ? emptySnapshot : demoSnapshots[demoStations[0].id],
  );
  const [keyRows, setKeyRows] = useState<KeyRow[]>(() =>
    isTauri() ? [] : demoKeyRows,
  );
  const [rateRows, setRateRows] = useState<RateRow[]>(() =>
    isTauri() ? [] : demoRateRows,
  );
  const [accountRows, setAccountRows] = useState<AccountRow[]>(() =>
    isTauri() ? [] : demoAccountRows,
  );
  const [usageSummary, setUsageSummary] = useState<UsageSummary>(() =>
    isTauri() ? emptyUsageSummary : demoUsageSummary,
  );
  const [usageLogs, setUsageLogs] = useState<UsageLog[]>(() =>
    isTauri() ? [] : demoUsageLogs,
  );
  const [remoteServers, setRemoteServers] = useState<RemoteServer[]>(() =>
    isTauri() ? [] : demoRemoteServers,
  );
  const [usageScope, setUsageScope] = useState<"all" | "current">("all");
  const [view, setView] = useState<AppView>("overview");
  const [showAdd, setShowAdd] = useState(false);
  const [showMessages, setShowMessages] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncProgress, setSyncProgress] = useState<SyncProgress | null>(null);
  const [error, setError] = useState("");
  const selected = stations.find((station) => station.id === selectedId);
  void selected;

  const loadStations = async () => {
    if (!isTauri()) {
      setStations(demoStations);
      return;
    }
    try {
      const next = await stationApi.list<Station[]>();
      setStations(next);
      setSelectedId((current) =>
        current && next.some((station) => station.id === current)
          ? current
          : next[0]?.id,
      );
    } catch (reason) {
      setError(String(reason));
    }
  };
  const loadSnapshot = async (id?: string) => {
    if (!isTauri())
      return setSnapshot(
        id ? (demoSnapshots[id] ?? emptySnapshot) : emptySnapshot,
      );
    if (!id) return setSnapshot(emptySnapshot);
    try {
      setSnapshot(
        (await stationApi.snapshot<Snapshot>(id)) ??
          emptySnapshot,
      );
    } catch (reason) {
      setError(String(reason));
    }
  };
  const loadKeyRows = async () => {
    if (!isTauri()) {
      setKeyRows(demoKeyRows);
      return;
    }
    try {
      setKeyRows(await apiKeyApi.rows<KeyRow[]>());
    } catch (reason) {
      setError(String(reason));
    }
  };
  const loadRateRows = async () => {
    if (!isTauri()) {
      setRateRows(demoRateRows);
      return;
    }
    try {
      setRateRows(await rateApi.rows<RateRow[]>());
    } catch (reason) {
      setError(String(reason));
    }
  };
  const loadAccountRows = async () => {
    if (!isTauri()) {
      setAccountRows(demoAccountRows);
      return;
    }
    try {
      setAccountRows(await accountApi.rows<AccountRow[]>());
    } catch (reason) {
      setError(String(reason));
    }
  };
  const loadUsageSummary = async () => {
    if (!isTauri()) {
      setUsageSummary(demoUsageSummary);
      return;
    }
    try {
      setUsageSummary(await usageApi.summary<UsageSummary>());
    } catch (reason) {
      setError(String(reason));
    }
  };
  const loadUsageLogs = async () => {
    if (!isTauri()) {
      setUsageLogs(demoUsageLogs);
      return;
    }
    try {
      setUsageLogs(await usageApi.logs<UsageLog[]>());
    } catch (reason) {
      setError(String(reason));
    }
  };
  const loadRemoteServers = async () => {
    if (!isTauri()) {
      setRemoteServers(demoRemoteServers);
      return;
    }
    try {
      setRemoteServers(await remoteApi.list<RemoteServer[]>());
    } catch (reason) {
      setError(String(reason));
    }
  };
  useEffect(() => {
    void loadStations();
    void loadUsageSummary();
  }, []);
  useEffect(() => {
    void loadSnapshot(selectedId);
  }, [selectedId]);
  useEffect(() => {
    if (view === "keys" || view === "overview" || view === "apiDetection") void loadKeyRows();
  }, [view]);
  useEffect(() => {
    if (view === "accounts") void loadAccountRows();
  }, [view]);
  useEffect(() => {
    if (view === "rates") void loadRateRows();
  }, [view]);
  useEffect(() => {
    if (view === "usage" || view === "overview") void loadUsageLogs();
  }, [view]);
  useEffect(() => {
    if (view === "remote") {
      void loadRemoteServers();
      void loadKeyRows();
    }
  }, [view]);
  useEffect(() => {
    const timer = window.setInterval(() => void refreshAll(), 30 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [stations.length]);
  useEffect(() => {
    if (!busy || !isTauri()) return;
    const update = () => void stationApi.syncProgress<SyncProgress>().then(setSyncProgress).catch(() => undefined);
    update();
    const timer = window.setInterval(update, 500);
    return () => window.clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    const syncMaximized = () => {
      void appWindow.isMaximized().then(setIsMaximized).catch(() => undefined);
    };

    syncMaximized();
    void appWindow.onResized(syncMaximized).then((nextUnlisten) => {
      unlisten = nextUnlisten;
    });
    return () => unlisten?.();
  }, []);

  const refreshAll = async () => {
    if (!isTauri()) return;
    setBusy(true);
    setError("");
    try {
      await stationApi.refreshAll<SyncResult[]>();
      await loadStations();
      await loadSnapshot(selectedId);
      await loadKeyRows();
      await loadAccountRows();
      await loadRateRows();
      await loadUsageSummary();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
      setSyncProgress(null);
    }
  };
  const cancelRefresh = async () => {
    try { await stationApi.cancelSync(); }
    catch (reason) { setError(String(reason)); }
  };
  const refreshSelected = async () => {
    if (!selectedId || !isTauri()) return;
    setBusy(true);
    setError("");
    try {
      await stationApi.refresh<SyncResult>(selectedId);
      await loadStations();
      await loadSnapshot(selectedId);
      await loadKeyRows();
      await loadAccountRows();
      await loadRateRows();
      await loadUsageSummary();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const reauthenticateSelected = async () => {
    if (!selectedId || !isTauri()) return;
    const totp = await prompt({ title: "二步验证", description: "如站点启用二步验证，请输入验证码；否则留空。", label: "验证码", inputMode: "numeric" });
    setBusy(true);
    setError("");
    try {
      await stationApi.reauthenticate<SyncResult>(selectedId, totp?.trim() || null);
      await loadStations();
      await loadSnapshot(selectedId);
      await loadKeyRows();
      await loadRateRows();
      await loadUsageSummary();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  const clearSelectedSession = async () => {
    if (!selectedId || !isTauri()) return;
    setBusy(true);
    setError("");
    try {
      await stationApi.clearSession(selectedId);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  };
  void refreshSelected;
  void reauthenticateSelected;
  void clearSelectedSession;
  const controlWindow = async (action: "minimize" | "maximize" | "close") => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    try {
      if (action === "minimize") await appWindow.minimize();
      if (action === "maximize") await appWindow.toggleMaximize();
      if (action === "close") await appWindow.close();
    } catch (reason) {
      setError(String(reason));
    }
  };
  const startWindowDrag = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isTauri() || event.button !== 0 || event.detail > 1) return;
    try {
      await getCurrentWindow().startDragging();
    } catch (reason) {
      setError(String(reason));
    }
  };

  return (
    <div className="app-shell min-h-screen text-slate-900">
      <header className="window-titlebar">
        <div
          className="window-drag-region"
          onMouseDown={(event) => void startWindowDrag(event)}
          onDoubleClick={() => void controlWindow("maximize")}
        />
        <div className="window-titlebar-actions">
          <button
            type="button"
            className="window-station-button"
            title={selected ? `${selected.name} · ${statusText(selected.status)}` : "前往 API 密钥"}
            onClick={() => setView("keys")}
          >
            <span className={`station-status-dot ${selected?.status ?? "unknown"}`} aria-hidden="true" />
            <span className="window-station-name">{selected?.name ?? "未选择中转站"}</span>
          </button>
          <button
            type="button"
            className="window-action-button"
            aria-label="消息"
            title="消息"
            onClick={() => setShowMessages(true)}
          >
            <Bell size={16} />
          </button>
          <button
            type="button"
            className="window-action-button"
            aria-label="最小化"
            title="最小化"
            onClick={() => void controlWindow("minimize")}
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            className="window-action-button"
            aria-label={isMaximized ? "还原" : "最大化"}
            title={isMaximized ? "还原" : "最大化"}
            onClick={() => void controlWindow("maximize")}
          >
            {isMaximized ? <Minimize2 size={15} /> : <Square size={14} />}
          </button>
          <button
            type="button"
            className="window-action-button window-close-button"
            aria-label="关闭"
            title="关闭"
            onClick={() => void controlWindow("close")}
          >
            <X size={17} />
          </button>
        </div>
      </header>
      <div className="app-content flex min-h-screen">
        <AppSidebar view={view} usage={usageScope === "current" ? (snapshot.usage ?? emptyUsageSummary) : usageSummary} usageScope={usageScope} onScopeChange={setUsageScope} onNavigate={setView} onAddStation={() => setShowAdd(true)} />
        <main className="min-w-0 flex-1">
          <section className="content-surface">
            {error && <div className="mb-4"><InlineAlert onDismiss={() => setError("")}>{error}</InlineAlert></div>}
            {busy && <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"><div className="min-w-0"><strong>正在同步站点</strong><span className="ml-2 text-slate-500">{syncProgress?.currentStation ?? "准备中"} · {syncProgress?.completed ?? 0}/{syncProgress?.total ?? stations.length}</span><div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><i className="block h-full bg-black transition-all" style={{ width: `${Math.min(100, ((syncProgress?.completed ?? 0) / Math.max(1, syncProgress?.total ?? stations.length)) * 100)}%` }} /></div></div><button className="button-secondary whitespace-nowrap" onClick={() => void cancelRefresh()}>取消同步</button></div>}
            {view === "overview" && stations.length === 0 && (
              <EmptyWorkspace onAdd={() => setShowAdd(true)} />
            )}
            {(view !== "overview" || stations.length > 0) && (
              <>
                {view === "settings" && <SettingsPage onManageProfiles={() => setView("profiles")} />}
                {view === "overview" && (
                  <DashboardPage
                    stations={stations}
                    keys={keyRows}
                    summary={usageSummary}
                    usageRows={usageLogs}
                    onRefresh={refreshAll}
                    onNavigate={setView}
                  />
                )}
                {view === "rates" && (
                  <RatesPage
                    rows={rateRows}
                    stations={stations}
                    unavailableStationCount={stations.filter((station) => !rateRows.some((row) => row.stationId === station.id)).length}
                    onRefresh={loadRateRows}
                    onOpenStation={(url) => { void openStationUrl(url); }}
                  />
                )}
                {view === "accounts" && (
                  <AccountsPage
                    rows={accountRows}
                    stations={stations}
                    onRefresh={refreshAll}
                    onOpenStation={(url) => { void openStationUrl(url); }}
                    onAdd={() => setShowAdd(true)}
                  />
                )}
                {view === "keys" && (
                  <ApiKeysPage
                    rows={keyRows}
                    stations={stations}
                    setError={setError}
                    onUpdated={async () => {
                      await loadStations();
                      await loadSnapshot(selectedId);
                      await loadKeyRows();
                      await loadAccountRows();
                      await loadRateRows();
                      await loadUsageSummary();
                    }}
                  />
                )}
                {view === "usage" && (
                  <UsagePage rows={usageLogs} stations={stations} onRefresh={loadUsageLogs} />
                )}
                {view === "apiDetection" && <ApiDetectionPage keyRows={keyRows} />}
                {view === "remote" && (
                  <RemoteConfigPage
                    servers={remoteServers}
                    keyRows={keyRows}
                    onChanged={loadRemoteServers}
                    setError={setError}
                  />
                )}
                {view === "profiles" && (
                  <LoginProfilesPage
                    demoProfiles={demoLoginProfiles}
                    setError={setError}
                    onAddStation={() => setShowAdd(true)}
                  />
                )}
                {view === "offers" && <OffersPage offers={snapshot.offers} />}
                {snapshot.unavailable.length > 0 && (
                  <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    <strong>部分数据不可获取：</strong>
                    {snapshot.unavailable.join("；")}
                  </div>
                )}
              </>
            )}
          </section>
        </main>
      </div>
      {showAdd && (
        <AddStationWithProfiles
          demoProfiles={demoLoginProfiles}
          onClose={() => setShowAdd(false)}
          onManageProfiles={() => {
            setShowAdd(false);
            setView("profiles");
          }}
          onAdded={async (keepOpen) => {
            if (!keepOpen) setShowAdd(false);
            await loadStations();
            await loadUsageSummary();
          }}
          setError={setError}
        />
      )}
      {showMessages && (
        <MessagesDialog
          stationName={selected?.name ?? "当前中转站"}
          offers={snapshot.offers}
          onClose={() => setShowMessages(false)}
        />
      )}
    </div>
  );
}

export default App;
