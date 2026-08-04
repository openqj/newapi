import { useCallback, useEffect, useMemo, useState } from "react";
import { MessagesDialog, useNotifications } from "./features/notifications";
import { PERSONAL_CENTER_AUTH_CHANGED_EVENT, useNotificationPreferences, usePersonalCenterRealtime } from "./features/personal-center";
import { AppSidebar } from "./components/AppSidebar";
import { WindowControls } from "./components/WindowControls";
import {
  AddStationWithProfiles,
  EmptyWorkspace,
  STATIONS_CHANGED_EVENT,
} from "./features/stations";
import type { StationAccountDraft } from "./features/stations";
import { AppRouteProvider, createRoutePage, getPrimaryNavigation, type AppRouteContext, type AppView } from "./app/routes";
import { useAppData } from "./app/useAppData";
import {
  appDemo,
  demoLoginProfiles,
  emptySnapshot,
  emptyUsageSummary,
} from "./app/demoData";
import { isTauri } from "./lib/platform";
import { settingsApi } from "./features/settings/api";
import { PasswordResetDialog } from "./features/settings/components/PasswordResetDialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { merchantApi, MERCHANT_IMPORT_REQUEST_EVENT, MERCHANT_OFFERS_CHANGED_EVENT } from "./features/merchant";
import type { AccountRole, ClaimedMerchantCode } from "./features/merchant";
import type { ActiveCodexRelayStatus, CloudAuthStatus, SettingsTab } from "./features/settings";
import {
  Bell,
  RefreshCw,
  Store,
  UserPlus,
} from "lucide-react";
import "./App.css";

const openStationUrl = (url: string) =>
  isTauri() ? openUrl(url) : window.open(url, "_blank", "noopener");
