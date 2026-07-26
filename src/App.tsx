import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DataTable, FormDialog, TableBulkActions } from "./components/ui";
import { ApiDetectionPage } from "./features/api-detection";
import { primaryNavigation, type AppView } from "./app/routes";
import { isTauri } from "./lib/platform";
import {
  Sub2Accounts,
  Sub2ApiKeys,
  Sub2Dashboard,
  Sub2Rates,
  Sub2Usage,
  type AccountRow,
} from "./components/Sub2ApiPages";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Bell,
  Check,
  ChevronDown,
  CircleAlert,
  Clipboard,
  Clock3,
  Download,
  ExternalLink,
  FolderOpen,
  KeyRound,
  LogIn,
  Minimize2,
  Minus,
  Pencil,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
  Settings,
  Square,
  Trash2,
  X,
} from "lucide-react";
import "./App.css";

type Station = {
  id: string;
  name: string;
  baseUrl: string;
  kind: string;
  status: string;
  lastSyncedAt?: number;
  lastError?: string;
};
type Rate = {
  group: string;
  model: string;
  multiplier: number;
  inputMultiplier?: number;
  outputMultiplier?: number;
};
type KeyInfo = {
  id: string;
  name: string;
  maskedKey: string;
  group?: string;
  status: string;
  remainingQuota?: number;
  totalQuota?: number;
  unlimitedQuota?: boolean;
  currentConcurrency?: number;
  usedQuota?: number;
  todaySpent?: number;
  last30DaysSpent?: number;
  expiresAt?: number;
  createdAt?: number;
};
type Offer = {
  id: string;
  title: string;
  summary: string;
  sourceUrl: string;
  publishedAt?: number;
};
type UsageSummary = {
  todayInputTokens?: number;
  todayOutputTokens?: number;
  todayRequests?: number;
  totalRequests?: number;
  todaySpent?: number;
  todayLimit?: number;
  totalSpent?: number;
  totalLimit?: number;
};
type SyncProgress = { operationId: string; completed: number; total: number; currentStation?: string; status: string };
type Snapshot = {
  stationBalance?: number;
  rates: Rate[];
  apiKeys: KeyInfo[];
  offers: Offer[];
  unavailable: string[];
  usage?: UsageSummary;
};
type KeyRow = {
  stationId: string;
  stationName: string;
  stationUrl: string;
  stationBalance?: number;
  groups: GroupOption[];
  models: string[];
  key: KeyInfo;
};
type RateRow = {
  stationId: string;
  stationName: string;
  stationUrl: string;
  lastSyncedAt?: number;
  syncStatus: string;
  rate: Rate;
};
type SyncResult = {
  station: Station;
  snapshot: Snapshot;
  changed: boolean;
  changeSummary: string[];
};
type StationConnectionResult = {
  success: boolean;
  status: "online" | "error";
  reason?: string;
};
type StationSaveResult = {
  station: Station;
  connection: StationConnectionResult;
};
type GroupOption = { name: string; multiplier?: number };
type ModelTestResult = {
  model: string;
  response?: string;
  error?: string;
  elapsedMs: number;
};
type LoginProfile = { id: string; name: string; username: string };
type UsageLog = {
  id: string;
  stationId: string;
  stationName: string;
  stationUrl?: string;
  apiKeyName?: string;
  groupName?: string;
  endpoint?: string;
  ipAddress?: string;
  reasoningEffort?: string;
  billingType?: string;
  billingMode?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  actualCost: number;
  requestType: string;
  durationMs?: number;
  createdAt: number;
};
type RemoteServer = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: string;
  privateKeyPath?: string;
  codexVersion?: string;
  codexLatestVersion?: string;
  codexUpdateAvailable?: boolean;
  hostKeyFingerprint?: string;
  relayUrl?: string;
  relayProvider?: string;
  relayKeySource?: string;
  relayKeyMasked?: string;
  relayConfigFingerprint?: string;
  connectionStatus?: "online" | "warning" | "error";
  connectionError?: string;
  lastSyncedAt?: number;
  lastSyncStatus?: string;
  lastSyncError?: string;
  updatedAt: number;
};
type RemoteConnectionResult = {
  success: boolean;
  status: "online" | "warning" | "error";
  code?: number;
  reason?: string;
  hostKeyFingerprint?: string;
  requiresHostKeyConfirmation?: boolean;
};
type RemoteServerSaveResult = {
  server: RemoteServer;
  connection: RemoteConnectionResult;
};
type RemoteSyncLog = {
  id: number;
  serverId: string;
  status: string;
  action: string;
  summary: string;
  configFingerprint?: string;
  createdAt: number;
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
const formatTime = (time?: number) =>
  time
    ? new Intl.DateTimeFormat("zh-CN", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(time * 1000)
    : "尚未同步";
const statusText = (status: string) =>
  ({
    online: "在线",
    partial: "部分可用",
    error: "需要处理",
    connecting: "连接中",
  })[status] ?? "未同步";
const openStationUrl = (url: string) =>
  isTauri() ? openUrl(url) : window.open(url, "_blank", "noopener");
const formatValue = (value?: number | null) =>
  value == null
    ? "-"
    : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(
        value,
      );

function App() {
  const [hasNewVersion, setHasNewVersion] = useState(false);
  const pendingUpdate = useRef<{ version: string; downloadAndInstall: () => Promise<void> } | null>(null);
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
      const next = await invoke<Station[]>("list_stations");
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
        (await invoke<Snapshot | null>("get_snapshot", { id })) ??
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
      setKeyRows(await invoke<KeyRow[]>("list_key_rows"));
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
      setRateRows(await invoke<RateRow[]>("list_rate_rows"));
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
      setAccountRows(await invoke<AccountRow[]>("list_account_rows"));
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
      setUsageSummary(await invoke<UsageSummary>("get_usage_summary"));
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
      setUsageLogs(await invoke<UsageLog[]>("list_usage_logs"));
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
      setRemoteServers(await invoke<RemoteServer[]>("list_remote_servers"));
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
    const update = () => void invoke<SyncProgress | null>("get_sync_progress").then(setSyncProgress).catch(() => undefined);
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

  const checkForUpdates = async () => {
    if (!isTauri()) return;
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const update = await check();
      pendingUpdate.current = update;
      setHasNewVersion(Boolean(update));
    } catch {
      // 更新源尚未发布首个版本时保持静默，不影响正常使用。
    }
  };
  const installUpdate = async () => {
    const update = pendingUpdate.current;
    if (!update) return void checkForUpdates();
    if (!window.confirm(`发现 RelayHub ${update.version}，现在下载并重启安装吗？`)) return;
    try {
      await update.downloadAndInstall();
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (reason) { setError(`更新失败：${String(reason)}`); }
  };
  useEffect(() => { void checkForUpdates(); }, []);

  const refreshAll = async () => {
    if (!isTauri()) return;
    setBusy(true);
    setError("");
    try {
      await invoke<SyncResult[]>("refresh_all");
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
    try { await invoke("cancel_sync"); }
    catch (reason) { setError(String(reason)); }
  };
  const refreshSelected = async () => {
    if (!selectedId || !isTauri()) return;
    setBusy(true);
    setError("");
    try {
      await invoke<SyncResult>("refresh_station", { id: selectedId });
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
    const totp = window.prompt("如站点启用二步验证，请输入验证码；否则留空。");
    setBusy(true);
    setError("");
    try {
      await invoke<SyncResult>("reauthenticate_station", {
        id: selectedId,
        totp: totp?.trim() || null,
      });
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
      await invoke("clear_station_session", { id: selectedId });
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
        <aside className="app-sidebar flex w-56 shrink-0 flex-col px-4 py-4">
          <div className="mb-5 flex items-center gap-3 px-2">
            <div className="flex items-center gap-3">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-fuchsia-400 to-violet-500 text-white shadow-sm">
                <KeyRound size={19} />
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <p className="text-lg font-semibold">RelayHub</p>
              {hasNewVersion && (
                <button
                  type="button"
                  className="button-secondary version-button"
                  onClick={() => void installUpdate()}
                  title="检测到新版本"
                >
                  New
                </button>
              )}
            </div>
          </div>
          <nav className="space-y-1">
            <Nav
              active={false}
              icon={<Plus size={16} />}
              label="添加站点"
              onClick={() => setShowAdd(true)}
            />
            {primaryNavigation.map(({ view: itemView, label, Icon }) => (
              <Nav
                key={itemView}
                active={view === itemView}
                icon={<Icon size={16} />}
                label={label}
                onClick={() => setView(itemView)}
              />
            ))}
          </nav>
          <SidebarStats
            usage={
              usageScope === "current"
                ? (snapshot.usage ?? emptyUsageSummary)
                : usageSummary
            }
            scope={usageScope}
            onScopeChange={setUsageScope}
          />
        </aside>
        <main className="min-w-0 flex-1">
          <section className="content-surface">
            {error && (
              <div className="mb-4 flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                <span className="flex items-center gap-2">
                  <CircleAlert size={16} />
                  {error}
                </span>
                <button onClick={() => setError("")}>
                  <X size={16} />
                </button>
              </div>
            )}
            {busy && <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"><div className="min-w-0"><strong>正在同步站点</strong><span className="ml-2 text-slate-500">{syncProgress?.currentStation ?? "准备中"} · {syncProgress?.completed ?? 0}/{syncProgress?.total ?? stations.length}</span><div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><i className="block h-full bg-black transition-all" style={{ width: `${Math.min(100, ((syncProgress?.completed ?? 0) / Math.max(1, syncProgress?.total ?? stations.length)) * 100)}%` }} /></div></div><button className="button-secondary whitespace-nowrap" onClick={() => void cancelRefresh()}>取消同步</button></div>}
            {view === "overview" && stations.length === 0 && (
              <EmptyState onAdd={() => setShowAdd(true)} />
            )}
            {(view !== "overview" || stations.length > 0) && (
              <>
                {view === "settings" && <SettingsView onManageProfiles={() => setView("profiles")} />}
                {view === "overview" && (
                  <Sub2Dashboard
                    stations={stations}
                    keys={keyRows}
                    summary={usageSummary}
                    usageRows={usageLogs}
                    onRefresh={refreshAll}
                    onNavigate={setView}
                  />
                )}
                {view === "rates" && (
                  <Sub2Rates
                    rows={rateRows}
                    stations={stations}
                    unavailableStationCount={stations.filter((station) => !rateRows.some((row) => row.stationId === station.id)).length}
                    onRefresh={loadRateRows}
                    onOpenStation={(url) => { void openStationUrl(url); }}
                  />
                )}
                {view === "accounts" && (
                  <Sub2Accounts
                    rows={accountRows}
                    stations={stations}
                    onRefresh={refreshAll}
                    onOpenStation={(url) => { void openStationUrl(url); }}
                    onAdd={() => setShowAdd(true)}
                  />
                )}
                {view === "keys" && (
                  <Sub2ApiKeys
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
                  <Sub2Usage rows={usageLogs} stations={stations} onRefresh={loadUsageLogs} />
                )}
                {view === "apiDetection" && <ApiDetectionPage keyRows={keyRows} />}
                {view === "remote" && (
                  <RemoteConfig
                    servers={remoteServers}
                    keyRows={keyRows}
                    onChanged={loadRemoteServers}
                    setError={setError}
                  />
                )}
                {view === "profiles" && (
                  <LoginProfilesPage setError={setError} onAddStation={() => setShowAdd(true)} />
                )}
                {view === "offers" && <Offers offers={snapshot.offers} />}
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

function MessagesDialog({
  stationName,
  offers,
  onClose,
}: {
  stationName: string;
  offers: Offer[];
  onClose: () => void;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="modal messages-dialog" role="dialog" aria-modal="true" aria-label="消息">
        <div className="form-dialog-header">
          <div>
            <h2 className="font-semibold">消息</h2>
            <p className="form-dialog-description">{stationName} 的最新公告</p>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </div>
        <div className="messages-list">
          {offers.map((offer) => (
            <article className="message-item" key={offer.id}>
              <h3>{offer.title}</h3>
              <p>{offer.summary}</p>
              <time>{formatTime(offer.publishedAt)}</time>
            </article>
          ))}
          {offers.length === 0 && <p className="messages-empty">暂无消息。</p>}
        </div>
      </section>
    </div>
  );
}

function Nav({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`nav-item ${active ? "nav-item-active" : ""}`}
      onClick={onClick}
    >
      {icon}
      <span className="nav-label">{label}</span>
    </button>
  );
}
function SidebarStats({
  usage,
  scope,
  onScopeChange,
}: {
  usage: UsageSummary;
  scope: "all" | "current";
  onScopeChange: (scope: "all" | "current") => void;
}) {
  const tokens =
    usage.todayInputTokens == null &&
    usage.todayOutputTokens == null
      ? undefined
      : (usage.todayInputTokens ?? 0) + (usage.todayOutputTokens ?? 0);
  return (
    <div className="sidebar-stats">
      <div className="sidebar-stat-tabs" role="tablist" aria-label="用量范围">
        <button
          className={
            scope === "all" ? "sidebar-stat-tab active" : "sidebar-stat-tab"
          }
          onClick={() => onScopeChange("all")}
          role="tab"
          aria-selected={scope === "all"}
        >
          全部
        </button>
        <button
          className={
            scope === "current" ? "sidebar-stat-tab active" : "sidebar-stat-tab"
          }
          onClick={() => onScopeChange("current")}
          role="tab"
          aria-selected={scope === "current"}
        >
          当前站点
        </button>
      </div>
      <SidebarStat
        label="今日 Token"
        value={formatCompact(tokens)}
        detail={`输入: ${formatCompact(usage.todayInputTokens)} / 输出: ${formatCompact(usage.todayOutputTokens)}`}
      />
      <SidebarStat
        label="今日消费"
        value={`${formatCurrency(usage.todaySpent)} / ${formatCurrency(usage.todayLimit)}`}
        detail={`总计: ${formatCurrency(usage.totalSpent)} / ${formatCurrency(usage.totalLimit)}`}
      />
    </div>
  );
}
function SidebarStat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="sidebar-stat">
      <p>{label}</p>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}
function formatCompact(value?: number | null) {
  if (value == null) return "--";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return new Intl.NumberFormat("zh-CN").format(value);
}
function formatCurrency(value?: number | null) {
  return value == null ? "--" : `$${value.toFixed(4)}`;
}
function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="grid min-h-[500px] place-items-center">
      <div className="max-w-sm text-center">
        <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-teal-50 text-teal-700">
          <KeyRound size={24} />
        </div>
        <h1 className="text-xl font-semibold">添加第一个中转站</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          保存普通用户登录态后，RelayHub
          会集中追踪你的可用分组、倍率、密钥和站点优惠。
        </p>
        <button className="button-primary mt-5" onClick={onAdd}>
          <Plus size={16} />
          添加站点
        </button>
      </div>
    </div>
  );
}
function Overview({
  stations,
  selected,
  snapshot,
  onRefresh,
  onReauthenticate,
  onClearSession,
  busy,
}: {
  stations: Station[];
  selected?: Station;
  snapshot: Snapshot;
  onRefresh: () => void;
  onReauthenticate: () => void;
  onClearSession: () => void;
  busy: boolean;
}) {
  return (
    <>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-slate-500">监控总览</p>
          <h1 className="mt-1 text-2xl font-semibold">
            {selected?.name ?? "所有站点"}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="button-secondary"
            onClick={onReauthenticate}
            disabled={!selected || busy}
          >
            <LogIn size={15} />
            重新认证
          </button>
          <button
            className="icon-button"
            title="清除本地会话"
            onClick={onClearSession}
            disabled={!selected || busy}
          >
            <X size={15} />
          </button>
          <button
            className="button-secondary"
            onClick={onRefresh}
            disabled={!selected || busy}
          >
            <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
            刷新此站
          </button>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-4 gap-4">
        <Metric
          label="已连接站点"
          value={String(stations.filter((s) => s.status === "online").length)}
          note={`共 ${stations.length} 个`}
        />
        <Metric
          label="倍率记录"
          value={String(snapshot.rates.length)}
          note="当前站点"
        />
        <Metric
          label="API 密钥"
          value={String(snapshot.apiKeys.length)}
          note="仅展示元数据"
        />
        <Metric
          label="最新优惠"
          value={String(snapshot.offers.length)}
          note="公告与套餐"
        />
      </div>
      <section className="mt-7">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">站点状态</h2>
          <span className="text-xs text-slate-500">自动刷新：30 分钟</span>
        </div>
        <DataTable>
          <table>
            <thead>
              <tr>
                <th>站点</th>
                <th>类型</th>
                <th>状态</th>
                <th>最近同步</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {stations.map((station) => (
                <tr key={station.id}>
                  <td className="font-medium">{station.name}</td>
                  <td className="uppercase text-slate-500">{station.kind}</td>
                  <td>
                    <span className={`status-label ${station.status}`}>
                      {statusText(station.status)}
                    </span>
                  </td>
                  <td>{formatTime(station.lastSyncedAt)}</td>
                  <td className="max-w-xs truncate text-slate-500">
                    {station.lastError ?? "用户可见数据已就绪"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTable>
      </section>
    </>
  );
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-slate-400">{note}</p>
    </div>
  );
}
function KeyUsage({ apiKey }: { apiKey: KeyInfo }) {
  return (
    <div className="key-usage">
      <span>今日: {formatCurrency(apiKey.todaySpent)}</span>
      <span>近30天: {formatCurrency(apiKey.last30DaysSpent)}</span>
    </div>
  );
}
function Keys({
  rows,
  setError,
  onUpdated,
}: {
  rows: KeyRow[];
  setError: (value: string) => void;
  onUpdated: () => Promise<void>;
}) {
  const [targetApp, setTargetApp] = useState("claude");
  const [showModelTest, setShowModelTest] = useState(false);
  const [groupOverrides, setGroupOverrides] = useState<Record<string, string>>(
    {},
  );
  const [savingGroups, setSavingGroups] = useState<Record<string, boolean>>({});
  const rowId = (row: KeyRow) => `${row.stationId}-${row.key.id}`;
  const rowGroup = (row: KeyRow) =>
    groupOverrides[rowId(row)] ?? row.key.group ?? "默认";
  const rowGroups = (row: KeyRow) =>
    row.groups.some((group) => group.name === rowGroup(row))
      ? row.groups
      : [{ name: rowGroup(row) }, ...row.groups];
  const reveal = async (row: KeyRow) => {
    if (!confirm("仅在本次操作中读取完整 API Key，是否继续？")) return;
    try {
      const key = await invoke<string>("reveal_key", {
        stationId: row.stationId,
        keyId: row.key.id,
      });
      await navigator.clipboard.writeText(key);
      window.setTimeout(() => navigator.clipboard.writeText(""), 30000);
    } catch (reason) {
      setError(String(reason));
    }
  };
  const importToCcSwitch = async (row: KeyRow) => {
    if (
      !confirm(
        `将按需读取此密钥并交给 CC Switch 导入到 ${targetApp}，是否继续？`,
      )
    )
      return;
    try {
      await invoke("import_to_cc_switch", {
        stationId: row.stationId,
        keyId: row.key.id,
        targetApp,
      });
    } catch (reason) {
      setError(String(reason));
    }
  };
  const selectGroup = async (row: KeyRow, group: string) => {
    if (group === rowGroup(row)) return;
    const id = rowId(row);
    setSavingGroups((current) => ({ ...current, [id]: true }));
    try {
      if (isTauri()) {
        await invoke<SyncResult>("update_key_group", {
          stationId: row.stationId,
          keyId: row.key.id,
          group,
        });
        await onUpdated();
      } else setGroupOverrides((current) => ({ ...current, [id]: group }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSavingGroups((current) => ({ ...current, [id]: false }));
    }
  };
  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-sm text-slate-500">所有已同步站点</p>
          <h1 className="mt-1 text-2xl font-semibold">API 密钥</h1>
          <p className="mt-2 text-sm text-slate-500">
            站点名称会在默认浏览器打开。密钥明文只在复制、导入或测试时按需读取。
          </p>
        </div>
        <div className="flex items-end gap-3">
          <label className="w-40 text-xs text-slate-500">
            CC Switch 目标
            <select
              className="input mt-1"
              value={targetApp}
              onChange={(event) => setTargetApp(event.target.value)}
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
          <button
            className="button-primary whitespace-nowrap"
            onClick={() => setShowModelTest(true)}
            disabled={rows.length === 0}
          >
            <Play size={16} />
            一键测试
          </button>
        </div>
      </div>
      <DataTable className="remote-config-table-wrap mt-5">
        <table className="min-w-[1240px]">
          <thead>
            <tr>
              <th>中转站名称</th>
              <th>站点余额</th>
              <th>密钥名称</th>
              <th>API 密钥</th>
              <th>分组</th>
              <th>当前并发</th>
              <th>用量</th>
              <th>过期时间</th>
              <th>状态</th>
              <th>创建时间</th>
              <th>导入</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowId(row)}>
                <td>
                  <button
                    className="inline-flex items-center gap-1 font-medium text-teal-700 hover:underline"
                    onClick={() => void openStationUrl(row.stationUrl)}
                  >
                    {row.stationName}
                    <ExternalLink size={13} />
                  </button>
                </td>
                <td>{formatValue(row.stationBalance)}</td>
                <td className="font-medium">{row.key.name || "未命名"}</td>
                <td>
                  <div className="api-key-cell">
                    <span className="api-key-mask">
                      {row.key.maskedKey || "已遮罩"}
                    </span>
                    <button
                      className="icon-button"
                      title="读取并复制"
                      onClick={() => void reveal(row)}
                    >
                      <Clipboard size={15} />
                    </button>
                  </div>
                </td>
                <td>
                  <select
                    className="group-select"
                    aria-label={`${row.stationName} ${row.key.name || "未命名密钥"} 分组`}
                    value={rowGroup(row)}
                    onChange={(event) =>
                      void selectGroup(row, event.target.value)
                    }
                    disabled={
                      savingGroups[rowId(row)] || rowGroups(row).length === 0
                    }
                  >
                    {rowGroups(row).map((group) => (
                      <option key={group.name} value={group.name}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <span
                    className={`concurrency-badge ${(row.key.currentConcurrency ?? 0) > 0 ? "active" : ""}`}
                  >
                    {row.key.currentConcurrency ?? "-"}
                  </span>
                </td>
                <td>
                  <KeyUsage apiKey={row.key} />
                </td>
                <td>{formatTime(row.key.expiresAt)}</td>
                <td>
                  <span className="status-label online">
                    {row.key.status || "有效"}
                  </span>
                </td>
                <td>{formatTime(row.key.createdAt)}</td>
                <td>
                  <button
                    className="button-secondary whitespace-nowrap"
                    onClick={() => importToCcSwitch(row)}
                  >
                    CC Switch
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="empty-cell">
                  尚无已同步的 API 密钥。请先刷新站点。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </DataTable>
      {showModelTest && (
        <ModelTestDialog rows={rows} onClose={() => setShowModelTest(false)} />
      )}
    </>
  );
}

function ModelTestDialog({
  rows,
  onClose,
}: {
  rows: KeyRow[];
  onClose: () => void;
}) {
  const [selectedId, setSelectedId] = useState(
    () => `${rows[0]?.stationId}-${rows[0]?.key.id}`,
  );
  const selectedRow =
    rows.find((row) => `${row.stationId}-${row.key.id}` === selectedId) ??
    rows[0];
  const selectedModels = selectedRow?.models ?? [];
  const [model, setModel] = useState(() => rows[0]?.models[0] ?? "");
  const [testMode, setTestMode] = useState<"chat" | "responses">("chat");
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<ModelTestResult[]>([]);
  const [testError, setTestError] = useState("");
  const selectKey = (value: string) => {
    const row = rows.find(
      (item) => `${item.stationId}-${item.key.id}` === value,
    );
    setSelectedId(value);
    setModel(row?.models[0] ?? "");
    setResults([]);
    setTestError("");
  };
  const runTest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedRow || !model) return;
    setTesting(true);
    setResults([]);
    setTestError("");
    try {
      const models = model === "__all__" ? selectedModels : [model];
      if (isTauri())
        setResults(
          await invoke<ModelTestResult[]>("test_api_models", {
            stationId: selectedRow.stationId,
            keyId: selectedRow.key.id,
            models,
            testMode,
          }),
        );
      else
        setResults(
          models.map((item, index) => ({
            model: item,
            response: "Hi! 模型已正常响应。",
            elapsedMs: 184 + index * 13,
          })),
        );
    } catch (reason) {
      setTestError(String(reason));
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="model-test-dialog"
        onSubmit={runTest}
        role="dialog"
        aria-modal="true"
        aria-labelledby="model-test-title"
      >
        <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 id="model-test-title" className="font-semibold">
              一键测试
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              发送提示词 hi，确认模型是否能正常响应。
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            title="关闭"
            onClick={onClose}
            disabled={testing}
          >
            <X size={17} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <label>
            API 密钥
            <select
              className="input mt-1"
              value={selectedId}
              onChange={(event) => selectKey(event.target.value)}
              disabled={testing}
            >
              {rows.map((row) => (
                <option
                  key={`${row.stationId}-${row.key.id}`}
                  value={`${row.stationId}-${row.key.id}`}
                >
                  {row.stationName} · {row.key.name || "未命名"} ·{" "}
                  {row.key.maskedKey || "已遮罩"}
                </option>
              ))}
            </select>
          </label>
          <label>
            测试模型
            <select
              className="input mt-1"
              value={model}
              onChange={(event) => {
                setModel(event.target.value);
                setResults([]);
                setTestError("");
              }}
              disabled={testing || selectedModels.length === 0}
            >
              <option value="__all__">
                全部已同步模型 ({selectedModels.length})
              </option>
              {selectedModels.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            {selectedModels.length === 0 && (
              <span className="mt-1 block text-xs font-normal text-amber-700">
                该密钥所在站点没有已同步的模型，请先刷新站点。
              </span>
            )}
          </label>
          <fieldset>
            <legend>测试模式</legend>
            <div className="test-mode-tabs">
              <button
                type="button"
                className={
                  testMode === "chat"
                    ? "test-mode-button active"
                    : "test-mode-button"
                }
                onClick={() => {
                  setTestMode("chat");
                  setResults([]);
                  setTestError("");
                }}
                disabled={testing}
              >
                Chat Completions
              </button>
              <button
                type="button"
                className={
                  testMode === "responses"
                    ? "test-mode-button active"
                    : "test-mode-button"
                }
                onClick={() => {
                  setTestMode("responses");
                  setResults([]);
                  setTestError("");
                }}
                disabled={testing}
              >
                Responses
              </button>
            </div>
          </fieldset>
          {testError && (
            <div className="test-result error" role="alert">
              <CircleAlert size={17} />
              <span>{testError}</span>
            </div>
          )}
          {results.length > 0 && (
            <div className="test-results" role="status">
              {results.map((item) => (
                <div
                  key={item.model}
                  className={
                    item.error ? "test-result error" : "test-result success"
                  }
                >
                  <div className="flex items-center gap-2 font-medium">
                    {item.error ? (
                      <CircleAlert size={17} />
                    ) : (
                      <Check size={17} />
                    )}
                    <span className="truncate">{item.model}</span>
                    <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-normal">
                      <Clock3 size={14} />
                      {item.elapsedMs} ms
                    </span>
                  </div>
                  <p>{item.error ?? item.response}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            className="button-secondary"
            onClick={onClose}
            disabled={testing}
          >
            取消
          </button>
          <button
            className="button-primary"
            type="submit"
            disabled={testing || !model}
          >
            {testing ? (
              <RefreshCw size={16} className="animate-spin" />
            ) : (
              <Play size={16} />
            )}
            {testing ? "测试中" : model === "__all__" ? "测试全部" : "开始测试"}
          </button>
        </div>
      </form>
    </div>
  );
}
function Offers({ offers }: { offers: Offer[] }) {
  return (
    <>
      <div>
        <p className="text-sm text-slate-500">汇总站点公告与套餐</p>
        <h1 className="mt-1 text-2xl font-semibold">优惠中心</h1>
      </div>
      <div className="mt-5 grid max-w-4xl gap-3">
        {offers.map((offer) => (
          <article
            className="rounded-xl border border-slate-100 bg-white p-5 shadow-sm"
            key={offer.id}
          >
            <div className="flex items-start justify-between gap-5">
              <div>
                <h2 className="font-semibold">{offer.title}</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
                  {offer.summary || "查看站点获取详情。"}
                </p>
              </div>
              <a
                className="button-secondary shrink-0"
                href={offer.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                打开站点
              </a>
            </div>
          </article>
        ))}
        {offers.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">
            当前站点没有可公开的公告或优惠。
          </div>
        )}
      </div>
    </>
  );
}
function SettingsView({ onManageProfiles }: { onManageProfiles: () => void }) {
  return (
    <>
      <p className="text-sm text-slate-500">本地应用设置</p>
      <h1 className="mt-1 text-2xl font-semibold">设置</h1>
      <div className="mt-6 max-w-2xl divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white shadow-sm">
        <SettingRow
          title="后台刷新"
          description="应用打开期间每 30 分钟自动刷新所有站点。"
          value="30 分钟"
        />
        <SettingRow
          title="桌面通知"
          description="仅在倍率、密钥状态或优惠内容发生变化时提醒。"
          value="已开启"
        />
        <SettingRow
          title="凭据存储"
          description="账号密码和登录态使用 Windows Credential Manager 保存。"
          value="系统凭据库"
        />
        <div className="flex items-center justify-between p-4">
          <div>
            <p className="font-medium">常用登录</p>
            <p className="mt-1 text-sm text-slate-500">管理用于快速填写中转站登录信息的本地凭据。</p>
          </div>
          <button type="button" className="button-secondary" onClick={onManageProfiles}>管理</button>
        </div>
      </div>
    </>
  );
}
function SettingRow({
  title,
  description,
  value,
}: {
  title: string;
  description: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between p-4">
      <div>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <span className="text-sm text-teal-700">{value}</span>
    </div>
  );
}
function UsageRecords({
  rows,
  onRefresh,
}: {
  rows: UsageLog[];
  onRefresh: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [range, setRange] = useState("30");
  const cutoff = Date.now() / 1000 - Number(range) * 86_400;
  const filtered = rows.filter(
    (row) =>
      row.createdAt >= cutoff &&
      `${row.stationName} ${row.model} ${row.requestType}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const totals = filtered.reduce(
    (current, row) => ({
      requests: current.requests + 1,
      tokens:
        current.tokens +
        row.inputTokens +
        row.outputTokens +
        row.cacheCreationTokens +
        row.cacheReadTokens,
      cost: current.cost + row.actualCost,
    }),
    { requests: 0, tokens: 0, cost: 0 },
  );
  return (
    <>
      <div>
        <p className="text-sm text-slate-500">参照 Sub2API 使用记录字段</p>
        <h1 className="mt-1 text-2xl font-semibold">使用记录</h1>
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3 max-w-3xl">
        <Metric
          label="请求数"
          value={formatCompact(totals.requests)}
          note="当前筛选范围"
        />
        <Metric
          label="Token 总量"
          value={formatCompact(totals.tokens)}
          note="输入、输出与缓存"
        />
        <Metric
          label="实际消费"
          value={formatCurrency(totals.cost)}
          note="当前筛选范围"
        />
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <input
          className="input w-72"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索站点、模型或请求类型"
        />
        <select
          className="input w-36"
          value={range}
          onChange={(event) => setRange(event.target.value)}
        >
          <option value="1">最近 24 小时</option>
          <option value="7">最近 7 天</option>
          <option value="30">最近 30 天</option>
        </select>
        <button className="button-secondary" onClick={() => void onRefresh()}>
          <RefreshCw size={15} />
          刷新
        </button>
        <span className="text-sm text-slate-500">{filtered.length} 条记录</span>
      </div>
      <DataTable className="mt-4">
        <table className="min-w-[1100px]">
          <thead>
            <tr>
              <th>时间</th>
              <th>站点</th>
              <th>模型</th>
              <th>输入</th>
              <th>输出</th>
              <th>缓存创建</th>
              <th>缓存读取</th>
              <th>实际消费</th>
              <th>请求类型</th>
              <th>耗时</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id}>
                <td>{formatTime(row.createdAt)}</td>
                <td className="font-medium">{row.stationName}</td>
                <td>{row.model || "-"}</td>
                <td>{formatCompact(row.inputTokens)}</td>
                <td>{formatCompact(row.outputTokens)}</td>
                <td>{formatCompact(row.cacheCreationTokens)}</td>
                <td>{formatCompact(row.cacheReadTokens)}</td>
                <td className="font-mono text-violet-700">
                  {formatCurrency(row.actualCost)}
                </td>
                <td>
                  <span className="status-label online">
                    {row.requestType || "sync"}
                  </span>
                </td>
                <td>{row.durationMs ? `${row.durationMs} ms` : "-"}</td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={10} className="empty-cell">
                  暂无符合筛选条件的使用记录。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </DataTable>
    </>
  );
}
function RemoteConfig({
  servers,
  keyRows,
  onChanged,
  setError,
}: {
  servers: RemoteServer[];
  keyRows: KeyRow[];
  onChanged: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingServer, setEditingServer] = useState<RemoteServer | null>(null);
  const [deletingServer, setDeletingServer] = useState<string | null>(null);
  const [testingServer, setTestingServer] = useState<string | null>(null);
  const [verifyingSession, setVerifyingSession] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [syncLogs, setSyncLogs] = useState<{ server: RemoteServer; entries: RemoteSyncLog[] } | null>(null);
  const [loadingLogs, setLoadingLogs] = useState<string | null>(null);
  const [selectedServerIds, setSelectedServerIds] = useState<string[]>([]);
  const [bulkSelection, setBulkSelection] = useState("");
  const [bulkAction, setBulkAction] = useState<"switch" | "test" | "delete" | null>(null);
  const [openSelection, setOpenSelection] = useState<string | null>(null);
  const [selectionMenuPosition, setSelectionMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const openSelectionAnchorRef = useRef<HTMLElement | null>(null);
  const selectionMenuRef = useRef<HTMLDivElement | null>(null);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [relayDrafts, setRelayDrafts] = useState<Record<string, { url: string; key: string }>>({});
  const [savingRelay, setSavingRelay] = useState<string | null>(null);
  const [codexAction, setCodexAction] = useState<string | null>(null);
  const [editingRelay, setEditingRelay] = useState<{ serverId: string; field: "url" | "key" } | null>(null);
  useEffect(() => {
    if (!openSelection) return;
    const closeSelection = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !openSelectionAnchorRef.current?.contains(target) &&
        !selectionMenuRef.current?.contains(target)
      ) {
        setOpenSelection(null);
        setSelectionMenuPosition(null);
      }
    };
    document.addEventListener("mousedown", closeSelection);
    return () => document.removeEventListener("mousedown", closeSelection);
  }, [openSelection]);
  const relayDraft = (server: RemoteServer) => relayDrafts[server.id] ?? { url: server.relayUrl ?? "", key: "" };
  const updateRelayDraft = (server: RemoteServer, patch: Partial<{ url: string; key: string }>) => setRelayDrafts((current) => ({ ...current, [server.id]: { ...relayDraft(server), ...patch } }));
  const cancelRelayEditing = (server: RemoteServer, field: "url" | "key") => { setRelayDrafts((current) => ({ ...current, [server.id]: { ...relayDraft(server), [field]: field === "url" ? server.relayUrl ?? "" : "" } })); setEditingRelay(null); };
  const switchKey = async (server: RemoteServer, value: string) => {
    const row = keyRows.find(
      (item) => `${item.stationId}:${item.key.id}` === value,
    );
    if (!row) return;
    setSaving(server.id);
    try {
      if (isTauri())
        await invoke("assign_remote_relay_key", {
          serverId: server.id,
          stationId: row.stationId,
          keyId: row.key.id,
        });
      setSelection((current) => ({ ...current, [server.id]: value }));
      await onChanged();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(null);
    }
  };
  const selectedKeyLabel = (serverId: string) => {
    const value = selection[serverId];
    const row = keyRows.find(
      (item) => `${item.stationId}:${item.key.id}` === value,
    );
    return row
      ? `${row.stationName} / ${row.key.name || row.key.id}`
      : "选择中转站密钥";
  };
  const selectedServers = servers.filter((server) => selectedServerIds.includes(server.id));
  const toggleServerSelection = (id: string) => {
    setSelectedServerIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };
  const toggleAllServers = () => {
    setSelectedServerIds((current) =>
      current.length === servers.length ? [] : servers.map((server) => server.id),
    );
  };
  const switchSelectedServers = async () => {
    const key = keyRows.find((row) => `${row.stationId}:${row.key.id}` === bulkSelection);
    if (!key || selectedServers.length === 0) return;
    setBulkAction("switch");
    const failures: string[] = [];
    try {
      for (const server of selectedServers) {
        try {
          setSaving(server.id);
          if (isTauri()) await invoke("assign_remote_relay_key", { serverId: server.id, stationId: key.stationId, keyId: key.key.id });
          setSelection((current) => ({ ...current, [server.id]: bulkSelection }));
        } catch (reason) {
          failures.push(server.name);
        } finally {
          setSaving(null);
        }
      }
      await onChanged();
      setTestResult({ success: failures.length === 0, message: failures.length === 0 ? `已切换 ${selectedServers.length} 台服务器的中转站密钥` : `${failures.length} 台服务器切换失败：${failures.join("、")}` });
    } finally {
      setBulkAction(null);
    }
  };
  const testSelectedServers = async () => {
    if (selectedServers.length === 0) return;
    setBulkAction("test");
    const failures: string[] = [];
    try {
      for (const server of selectedServers) {
        try {
          setTestingServer(server.id);
          const result = isTauri() ? await invoke<RemoteConnectionResult>("test_remote_server", { id: server.id }) : { success: true };
          if (!result.success) failures.push(server.name);
        } catch (reason) {
          failures.push(server.name);
        } finally {
          setTestingServer(null);
        }
      }
      await onChanged();
      setTestResult({ success: failures.length === 0, message: failures.length === 0 ? `${selectedServers.length} 台服务器 SSH 连接成功` : `${failures.length} 台服务器连接失败：${failures.join("、")}` });
    } finally {
      setBulkAction(null);
    }
  };
  const deleteSelectedServers = async () => {
    if (selectedServers.length === 0 || !window.confirm(`确认删除选中的 ${selectedServers.length} 台服务器吗？`)) return;
    setBulkAction("delete");
    const failures: string[] = [];
    try {
      for (const server of selectedServers) {
        try {
          if (isTauri()) await invoke("delete_remote_server", { id: server.id });
        } catch (reason) {
          failures.push(server.id);
        }
      }
      await onChanged();
      setSelectedServerIds(failures);
      setTestResult({ success: failures.length === 0, message: failures.length === 0 ? `已删除 ${selectedServers.length} 台服务器` : `${failures.length} 台服务器删除失败` });
    } finally {
      setBulkAction(null);
    }
  };
  const saveRelay = async (server: RemoteServer) => {
    const draft = relayDraft(server); setSavingRelay(server.id);
    try {
      if (isTauri()) await invoke("update_remote_relay", { request: { serverId: server.id, relayUrl: draft.url, relayKey: draft.key || null } });
      setRelayDrafts((current) => ({ ...current, [server.id]: { url: draft.url, key: "" } })); setEditingRelay(null); await onChanged();
    } catch (reason) { setError(String(reason)); }
    finally { setSavingRelay(null); }
  };
  const deleteServer = async (server: RemoteServer) => {
    if (!window.confirm(`确认删除服务器“${server.name}”吗？`)) return;
    setDeletingServer(server.id);
    try {
      if (isTauri()) await invoke("delete_remote_server", { id: server.id });
      await onChanged();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setDeletingServer(null);
    }
  };
  const testServer = async (server: RemoteServer) => {
    setTestingServer(server.id);
    setTestResult(null);
    try {
      const result = isTauri()
        ? await invoke<RemoteConnectionResult>("test_remote_server", { id: server.id })
        : { success: true, status: "online" as const };
      setTestResult({
        success: result.success,
        message: result.success
          ? `${server.name} SSH 连接成功`
          : `${server.name} 连接失败${result.code ? `（错误代码 ${result.code}）` : ""}${result.reason ? `：${result.reason}` : ""}`,
      });
      await onChanged();
    } catch (reason) {
      const message = String(reason);
      if (message.includes("未找到服务器密码")) {
        setEditingServer(server);
        setTestResult({ success: false, message: `${server.name} 未保存服务器密码，请重新输入后保存` });
      } else {
        setTestResult({ success: false, message: `${server.name} 连接失败：${message}` });
        setError(message);
      }
    } finally {
      setTestingServer(null);
    }
  };
  const verifyCodexSession = async (server: RemoteServer) => {
    setVerifyingSession(server.id);
    setTestResult(null);
    try {
      const result = isTauri()
        ? await invoke<RemoteConnectionResult>("verify_remote_codex_session_command", { id: server.id })
        : { success: true, status: "online" as const };
      setTestResult({
        success: result.success,
        message: result.success
          ? `${server.name} Codex CLI 实际会话验证成功`
          : `${server.name} Codex CLI 会话验证失败${result.reason ? `：${result.reason}` : ""}`,
      });
      await onChanged();
    } catch (reason) {
      setTestResult({ success: false, message: `${server.name} Codex CLI 会话验证失败` });
      setError(String(reason));
    } finally {
      setVerifyingSession(null);
    }
  };
  const cancelServerOperation = async (server: RemoteServer) => {
    try {
      if (isTauri()) await invoke("cancel_remote_server_operation", { id: server.id });
      setTestResult({ success: false, message: `${server.name} 的操作正在取消，当前 SSH 请求最多还会等待 20 秒。` });
    } catch (reason) {
      setError(String(reason));
    }
  };
  const manageCodex = async (server: RemoteServer, action: "install" | "update") => {
    setCodexAction(server.id);
    setTestResult(null);
    try {
      if (isTauri()) await invoke("install_or_update_remote_codex_command", { id: server.id, action });
      await onChanged();
      setTestResult({ success: true, message: `${server.name} 的 Codex CLI 已${action === "install" ? "安装" : "更新"}并完成版本校验。` });
    } catch (reason) {
      const message = String(reason);
      setTestResult({ success: false, message: `${server.name} 的 Codex CLI ${action === "install" ? "安装" : "更新"}失败：${message}` });
      setError(message);
    } finally {
      setCodexAction(null);
    }
  };
  const showSyncLogs = async (server: RemoteServer) => {
    setLoadingLogs(server.id);
    try {
      const entries = isTauri() ? await invoke<RemoteSyncLog[]>("list_remote_sync_logs", { serverId: server.id }) : [];
      setSyncLogs({ server, entries });
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoadingLogs(null);
    }
  };
  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm text-slate-500">服务器连接与中转路由</p>
          <h1 className="mt-1 text-2xl font-semibold">远程配置</h1>
        </div>
        <button className="button-primary" onClick={() => setShowAdd(true)}>
          <Plus size={16} />
          添加服务器
        </button>
      </div>
      {selectedServers.length > 0 && (
        <TableBulkActions summary={`${selectedServers.length} 台已选`}>
          <select
            className="input remote-bulk-key-select"
            aria-label="选择批量切换的中转站密钥"
            value={bulkSelection}
            onChange={(event) => setBulkSelection(event.target.value)}
            disabled={bulkAction !== null}
          >
            <option value="">选择中转站密钥</option>
            {keyRows.map((row) => (
              <option key={`${row.stationId}:${row.key.id}`} value={`${row.stationId}:${row.key.id}`}>
                {row.stationName} · {row.key.name || row.key.id}
              </option>
            ))}
          </select>
          <button className="button-secondary" type="button" disabled={!bulkSelection || bulkAction !== null} onClick={() => void switchSelectedServers()}>
            <RefreshCw size={16} className={bulkAction === "switch" ? "animate-spin" : ""} />
            一键切换
          </button>
          <button className="button-secondary" type="button" disabled={bulkAction !== null} onClick={() => void testSelectedServers()}>
            <PlugZap size={16} className={bulkAction === "test" ? "animate-spin" : ""} />
            一键测试
          </button>
          <button className="button-secondary" type="button" disabled={bulkAction !== null} onClick={() => void deleteSelectedServers()}>
            <Trash2 size={16} className={bulkAction === "delete" ? "animate-spin" : ""} />
            删除
          </button>
        </TableBulkActions>
      )}
      <DataTable className="mt-5">
        <table className="remote-config-table">
          <colgroup>
            <col className="remote-config-select-column" />
            <col className="remote-config-id-column" />
            <col className="remote-config-status-column" />
            <col span={8} />
            <col className="remote-config-actions-column" />
          </colgroup>
          <thead>
            <tr>
              <th className="remote-config-select-cell">
                <input
                  type="checkbox"
                  aria-label="全选远程服务器"
                  checked={servers.length > 0 && selectedServers.length === servers.length}
                  onChange={toggleAllServers}
                />
              </th>
              <th>ID</th>
              <th>状态</th>
              <th>别名</th>
              <th>主机</th>
              <th>端口</th>
              <th>身份文件</th>
              <th>版本</th>
              <th>中转站地址</th>
              <th>中转站密钥</th>
              <th>一键切换</th>
              <th>管理</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((server, index) => (
              <tr key={server.id}>
                <td className="remote-config-select-cell">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${server.name}`}
                    checked={selectedServerIds.includes(server.id)}
                    onChange={() => toggleServerSelection(server.id)}
                  />
                </td>
                <td>{index + 1}</td>
                <td>
                  <span
                    className={`connection-status ${server.connectionStatus ?? "warning"}`}
                    title={
                      server.connectionError ??
                      ((server.connectionStatus ?? "warning") === "online"
                        ? "SSH 端口连接成功"
                        : "尚未完成连接测试")
                    }
                  />
                </td>
                <td>
                  <p className="font-medium">{server.name}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {server.username} ·{" "}
                    {server.authType === "key" ? "SSH密匙" : "密码"}
                  </p>
                </td>
                <td className="font-mono" title={server.hostKeyFingerprint}>{server.host}</td>
                <td className="font-mono">{server.port || 22}</td>
                <td className="truncate text-xs" title={server.privateKeyPath}>{server.authType === "key" ? (server.privateKeyPath?.split(/[/\\]/).pop() ?? "SSH key") : "Password"}</td>
                <td className="text-xs">
                  {server.codexVersion ? (
                    <div className="remote-codex-version" title={server.codexLatestVersion ? `最新版本 ${server.codexLatestVersion}` : undefined}>
                      <span className="truncate">{server.codexVersion}</span>
                      {server.codexUpdateAvailable && <button className="button-secondary remote-codex-action" type="button" disabled={codexAction === server.id} onClick={() => void manageCodex(server, "update")}>
                        <RefreshCw size={14} className={codexAction === server.id ? "animate-spin" : ""} /> 更新
                      </button>}
                    </div>
                  ) : (
                    <button className="button-secondary remote-codex-action" type="button" disabled={codexAction === server.id} onClick={() => void manageCodex(server, "install")}>
                      <Download size={14} className={codexAction === server.id ? "animate-spin" : ""} /> 安装
                    </button>
                  )}
                </td>
                <td>{editingRelay?.serverId === server.id && editingRelay.field === "url" ? <div className="relay-key-input" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) cancelRelayEditing(server, "url"); }}><input className="input relay-input" autoFocus value={relayDraft(server).url} onChange={(event) => updateRelayDraft(server, { url: event.target.value })} placeholder="输入中转站地址" /><button className="icon-button" title="保存中转配置" disabled={savingRelay === server.id} onClick={() => void saveRelay(server)}><Check size={16} /></button></div> : <button className="relay-display" onClick={() => setEditingRelay({ serverId: server.id, field: "url" })}>{server.relayUrl ?? "未配置"}</button>}</td>
                <td>{editingRelay?.serverId === server.id && editingRelay.field === "key" ? <div className="relay-key-input" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) cancelRelayEditing(server, "key"); }}><input className="input" autoFocus type="password" value={relayDraft(server).key} onChange={(event) => updateRelayDraft(server, { key: event.target.value })} placeholder={server.relayKeyMasked ? "已安全保存，输入新密钥以替换" : "输入中转站密钥"} /><button className="icon-button" title="保存中转配置" disabled={savingRelay === server.id} onClick={() => void saveRelay(server)}><Check size={16} /></button></div> : <button className="relay-display relay-key-display api-key-mask" onClick={() => setEditingRelay({ serverId: server.id, field: "key" })}>{server.relayKeyMasked ?? "未配置"}</button>}</td>
                <td>
                  <details
                    className="relay-switch-select"
                    open={openSelection === server.id}
                    onToggle={(event) => {
                      const details = event.currentTarget;
                      if (!details.open) {
                        setOpenSelection(null);
                        setSelectionMenuPosition(null);
                        return;
                      }
                      const { bottom, left, width } = details.getBoundingClientRect();
                      openSelectionAnchorRef.current = details;
                      setSelectionMenuPosition({ top: bottom + 1, left, width });
                      setOpenSelection(server.id);
                    }}
                  >
                    <summary>
                      <span className="truncate">
                        {selectedKeyLabel(server.id)}
                      </span>
                      <ChevronDown size={15} />
                    </summary>
                    <div className="relay-switch-options" hidden>
                      {keyRows.map((row) => (
                        <button
                          type="button"
                          key={`${row.stationId}:${row.key.id}`}
                          disabled={saving === server.id}
                          onClick={() => {
                            const value = `${row.stationId}:${row.key.id}`;
                            setOpenSelection(null);
                            void switchKey(server, value);
                          }}
                        >
                          {row.stationName} · {row.key.name || row.key.id} ·{" "}
                          {row.key.maskedKey}
                        </button>
                      ))}
                      {keyRows.length === 0 && (
                        <p className="relay-switch-empty">暂无本地中转站密钥</p>
                      )}
                    </div>
                  </details>
                </td>
                <td>
                  <div className="flex items-center gap-1">
                    <button
                      className="icon-button"
                      type="button"
                      title="管理服务器"
                      onClick={() => setEditingServer(server)}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="测试 SSH 连接"
                      disabled={testingServer === server.id}
                      onClick={() => void testServer(server)}
                    >
                      <PlugZap size={16} className={testingServer === server.id ? "animate-spin" : ""} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="同步记录"
                      disabled={loadingLogs === server.id}
                      onClick={() => void showSyncLogs(server)}
                    >
                      <Clock3 size={16} className={loadingLogs === server.id ? "animate-spin" : ""} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title="验证 Codex CLI 实际会话"
                      disabled={verifyingSession === server.id}
                      onClick={() => void verifyCodexSession(server)}
                    >
                      <Play size={16} className={verifyingSession === server.id ? "animate-spin" : ""} />
                    </button>
                    {(testingServer === server.id || verifyingSession === server.id || saving === server.id || savingRelay === server.id || codexAction === server.id) && (
                      <button className="icon-button text-rose-600" type="button" title="取消服务器操作" onClick={() => void cancelServerOperation(server)}>
                        <X size={16} />
                      </button>
                    )}
                    <button
                      className="icon-button text-rose-600"
                      type="button"
                      title="删除服务器"
                      disabled={deletingServer === server.id || testingServer === server.id || verifyingSession === server.id || saving === server.id || savingRelay === server.id || codexAction === server.id}
                      onClick={() => void deleteServer(server)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {servers.length === 0 && (
              <tr>
                <td colSpan={12} className="empty-cell">
                  尚未添加远程服务器。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </DataTable>
      {testResult && (
        <div
          className={`remote-test-notice test-result ${testResult.success ? "success" : "error"}`}
          role={testResult.success ? "status" : "alert"}
        >
          <span>{testResult.message}</span>
          <button
            className="icon-button"
            type="button"
            title="关闭提示"
            onClick={() => setTestResult(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {syncLogs && (
        <div className="modal-backdrop" role="presentation">
          <section className="modal remote-log-dialog" role="dialog" aria-modal="true" aria-label="服务器同步记录">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="font-semibold">同步记录</h2>
                <p className="mt-1 text-xs text-slate-500">{syncLogs.server.name}{syncLogs.server.hostKeyFingerprint ? ` · ${syncLogs.server.hostKeyFingerprint.slice(0, 22)}...` : " · 首次连接后将固定 SSH 指纹"}</p>
              </div>
              <button className="icon-button" type="button" title="关闭" onClick={() => setSyncLogs(null)}><X size={17} /></button>
            </div>
            <div className="remote-log-list">
              {syncLogs.entries.map((entry) => <div className={`remote-log-entry ${entry.status}`} key={entry.id}>
                <p className="font-medium">{entry.action} · {entry.status}</p>
                <p>{entry.summary}</p>
                <p className="text-xs text-slate-400">{formatTime(entry.createdAt)}{entry.configFingerprint ? ` · ${entry.configFingerprint.slice(0, 18)}...` : ""}</p>
              </div>)}
              {syncLogs.entries.length === 0 && <p className="empty-cell">暂无同步记录</p>}
            </div>
          </section>
        </div>
      )}
      {openSelection && selectionMenuPosition &&
        createPortal(
          <div
            ref={selectionMenuRef}
            className="relay-switch-options"
            style={selectionMenuPosition}
          >
            {keyRows.map((row) => (
              <button
                type="button"
                key={`${row.stationId}:${row.key.id}`}
                disabled={saving === openSelection}
                onClick={() => {
                  const server = servers.find((item) => item.id === openSelection);
                  if (!server) return;
                  const value = `${row.stationId}:${row.key.id}`;
                  setOpenSelection(null);
                  setSelectionMenuPosition(null);
                  void switchKey(server, value);
                }}
              >
                {row.stationName} 路 {row.key.name || row.key.id} 路{" "}
                {row.key.maskedKey}
              </button>
            ))}
            {keyRows.length === 0 && (
              <p className="relay-switch-empty">暂无本地中转站密钥。</p>
            )}
          </div>,
          document.body,
        )}
      {showAdd && (
        <RemoteServerDialog
          onClose={() => setShowAdd(false)}
          onSaved={onChanged}
          setError={setError}
        />
      )}
      {editingServer && (
        <RemoteServerDialog
          server={editingServer}
          onClose={() => setEditingServer(null)}
          onSaved={onChanged}
          setError={setError}
        />
      )}
    </>
  );
}
function RemoteServerDialog({
  server,
  onClose,
  onSaved,
  setError,
}: {
  server?: RemoteServer;
  onClose: () => void;
  onSaved: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const [authType, setAuthType] = useState<"password" | "key">(
    server?.authType === "key" ? "key" : "password",
  );
  const [password, setPassword] = useState("");
  const [privateKeyPath, setPrivateKeyPath] = useState(server?.privateKeyPath ?? "");
  const [saving, setSaving] = useState(false);
  const [connectionResult, setConnectionResult] = useState<RemoteConnectionResult | null>(null);
  const [pendingHostKeyFingerprint, setPendingHostKeyFingerprint] = useState<string | null>(null);
  const [hostKeyConfirmed, setHostKeyConfirmed] = useState(false);
  const choosePrivateKey = async () => {
    try {
      const path = isTauri()
        ? await invoke<string | null>("choose_private_key_file")
        : "C:\\Users\\me\\.ssh\\id_ed25519";
      if (path) setPrivateKeyPath(path);
    } catch (reason) {
      setError(String(reason));
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!server && pendingHostKeyFingerprint && !hostKeyConfirmed) {
      setConnectionResult({ success: false, status: "warning", reason: "请确认 SSH 主机指纹后再保存服务器", hostKeyFingerprint: pendingHostKeyFingerprint, requiresHostKeyConfirmation: true });
      return;
    }
    setSaving(true);
    setConnectionResult(null);
    const form = new FormData(event.currentTarget);
    try {
      let connection: RemoteConnectionResult;
      if (isTauri()) {
        const result = await invoke<RemoteServerSaveResult>(server ? "update_remote_server" : "add_remote_server", {
          request: {
            ...(server ? { id: server.id } : {}),
            name: form.get("name"),
            host: form.get("host"),
            port: Number(form.get("port") || 22),
            username: form.get("username"),
            authType,
            password: authType === "password" ? password : null,
            privateKeyPath: authType === "key" ? privateKeyPath : null,
            privateKeyPassphrase: null,
            relayProvider: String(form.get("relayProvider") || "").trim() || null,
            hostKeyFingerprint: !server && hostKeyConfirmed ? pendingHostKeyFingerprint : null,
          },
        });
        connection = result.connection;
      } else {
        connection = { success: true, status: "online" };
      }
      setConnectionResult(connection);
      if (connection.requiresHostKeyConfirmation && connection.hostKeyFingerprint) {
        setPendingHostKeyFingerprint(connection.hostKeyFingerprint);
        setHostKeyConfirmed(false);
        return;
      }
      if (connection.success) {
        await onSaved();
        onClose();
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormDialog
      title={server ? "管理 SSH 连接" : "添加 SSH 连接"}
      ariaLabel={server ? "管理 SSH 连接" : "添加 SSH 连接"}
      onClose={onClose}
      onSubmit={submit}
      className="remote-server-dialog"
      contentClassName="remote-server-form"
      footer={
        <>
          <button className="button-secondary form-dialog-cancel" type="button" onClick={onClose}>
            取消
          </button>
          <button className="button-primary form-dialog-submit" disabled={saving}>
            {saving
              ? (server ? "保存并测试中" : "登录中")
              : (server ? "保存并测试连接" : "登录")}
          </button>
        </>
      }
    >
          <label className="remote-name-field">
            显示名称
            <input
              className="input mt-1"
              name="name"
              defaultValue={server?.name}
              placeholder="可选"
            />
          </label>
          <label className="remote-host-field">
            主机名
            <input
              className="input mt-1"
              name="host"
              required
              defaultValue={server?.host}
              placeholder="host.com 或 user@host.com"
              onInvalid={(event) => event.currentTarget.setCustomValidity("请添加服务器 IP")}
              onInput={(event) => event.currentTarget.setCustomValidity("")}
            />
          </label>
          <label className="remote-port-field">
            SSH 端口 <span className="remote-optional-label">（可选）</span>
            <input className="input mt-1" name="port" type="number" min="1" max="65535" required defaultValue={server?.port ?? 22} />
          </label>
          <label className="remote-username-field">
            用户名
            <input
              className="input mt-1"
              name="username"
              required
              defaultValue={server?.username}
              autoComplete="username"
              onInvalid={(event) => event.currentTarget.setCustomValidity("请添加用户名")}
              onInput={(event) => event.currentTarget.setCustomValidity("")}
            />
          </label>
          <input type="hidden" name="relayProvider" value={server?.relayProvider ?? ""} />
          <div className="remote-auth-tabs" role="tablist" aria-label="认证方式">
            <button className={`test-mode-button ${authType === "password" ? "active" : ""}`} type="button" role="tab" aria-selected={authType === "password"} onClick={() => setAuthType("password")}>密码</button>
            <button className={`test-mode-button ${authType === "key" ? "active" : ""}`} type="button" role="tab" aria-selected={authType === "key"} onClick={() => setAuthType("key")}>身份文件</button>
          </div>
          {authType === "password" ? (
            <label className="remote-credential-field">
              密码
              <input
                className="input mt-1"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required={!server || server.authType !== authType}
                type="password"
                autoComplete="current-password"
                placeholder={server ? "留空保留已保存密码；需更新时重新输入" : "输入密码"}
                onInvalid={(event) => event.currentTarget.setCustomValidity("请添加密码")}
                onInput={(event) => event.currentTarget.setCustomValidity("")}
              />
            </label>
          ) : (
            <label className="remote-credential-field">
              SSH密匙
              <div className="secret-input-wrap mt-1">
                <input
                  className="input private-key-input"
                  value={privateKeyPath}
                  required
                  readOnly
                  onClick={() => void choosePrivateKey()}
                  autoComplete="off"
                  placeholder="选择密匙文件"
                  onInvalid={(event) => event.currentTarget.setCustomValidity("请添加 SSH密匙")}
                  onInput={(event) => event.currentTarget.setCustomValidity("")}
                />
                <button
                  className="secret-file-button"
                  type="button"
                  title="选择电脑文件"
                  onClick={() => void choosePrivateKey()}
                >
                  <FolderOpen size={17} />
                </button>
              </div>
            </label>
          )}
          {pendingHostKeyFingerprint && !server && (
            <label className="remote-credential-field text-xs text-slate-600 break-all">
              SSH 主机指纹: {pendingHostKeyFingerprint}
              <span className="mt-2 flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={hostKeyConfirmed} onChange={(event) => setHostKeyConfirmed(event.currentTarget.checked)} />
                我已通过可信渠道确认该主机指纹
              </span>
            </label>
          )}
          {server?.hostKeyFingerprint && (
            <p className="text-xs text-slate-500 break-all">SSH host fingerprint: {server.hostKeyFingerprint}</p>
          )}
          {server?.lastSyncError && (
            <p className="text-xs text-rose-600">Last sync: {server.lastSyncError}</p>
          )}
          {connectionResult && (
            <div className={`test-result ${connectionResult.success ? "success" : "error"}`}>
              <span>
                {connectionResult.success
                  ? "SSH 端口连接成功"
                  : `连接失败${connectionResult.code ? ` (错误代码 ${connectionResult.code})` : ""}${connectionResult.reason ? `：${connectionResult.reason}` : ""}`}
              </span>
            </div>
          )}
    </FormDialog>
  );
}
export function LoginProfilesPageLegacy({
  setError,
}: {
  setError: (message: string) => void;
}) {
  const [profiles, setProfiles] = useState<LoginProfile[]>(() =>
    isTauri() ? [] : demoLoginProfiles,
  );
  const [showManager, setShowManager] = useState(false);
  const loadProfiles = async () => {
    if (!isTauri()) {
      setProfiles(demoLoginProfiles);
      return;
    }
    try {
      setProfiles(await invoke<LoginProfile[]>("list_login_profiles"));
    } catch (reason) {
      setError(String(reason));
    }
  };
  useEffect(() => {
    void loadProfiles();
  }, []);
  const remove = async (id: string) => {
    try {
      if (isTauri()) await invoke("delete_login_profile", { id });
      setProfiles((current) => current.filter((profile) => profile.id !== id));
    } catch (reason) {
      setError(String(reason));
    }
  };
  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm text-slate-500">Windows Credential Manager</p>
          <h1 className="mt-1 text-2xl font-semibold">账号密码管理</h1>
        </div>
        <button className="button-primary" onClick={() => setShowManager(true)}>
          <Plus size={16} />
          添加账号
        </button>
      </div>
      <DataTable className="mt-5">
        <table>
          <thead>
            <tr>
              <th>账号名称</th>
              <th>用户名</th>
              <th>密码</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((profile) => (
              <tr key={profile.id}>
                <td className="font-medium">{profile.name}</td>
                <td>{profile.username}</td>
                <td>已安全保存</td>
                <td>
                  <button
                    className="button-secondary"
                    onClick={() => void remove(profile.id)}
                  >
                    删除
                  </button>
                </td>
              </tr>
            ))}
            {profiles.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-cell">
                  尚未保存账号密码。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </DataTable>
      {showManager && (
        <LoginProfileTableManager
          profiles={profiles}
          onClose={() => setShowManager(false)}
          onChanged={loadProfiles}
          setError={setError}
        />
      )}
    </>
  );
}
export function AddStation({
  onClose,
  onAdded,
  setError,
}: {
  onClose: () => void;
  onAdded: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const probe = async (event: React.FocusEvent<HTMLInputElement>) => {
    const baseUrl = event.currentTarget.value.trim();
    if (!baseUrl || !isTauri()) return;
    const form = event.currentTarget.form;
    const name = form?.elements.namedItem("name") as HTMLInputElement | null;
    const kind = form?.elements.namedItem("kind") as HTMLSelectElement | null;
    if (!name || name.value.trim()) return;
    try {
      const result = await invoke<{ name: string; kind?: string }>(
        "probe_station",
        { baseUrl },
      );
      name.value = result.name;
      if (kind && result.kind) kind.value = result.kind;
    } catch (reason) {
      setError(String(reason));
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await invoke<StationSaveResult>("add_station", {
        request: {
          name: form.get("name"),
          baseUrl: form.get("baseUrl"),
          username: form.get("username"),
          password: form.get("password"),
          kind: form.get("kind"),
          totp: form.get("totp") || null,
        },
      });
      if (result.connection.success) {
        await onAdded();
      } else {
        setError(result.connection.reason ?? "站点验证失败");
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <FormDialog
      title="添加中转站"
      description="地址失焦后会自动读取站点名称。"
      ariaLabel="添加中转站"
      onClose={onClose}
      onSubmit={submit}
      contentClassName="space-y-4"
      footer={
        <>
          <button type="button" className="button-secondary form-dialog-cancel" onClick={onClose}>
            取消
          </button>
          <button className="button-primary form-dialog-submit" disabled={submitting}>
            {submitting ? "正在连接" : "验证并保存"}
          </button>
        </>
      }
    >
          <label>
            站点名称
            <input
              className="input mt-1"
              name="name"
              placeholder="自动获取，也可手动修改"
            />
          </label>
          <label>
            站点地址
            <input
              className="input mt-1"
              name="baseUrl"
              type="url"
              required
              placeholder="https://api.example.com"
              onBlur={probe}
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label>
              账号
              <input
                className="input mt-1"
                name="username"
                required
                autoComplete="username"
              />
            </label>
            <label>
              密码
              <input
                className="input mt-1"
                name="password"
                type="password"
                required
                autoComplete="current-password"
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <label>
              站点类型
              <select className="input mt-1" name="kind" defaultValue="auto">
                <option value="auto">自动识别</option>
                <option value="newapi">New API</option>
                <option value="sub2api">Sub2API</option>
              </select>
            </label>
            <label>
              TOTP 验证码（可选）
              <input
                className="input mt-1"
                name="totp"
                inputMode="numeric"
                placeholder="启用二步验证时填写"
              />
            </label>
          </div>
    </FormDialog>
  );
}
function AddStationWithProfiles({
  onClose,
  onManageProfiles,
  onAdded,
  setError,
}: {
  onClose: () => void;
  onManageProfiles: () => void;
  onAdded: (keepOpen: boolean) => Promise<void>;
  setError: (message: string) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [profiles, setProfiles] = useState<LoginProfile[]>([]);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const accountProfileRef = useRef<HTMLDivElement>(null);
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [kind, setKind] = useState("auto");
  const [totp, setTotp] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [connectionResult, setConnectionResult] =
    useState<StationConnectionResult | null>(null);
  const loadProfiles = async () => {
    if (!isTauri()) {
      setProfiles(demoLoginProfiles);
      return;
    }
    try {
      setProfiles(await invoke<LoginProfile[]>("list_login_profiles"));
    } catch (reason) {
      setError(String(reason));
    }
  };
  useEffect(() => {
    void loadProfiles();
  }, []);
  useEffect(() => {
    if (!showProfileMenu) return;
    const closeProfileMenu = (event: PointerEvent) => {
      if (!accountProfileRef.current?.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    window.addEventListener("pointerdown", closeProfileMenu);
    return () => window.removeEventListener("pointerdown", closeProfileMenu);
  }, [showProfileMenu]);
  const normalizeBaseUrl = (value: string) => {
    const trimmed = value.trim();
    return trimmed && !/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
      ? `https://${trimmed}`
      : trimmed;
  };
  const selectProfile = async (id: string) => {
    if (!id) return;
    try {
      const credential = isTauri()
        ? await invoke<{ username: string; password: string }>(
            "get_login_profile",
            { id },
          )
        : {
            username: demoLoginProfiles[0]?.username ?? "",
            password: "demo-password",
          };
      setUsername(credential.username);
      setPassword(credential.password);
      setShowProfileMenu(false);
    } catch (reason) {
      setError(String(reason));
    }
  };
  const probe = async () => {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    if (!normalizedBaseUrl) return;
    if (normalizedBaseUrl !== baseUrl) setBaseUrl(normalizedBaseUrl);
    if (!isTauri()) {
      try {
        const hostname = new URL(normalizedBaseUrl).hostname.replace(/^www\./i, "");
        const nameFromHostname = hostname.split(".")[0] || hostname;
        setName(
          nameFromHostname
            .replace(/[-_]+/g, " ")
            .replace(/\b\w/g, (character) => character.toUpperCase()),
        );
      } catch {
        // Native URL validation will provide feedback when the form is submitted.
      }
      return;
    }
    try {
      const result = await invoke<{ name: string; kind?: string }>(
        "probe_station",
        { baseUrl: normalizedBaseUrl },
      );
      setName(result.name);
      if (result.kind) setKind(result.kind);
      setFieldErrors((current) => ({ ...current, baseUrl: "" }));
    } catch (reason) {
      setFieldErrors((current) => ({ ...current, baseUrl: String(reason) }));
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const keepOpen =
      ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)
        ?.value === "continue";
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const nextErrors = {
      baseUrl: normalizedBaseUrl ? "" : "请输入站点地址",
      username: username.trim() ? "" : "请输入登录账号",
      password: password ? "" : "请输入登录密码",
    };
    setFieldErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;
    if (normalizedBaseUrl !== baseUrl) setBaseUrl(normalizedBaseUrl);
    setSubmitting(true);
    setConnectionResult(null);
    try {
      const result = await invoke<StationSaveResult>("add_station", {
        request: {
          name,
          baseUrl: normalizedBaseUrl,
          username,
          password,
          kind,
          totp: totp || null,
        },
      });
      setConnectionResult(result.connection);
      if (result.connection.success) {
        await onAdded(keepOpen);
      }
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <FormDialog
      title="添加中转站"
      ariaLabel="添加中转站"
      onClose={onClose}
      onSubmit={submit}
      noValidate
      contentClassName="space-y-4"
      footer={
        <>
          <button type="button" className="button-secondary form-dialog-cancel" onClick={onClose}>
            取消
          </button>
          <button className="button-secondary form-dialog-submit" name="submitAction" value="continue" disabled={submitting}>
            {submitting ? "正在连接" : "添加并继续"}
          </button>
          <button className="button-primary form-dialog-submit" name="submitAction" value="save" disabled={submitting}>
            {submitting ? "正在连接" : "保存"}
          </button>
        </>
      }
    >
            <label>
              站点名称
              <input
                className="input mt-1"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="地址失焦后自动填充站点名称"
              />
            </label>
            <label>
              站点地址
              <input
                className="input mt-1"
                value={baseUrl}
                inputMode="url"
                onChange={(event) => {
                  setBaseUrl(event.target.value);
                  setFieldErrors((current) => ({ ...current, baseUrl: "" }));
                }}
                onBlur={() => void probe()}
                aria-invalid={Boolean(fieldErrors.baseUrl)}
                placeholder="请输入站点地址，例如 https://api.example.com"
              />
              {fieldErrors.baseUrl && <p className="field-error">{fieldErrors.baseUrl}</p>}
            </label>
            <label>
              账号
              <div className="account-input-actions mt-1" ref={accountProfileRef}>
                <input
                  className="input"
                  value={username}
                  onChange={(event) => {
                    setUsername(event.target.value);
                    setFieldErrors((current) => ({ ...current, username: "" }));
                  }}
                  aria-invalid={Boolean(fieldErrors.username)}
                  autoComplete="username"
                  placeholder="请输入站点登录账号"
                />
                <button
                  type="button"
                  className="account-profile-trigger"
                  aria-expanded={showProfileMenu}
                  title="选择常用登录"
                  onClick={() => setShowProfileMenu((visible) => !visible)}
                >
                  <ChevronDown size={16} />
                </button>
                {showProfileMenu && (
                  <div className="account-profile-menu" role="menu">
                    {profiles.length === 0 ? (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setShowProfileMenu(false);
                          onManageProfiles();
                        }}
                      >
                        添加常用登录
                      </button>
                    ) : (
                      profiles.map((profile) => (
                        <button
                          type="button"
                          role="menuitem"
                          key={profile.id}
                          onClick={() => void selectProfile(profile.id)}
                        >
                          <span>{profile.name}</span>
                          <small>{profile.username}</small>
                        </button>
                      ))
                    )}
                  </div>
                )}
                <select
                  className="account-profile-picker"
                  aria-label="选择常用登录"
                  defaultValue=""
                  title="选择常用登录"
                  onChange={(event) => void selectProfile(event.target.value)}
                >
                  <option value="">手动输入</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} · {profile.username}
                    </option>
                  ))}
                </select>
                <ChevronDown className="account-profile-chevron" size={16} />
                <button
                  type="button"
                  className="account-profile-manage"
                  title="管理常用登录"
                  aria-label="管理常用登录"
                  onClick={onManageProfiles}
                >
                  <Settings size={15} />
                </button>
              </div>
              {fieldErrors.username && <p className="field-error">{fieldErrors.username}</p>}
            </label>
            <label>
              密码
              <input
                className="input mt-1"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setFieldErrors((current) => ({ ...current, password: "" }));
                }}
                aria-invalid={Boolean(fieldErrors.password)}
                type="password"
                autoComplete="current-password"
                placeholder="请输入站点登录密码"
              />
              {fieldErrors.password && <p className="field-error">{fieldErrors.password}</p>}
            </label>
            <label>
              站点类型
              <select
                className="input mt-1"
                value={kind}
                onChange={(event) => setKind(event.target.value)}
              >
                <option value="auto">自动识别</option>
                <option value="newapi">New API</option>
                <option value="sub2api">Sub2API</option>
              </select>
            </label>
            <label>
              TOTP 验证码（可选）
              <input
                className="input mt-1"
                value={totp}
                onChange={(event) => setTotp(event.target.value)}
                inputMode="numeric"
                placeholder="启用二步验证时填入"
              />
            </label>
            {connectionResult && (
              <div className={`test-result ${connectionResult.success ? "success" : "error"}`}>
                {connectionResult.success
                  ? "站点连接成功"
                  : `站点验证失败${connectionResult.reason ? `：${connectionResult.reason}` : ""}`}
              </div>
            )}
    </FormDialog>
  );
}

function LoginProfilesPage({
  setError,
  onAddStation,
}: {
  setError: (message: string) => void;
  onAddStation: () => void;
}) {
  const [profiles, setProfiles] = useState<LoginProfile[]>(() =>
    isTauri() ? [] : demoLoginProfiles,
  );
  const loadProfiles = async () => {
    if (!isTauri()) {
      setProfiles(demoLoginProfiles);
      return;
    }
    try {
      setProfiles(await invoke<LoginProfile[]>("list_login_profiles"));
    } catch (reason) {
      setError(String(reason));
    }
  };
  useEffect(() => {
    void loadProfiles();
  }, []);
  return (
    <>
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm text-slate-500">复用中转站登录凭据</p>
          <h1 className="mt-1 text-2xl font-semibold">常用登录</h1>
        </div>
        <button type="button" className="button-primary" onClick={onAddStation}>
          <Plus size={16} />
          添加站点
        </button>
      </div>
      <LoginProfileTableManager
        embedded
        profiles={profiles}
        onChanged={loadProfiles}
        setError={setError}
      />
    </>
  );
}

type LoginProfileRow = {
  id?: string;
  name: string;
  username: string;
  password: string;
};
type LoginProfileField = keyof Omit<LoginProfileRow, "id">;

function LoginProfileTableManager({
  profiles,
  onClose,
  onChanged,
  setError,
  embedded = false,
}: {
  profiles: LoginProfile[];
  onClose?: () => void;
  onChanged: () => Promise<void>;
  setError: (message: string) => void;
  embedded?: boolean;
}) {
  const [rows, setRows] = useState<LoginProfileRow[]>([]);
  const [editingCell, setEditingCell] = useState<{
    index: number;
    field: LoginProfileField;
  } | null>(null);

  const loadRows = async () => {
    try {
      const savedRows = await Promise.all(
        profiles.map(async (profile) => {
          const secret = isTauri()
            ? await invoke<{ username: string; password: string }>(
                "get_login_profile",
                { id: profile.id },
              ).catch(() => ({ username: profile.username, password: "" }))
            : { username: profile.username, password: "demo-password" };
          return { id: profile.id, name: profile.name, ...secret };
        }),
      );
      setRows([...savedRows, { name: "", username: "", password: "" }]);
    } catch (reason) {
      setError(String(reason));
    }
  };

  useEffect(() => {
    void loadRows();
  }, [profiles]);

  const updateRow = (
    index: number,
    field: LoginProfileField,
    value: string,
  ) => {
    setRows((current) =>
      current.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    );
  };

  const renderCell = (
    row: LoginProfileRow,
    index: number,
    field: LoginProfileField,
  ) => {
    const editing = editingCell?.index === index && editingCell.field === field;
    if (editing) {
      return (
        <input
          autoFocus
          className="input profile-cell-input"
          value={row[field]}
          type={field === "password" ? "password" : "text"}
          autoComplete={field === "username" ? "username" : "new-password"}
          placeholder={
            field === "username"
              ? "请输入登录账号"
              : field === "password"
                ? "请输入登录密码"
                : ""
          }
          onBlur={(event) => {
            const nextRow = { ...row, [field]: event.currentTarget.value };
            setEditingCell(null);
            void saveRow(index, nextRow);
          }}
          onChange={(event) => updateRow(index, field, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      );
    }
    const value = field === "password" && row.password ? "••••••••" : row[field];
    return (
      <button
        type="button"
        className="profile-cell-display"
        aria-label={`编辑${field === "name" ? "账号名称" : field === "username" ? "登录账号" : "登录密码"}`}
        onClick={() => setEditingCell({ index, field })}
      >
        {value}
      </button>
    );
  };

  const deleteRow = async (index: number) => {
    const row = rows[index];
    try {
      if (row.id && isTauri()) {
        await invoke("delete_login_profile", { id: row.id });
        await onChanged();
      }
      setRows((current) => {
        const next = current.filter((_, rowIndex) => rowIndex !== index);
        return next.some((item) => !item.id)
          ? next
          : [...next, { name: "", username: "", password: "" }];
      });
    } catch (reason) {
      setError(String(reason));
    }
  };

  const saveRow = async (index: number, row: LoginProfileRow) => {
    if (!row.name.trim() || !row.username.trim() || !row.password) return;
    try {
      if (isTauri()) {
        const saved = await invoke<LoginProfile>("save_login_profile", {
          request: row,
        });
        setRows((current) =>
          current.map((currentRow, rowIndex) =>
            rowIndex === index ? { ...row, id: saved.id } : currentRow,
          ),
        );
      }
      await onChanged();
    } catch (reason) {
      setError(String(reason));
    }
  };

  return (
    <div className={embedded ? "profile-manager-panel" : "modal-backdrop"} role="presentation">
      <section className={embedded ? "profile-editor-panel" : "modal profile-manager-modal"} aria-label="常用登录">
        {!embedded && <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="font-semibold">常用登录</h2>
          <button type="button" className="icon-button" onClick={onClose}>
            <X size={17} />
          </button>
        </div>}
        <div className={embedded ? "" : "p-5"}>
          <DataTable className="profile-editor-table">
            <table>
              <thead>
                <tr>
                  <th>账号名称</th>
                  <th>登录账号</th>
                  <th>登录密码</th>
                  <th className="profile-delete-heading">管理</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id ?? `new-${index}`}>
                    <td>{renderCell(row, index, "name")}</td>
                    <td>{renderCell(row, index, "username")}</td>
                    <td>{renderCell(row, index, "password")}</td>
                    <td className="profile-delete-cell">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label="删除账号"
                        title="删除账号"
                        onClick={() => void deleteRow(index)}
                      >
                        <Trash2 size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTable>
        </div>
        {!embedded && <div className="flex justify-end border-t border-slate-200 px-5 py-4">
          {!embedded && (
            <button type="button" className="button-secondary" onClick={onClose}>
              关闭
            </button>
          )}
        </div>}
      </section>
    </div>
  );
}

export function LoginProfileManager({
  profiles,
  onClose,
  onChanged,
  setError,
}: {
  profiles: LoginProfile[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  setError: (message: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(true);
    try {
      if (isTauri())
        await invoke("save_login_profile", {
          request: {
            name: form.get("name"),
            username: form.get("username"),
            password: form.get("password"),
          },
        });
      await onChanged();
      (
        event.currentTarget.elements.namedItem("name") as HTMLInputElement
      ).value = "";
      (
        event.currentTarget.elements.namedItem("username") as HTMLInputElement
      ).value = "";
      (
        event.currentTarget.elements.namedItem("password") as HTMLInputElement
      ).value = "";
    } catch (reason) {
      setError(String(reason));
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormDialog
      title="账号密码管理"
      description="密码仅保存在 Windows Credential Manager。"
      ariaLabel="账号密码管理"
      onClose={onClose}
      onSubmit={submit}
      contentClassName="space-y-4"
      footer={
        <>
          <button type="button" className="button-secondary form-dialog-cancel" onClick={onClose}>
            取消
          </button>
          <button className="button-primary form-dialog-submit" disabled={saving}>
            {saving ? "保存中" : "保存账号"}
          </button>
        </>
      }
    >
          <div className="rounded-lg border border-slate-100">
            {profiles.length === 0 ? (
              <p className="px-3 py-4 text-sm text-slate-500">
                尚无已保存账号。
              </p>
            ) : (
              profiles.map((profile) => (
                <div
                  className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-sm last:border-0"
                  key={profile.id}
                >
                  <span className="font-medium">{profile.name}</span>
                  <span className="text-slate-500">{profile.username}</span>
                </div>
              ))
            )}
          </div>
          <label>
            账号名称
            <input
              className="input mt-1"
              name="name"
              required
              placeholder="例如：常用中转站账号"
            />
          </label>
          <label>
            用户名
            <input
              className="input mt-1"
              name="username"
              required
              autoComplete="username"
            />
          </label>
          <label>
            密码
            <input
              className="input mt-1"
              name="password"
              type="password"
              required
              autoComplete="new-password"
            />
          </label>
    </FormDialog>
  );
}

// Legacy views remain available to their related workflows but are no longer routed from navigation.
void Overview;
void Keys;
void UsageRecords;

export default App;