function App() {
  const personalCenterNotifications = useNotificationPreferences();
  const [view, setView] = useState<AppView>("overview");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [showAdd, setShowAdd] = useState(false);
  const [editingStation, setEditingStation] = useState<StationAccountDraft | null>(null);
  const [merchantImport, setMerchantImport] = useState<{ claim: ClaimedMerchantCode; completed: boolean } | null>(null);
  const [showMessages, setShowMessages] = useState(false);
  const [activeRelay, setActiveRelay] = useState<ActiveCodexRelayStatus | null>(null);
  const [activeRelayRefreshing, setActiveRelayRefreshing] = useState(false);
  const [accountRole, setAccountRole] = useState<AccountRole>("member");
  const navigate = useCallback((nextView: AppView) => {
    if (nextView === "settings") setSettingsTab("general");
    setView(nextView);
  }, []);
  const openLoginProfiles = useCallback(() => {
    setSettingsTab("profiles");
    setView("settings");
  }, []);
  const handlePersonalCenterAuthChanged = useCallback((status: CloudAuthStatus) => {
    setAccountRole(status.role ?? (status.isAdmin ? "admin" : "member"));
  }, []);
  const toggleRegistrationWindow = useCallback(async () => {
    if (!isTauri()) {
      setShowAdd((current) => !current);
      return;
    }
    const registrationWindow = await WebviewWindow.getByLabel("register-account");
    if (!registrationWindow) return;
    if (await registrationWindow.isVisible()) {
      await registrationWindow.hide();
      return;
    }
    const mainWindow = getCurrentWindow();
    const [mainPosition, mainSize, registrationSize] = await Promise.all([
      mainWindow.outerPosition(),
      mainWindow.outerSize(),
      registrationWindow.innerSize(),
    ]);
    await Promise.all([
      registrationWindow.setSize(new PhysicalSize(420, registrationSize.height)),
      registrationWindow.setPosition(new PhysicalPosition(mainPosition.x + mainSize.width, mainPosition.y)),
    ]);
    await registrationWindow.show();
    await registrationWindow.setFocus();
  }, []);
  const {
    stations, snapshot, keyRows, rateRows, accountRows, usageSummary, usageLogs,
    remoteServers, usageScope, setUsageScope, busy, syncProgress, loadStations, loadKeyRows, loadAccountRows,
    loadUsageSummary, refreshUsageLogs, loadRemoteServers, refreshSupportingData,
    refreshRatesAndKeys, refreshAll, cancelRefresh,
  } = useAppData({ demo: appDemo, emptySnapshot, emptyUsageSummary, view });
  const loadActiveRelay = useCallback(async () => {
    if (!isTauri()) {
      setActiveRelay(null);
      return;
    }
    setActiveRelayRefreshing(true);
    try {
      setActiveRelay(await settingsApi.activeCodexRelayStatus());
    } catch {
      setActiveRelay(null);
    } finally {
      setActiveRelayRefreshing(false);
    }
  }, []);
  const notificationSource = useMemo(() => ({
    stations,
    offers: snapshot.offers,
    unavailable: snapshot.unavailable,
    syncing: busy,
    syncProgress,
  }), [busy, snapshot.offers, snapshot.unavailable, stations, syncProgress]);
  const localNotifications = useNotifications(notificationSource, personalCenterNotifications.preferences);
  const cloudNotifications = usePersonalCenterRealtime(
    personalCenterNotifications.refreshNotificationPreferences,
    true,
    personalCenterNotifications.preferences.desktopEnabled,
  );
  const messages = useMemo(() => [...cloudNotifications.messages, ...localNotifications.messages]
    .sort((left, right) => right.createdAt - left.createdAt), [cloudNotifications.messages, localNotifications.messages]);
  const unreadCount = localNotifications.unreadCount + cloudNotifications.unreadCount;
  const routeContext: AppRouteContext = {
    stations,
    snapshot,
    keyRows,
    rateRows,
    accountRows,
    usageSummary,
    usageLogs,
    remoteServers,
    settingsTab,
    onSettingsTabChange: setSettingsTab,
    personalCenterNotificationPreferences: personalCenterNotifications.preferences,
    accountRole,
    onPersonalCenterAuthChanged: handlePersonalCenterAuthChanged,
    onSavePersonalCenterNotificationPreferences: personalCenterNotifications.saveNotificationPreferences,
    demoLoginProfiles,
    navigate,
    onAddStation: () => {
      setEditingStation(null);
      setShowAdd(true);
    },
    onEditStationAccount: (row) => {
      setEditingStation({
        id: row.stationId,
        name: row.stationName,
        baseUrl: row.stationUrl,
        kind: row.kind,
        username: row.account.username,
      });
      setShowAdd(true);
    },
    onRefreshAll: refreshAll,
    onRefreshRatesAndKeys: refreshRatesAndKeys,
    onRefreshUsageLogs: refreshUsageLogs,
    onRefreshRemoteServers: loadRemoteServers,
    onRefreshSupportingData: refreshSupportingData,
    onCodexRelayChanged: loadActiveRelay,
    onOpenStation: (url) => {
      void openStationUrl(url);
    },
  };
  const navigation = getPrimaryNavigation(routeContext);
  const activePage = createRoutePage(view);
  const toggleMerchantWindow = useCallback(async () => {
    if (!isTauri()) return;
    const marketWindow = await WebviewWindow.getByLabel("merchant-market");
    if (!marketWindow) return;
    if (await marketWindow.isVisible()) {
      await marketWindow.hide();
      return;
    }
    const mainWindow = getCurrentWindow();
    const [mainPosition, mainSize, mainInnerSize, marketInnerSize] = await Promise.all([
      mainWindow.outerPosition(),
      mainWindow.outerSize(),
      mainWindow.innerSize(),
      marketWindow.innerSize(),
    ]);
    await Promise.all([
      marketWindow.setSize(new PhysicalSize(marketInnerSize.width, mainInnerSize.height)),
      marketWindow.setPosition(new PhysicalPosition(mainPosition.x + mainSize.width, mainPosition.y)),
    ]);
    await marketWindow.show();
    await marketWindow.setFocus();
  }, []);
  useEffect(() => { void loadActiveRelay(); }, [loadActiveRelay]);
  useEffect(() => {
    if (!isTauri()) return;
    const applyAuth = (status: CloudAuthStatus) => setAccountRole(status.role ?? (status.isAdmin ? "admin" : "member"));
    void settingsApi.cloudAuthStatus().then(applyAuth).catch(() => undefined);
    const onAuthChanged = (event: Event) => applyAuth((event as CustomEvent<CloudAuthStatus>).detail ?? { configured: true });
    window.addEventListener(PERSONAL_CENTER_AUTH_CHANGED_EVENT, onAuthChanged);
    let unlisten: (() => void) | undefined;
    void listen(STATIONS_CHANGED_EVENT, () => void Promise.all([loadStations(), loadKeyRows(), loadAccountRows(), loadUsageSummary()])).then((value) => { unlisten = value; });
    return () => { window.removeEventListener(PERSONAL_CENTER_AUTH_CHANGED_EVENT, onAuthChanged); unlisten?.(); };
  }, [loadAccountRows, loadKeyRows, loadStations, loadUsageSummary]);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("relayhub:open-merchant-center", () => setView("merchantCenter")).then((value) => { unlisten = value; });
    return () => unlisten?.();
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<ClaimedMerchantCode>(MERCHANT_IMPORT_REQUEST_EVENT, (event) => {
      setShowAdd(false);
      setEditingStation(null);
      setMerchantImport((current) => {
        if (current && !current.completed) void merchantApi.releaseCode(current.claim.id).catch(() => undefined);
        return { claim: event.payload, completed: false };
      });
    }).then((value) => { unlisten = value; });
    return () => unlisten?.();
  }, []);
  return (
    <AppRouteProvider value={routeContext}>
    <div className="app-shell min-h-screen text-slate-900">
      <header className="app-toolbar" data-tauri-drag-region="deep">
        <div className="window-drag-region" data-tauri-drag-region />
        <div className="app-toolbar-actions">
          <button
            type="button"
            className="window-action-button window-relay-refresh-button"
            aria-label="刷新当前中转站与剩余"
            title="刷新当前中转站与剩余"
            disabled={activeRelayRefreshing}
            onClick={() => void loadActiveRelay()}
          >
            <RefreshCw size={16} className={activeRelayRefreshing ? "animate-spin" : ""} />
          </button>
          {activeRelay && <><button
            type="button"
            className="window-station-button"
            title={activeRelay.balanceError ? `${activeRelay.name}：${activeRelay.balanceError}` : activeRelay.name}
            onClick={() => setView("keys")}
          >
            <span className="window-station-name">{activeRelay.name}</span>
          </button>
          {activeRelay.balance != null && <button
            type="button"
            className="window-station-balance"
            data-tauri-drag-region="false"
            title={`当前剩余 $${activeRelay.balance.toFixed(2)}`}
            aria-label={`剩余 $${activeRelay.balance.toFixed(2)}`}
          >
            <span>剩余：</span>
            <strong>${activeRelay.balance.toFixed(2)}</strong>
          </button>}</>}
          <button type="button" className="window-action-button window-merchant-button" aria-label="商家信息" title="商家信息" onClick={() => void toggleMerchantWindow()}>
            <Store size={16} />
          </button>
          <button type="button" className="window-action-button window-merchant-button" aria-label="自动注册站点账号" title="自动注册站点账号" onClick={() => void toggleRegistrationWindow()}>
            <UserPlus size={16} />
          </button>
          <button
            type="button"
            className="window-action-button window-notification-button"
            aria-label={unreadCount ? `通知，${unreadCount} 条未读` : "通知"}
            title={unreadCount ? `${unreadCount} 条未读通知` : "通知"}
            onClick={() => setShowMessages(true)}
          >
            <Bell size={16} />
            {unreadCount > 0 && <span className="notification-unread-dot" aria-hidden="true" />}
          </button>
          <WindowControls />
        </div>
      </header>
      <div className="app-content flex min-h-screen">
        <AppSidebar view={view} navigation={navigation} usage={usageScope === "current" ? (snapshot.usage ?? emptyUsageSummary) : usageSummary} usageScope={usageScope} onScopeChange={setUsageScope} onNavigate={navigate} onAddStation={() => { setEditingStation(null); setShowAdd(true); }} />
        <main className="min-w-0 flex-1">
          <section className="content-surface">
            {busy && <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"><div className="min-w-0"><strong>正在同步站点</strong><span className="ml-2 text-slate-500">{syncProgress?.currentStation ?? "准备中"} · {syncProgress?.completed ?? 0}/{syncProgress?.total ?? stations.length}</span><div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><i className="block h-full bg-black transition-all" style={{ width: `${Math.min(100, ((syncProgress?.completed ?? 0) / Math.max(1, syncProgress?.total ?? stations.length)) * 100)}%` }} /></div></div><button className="button-secondary whitespace-nowrap" onClick={() => void cancelRefresh()}>取消同步</button></div>}
            {view === "overview" && stations.length === 0 && (
              <EmptyWorkspace onAdd={() => { setEditingStation(null); setShowAdd(true); }} />
            )}
            {(view !== "overview" || stations.length > 0) && (
              <>
                {activePage}
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
          initial={editingStation ?? undefined}
          onClose={() => {
            setEditingStation(null);
            setShowAdd(false);
          }}
          onManageProfiles={() => {
            setEditingStation(null);
            setShowAdd(false);
            openLoginProfiles();
          }}
          onAdded={async (keepOpen) => {
            if (!keepOpen) {
              setEditingStation(null);
              setShowAdd(false);
            }
            await Promise.all([loadStations(), loadAccountRows(), loadUsageSummary()]);
          }}
        />
      )}
      {merchantImport && (
        <AddStationWithProfiles
          key={merchantImport.claim.id}
          demoProfiles={demoLoginProfiles}
          merchantImport={merchantImport.claim}
          onClose={() => {
            const current = merchantImport;
            setMerchantImport(null);
            void (async () => {
              if (!current.completed) await merchantApi.releaseCode(current.claim.id).catch(() => undefined);
              await emit(MERCHANT_OFFERS_CHANGED_EVENT).catch(() => undefined);
            })();
          }}
          onManageProfiles={() => {
            const current = merchantImport;
            setMerchantImport(null);
            openLoginProfiles();
            void (async () => {
              if (!current.completed) await merchantApi.releaseCode(current.claim.id).catch(() => undefined);
              await emit(MERCHANT_OFFERS_CHANGED_EVENT).catch(() => undefined);
            })();
          }}
          onAdded={async () => {
            setMerchantImport((current) => current ? { ...current, completed: true } : current);
            await Promise.all([loadStations(), loadAccountRows(), loadUsageSummary()]);
            await emit(MERCHANT_OFFERS_CHANGED_EVENT).catch(() => undefined);
          }}
        />
      )}
      {showMessages && (
        <MessagesDialog
          messages={messages}
          unreadCount={unreadCount}
          onClose={() => setShowMessages(false)}
          onMarkAllRead={async () => {
            localNotifications.markAllRead();
            await cloudNotifications.markAllRead();
          }}
          onOpen={async (message) => {
            if (message.cloudNotificationId) await cloudNotifications.markRead(message.cloudNotificationId);
            else localNotifications.markRead(message.id);
            setShowMessages(false);
            setView(message.destination);
          }}
        />
      )}
      <PasswordResetDialog />
    </div>
    </AppRouteProvider>
  );
}

export default App;
