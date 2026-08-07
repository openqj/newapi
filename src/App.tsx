import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MessagesDialog, useNotifications } from "./features/notifications";
import { PERSONAL_CENTER_AUTH_CHANGED_EVENT, useNotificationPreferences, usePersonalCenterRealtime } from "./features/personal-center";
import { AppSidebar } from "./components/AppSidebar";
import { WindowControls } from "./components/WindowControls";
import { Button, IconButton } from "./components/ui";
import {
  AddStationWithProfiles,
  EmptyWorkspace,
  STATIONS_CHANGED_EVENT,
} from "./features/stations";
import { normalizeStationBaseUrl } from "./features/stations/components/AddStationWithProfiles";
import type { StationAccountDraft, StationAccountPrefill } from "./features/stations";
import { AppRouteProvider, createRoutePage, getPrimaryNavigation, type AppRouteContext, type AppView } from "./app/routes";
import { useAppData } from "./app/useAppData";
import {
  appDemo,
  demoLoginProfiles,
  emptySnapshot,
  emptyUsageSummary,
} from "./app/demoData";
import { isTauri } from "./lib/platform";
import { scheduleIdle } from "./lib/idle";
import { errorMessage } from "./lib/errors";
import { settingsApi } from "./features/settings/api";
import { PasswordResetDialog } from "./features/settings/components/PasswordResetDialog";
import { ConfigImportDialog } from "./features/config-profiles";
import { openUrl } from "@tauri-apps/plugin-opener";
import { emit, emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { merchantApi, MERCHANT_FREE_CLAIM_REQUEST_EVENT, MERCHANT_FREE_CLAIM_RESULT_EVENT, MERCHANT_OFFERS_CHANGED_EVENT, MERCHANT_RATE_REGISTER_REQUEST_EVENT } from "./features/merchant";
import type { AccountRole, MerchantFreeClaimRequest, MerchantFreeClaimResult, MerchantFreeRegistrationOffer, MerchantRateRegistrationRequest } from "./features/merchant";
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
  const personalCenterNotifications = useNotificationPreferences({ loadOnMount: false });
  const [view, setView] = useState<AppView>("overview");
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("general");
  const [showAdd, setShowAdd] = useState(false);
  const [editingStation, setEditingStation] = useState<StationAccountDraft | null>(null);
  const [stationPrefill, setStationPrefill] = useState<StationAccountPrefill | null>(null);
  const [merchantImport, setMerchantImport] = useState<MerchantFreeRegistrationOffer | null>(null);
  const [merchantRateRegistration, setMerchantRateRegistration] = useState<MerchantRateRegistrationRequest | null>(null);
  const [merchantRateRechargeStationId, setMerchantRateRechargeStationId] = useState<string | null>(null);
  const [showMessages, setShowMessages] = useState(false);
  const [activeRelay, setActiveRelay] = useState<ActiveCodexRelayStatus | null>(null);
  const [activeRelayRefreshing, setActiveRelayRefreshing] = useState(false);
  const [apiKeyCreateRequest, setApiKeyCreateRequest] = useState(0);
  const [accountRole, setAccountRole] = useState<AccountRole>("member");
  const [personalCenterAuth, setPersonalCenterAuth] = useState<CloudAuthStatus | null>(null);
  const merchantWindowCreation = useRef<Promise<WebviewWindow | null> | null>(null);
  const navigate = useCallback((nextView: AppView) => {
    if (nextView === "settings") setSettingsTab("general");
    setView(nextView);
  }, []);
  const openLoginProfiles = useCallback(() => {
    setSettingsTab("profiles");
    setView("settings");
  }, []);
  const openLocalGateway = useCallback(() => {
    setShowAdd(false);
    setEditingStation(null);
    setSettingsTab("gateway");
    setView("settings");
  }, []);
  const openApiKeyCreator = useCallback(() => {
    setShowAdd(false);
    setEditingStation(null);
    setApiKeyCreateRequest((request) => request + 1);
    setView("keys");
  }, []);
  const handlePersonalCenterAuthChanged = useCallback((status: CloudAuthStatus) => {
    setPersonalCenterAuth(status);
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
    loadUsageSummary, refreshUsageLogs, loadRemoteServers, refreshSupportingData, refreshStationLogin,
    backgroundRefreshMinutes, setBackgroundRefreshMinutes,
    refreshRatesAndKeys, refreshAll, cancelRefresh,
  } = useAppData({ demo: appDemo, emptySnapshot, emptyUsageSummary, view });
  useEffect(() => scheduleIdle(() => {
    void personalCenterNotifications.loadNotificationPreferences();
  }, 2000), [personalCenterNotifications.loadNotificationPreferences]);
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
    backgroundRefreshMinutes,
    onBackgroundRefreshMinutesChange: setBackgroundRefreshMinutes,
    apiKeyCreateRequest,
    personalCenterNotificationPreferences: personalCenterNotifications.preferences,
    personalCenterAuth,
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
    merchantRateRechargeStationId,
    onMerchantRateRechargeOpened: () => setMerchantRateRechargeStationId(null),
    onRefreshAll: refreshAll,
    onRefreshRatesAndKeys: refreshRatesAndKeys,
    onRefreshUsageLogs: refreshUsageLogs,
    onRefreshRemoteServers: loadRemoteServers,
    onRefreshSupportingData: refreshSupportingData,
    onRefreshStation: refreshStationLogin,
    onCodexRelayChanged: loadActiveRelay,
    onOpenStation: (url) => {
      void openStationUrl(url);
    },
  };
  const navigation = getPrimaryNavigation(routeContext);
  const activePage = createRoutePage(view);
  const getOrCreateMerchantWindow = useCallback(async () => {
    if (!isTauri()) return null;
    const existing = await WebviewWindow.getByLabel("merchant-market");
    if (existing) return existing;
    if (!merchantWindowCreation.current) {
      const marketWindow = new WebviewWindow("merchant-market", {
        url: "/?window=merchant-market",
        title: "RelayHub Merchant Info",
        decorations: false,
        visible: false,
        width: 340,
        height: 840,
        minWidth: 340,
        minHeight: 640,
      });
      merchantWindowCreation.current = new Promise<WebviewWindow>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error("Merchant window creation timed out")), 10_000);
        void marketWindow.once("tauri://created", () => {
          window.clearTimeout(timeout);
          resolve(marketWindow);
        });
        void marketWindow.once("tauri://error", (event) => {
          window.clearTimeout(timeout);
          reject(new Error(String(event.payload)));
        });
      }).catch((reason) => {
        console.error("Failed to create merchant window", reason);
        return null;
      }).finally(() => {
        merchantWindowCreation.current = null;
      });
    }
    return merchantWindowCreation.current;
  }, []);
  const toggleMerchantWindow = useCallback(async () => {
    if (!isTauri()) return;
    const marketWindow = await getOrCreateMerchantWindow();
    if (!marketWindow) return;
    if (await marketWindow.isVisible()) {
      await marketWindow.hide();
      return;
    }
    const mainWindow = getCurrentWindow();
    const [mainPosition, mainSize, mainInnerSize] = await Promise.all([
      mainWindow.outerPosition(),
      mainWindow.outerSize(),
      mainWindow.innerSize(),
    ]);
    await Promise.all([
      marketWindow.setSize(new PhysicalSize(340, mainInnerSize.height)),
      marketWindow.setPosition(new PhysicalPosition(mainPosition.x + mainSize.width, mainPosition.y)),
    ]);
    await marketWindow.show();
    await marketWindow.setFocus();
  }, [getOrCreateMerchantWindow]);
  useEffect(() => scheduleIdle(() => void loadActiveRelay(), 2000), [loadActiveRelay]);
  useEffect(() => {
    if (!isTauri()) return;
    const applyAuth = (status: CloudAuthStatus) => {
      setPersonalCenterAuth(status);
      setAccountRole(status.role ?? (status.isAdmin ? "admin" : "member"));
    };
    const cancelAuthLoad = scheduleIdle(() => {
      void settingsApi.cloudAuthStatus().then(applyAuth).catch(() => undefined);
    }, 2000);
    const onAuthChanged = (event: Event) => applyAuth((event as CustomEvent<CloudAuthStatus>).detail ?? { configured: true });
    window.addEventListener(PERSONAL_CENTER_AUTH_CHANGED_EVENT, onAuthChanged);
    let unlisten: (() => void) | undefined;
    void listen(STATIONS_CHANGED_EVENT, () => void Promise.all([loadStations(), loadKeyRows(), loadAccountRows(), loadUsageSummary()])).then((value) => { unlisten = value; });
    return () => {
      cancelAuthLoad();
      window.removeEventListener(PERSONAL_CENTER_AUTH_CHANGED_EVENT, onAuthChanged);
      unlisten?.();
    };
  }, [loadAccountRows, loadKeyRows, loadStations, loadUsageSummary]);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen("relayhub:open-merchant-center", () => setView("merchantCenter")).then((value) => { unlisten = value; });
    return () => unlisten?.();
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void)[] = [];
    void Promise.all([
      listen("relayhub:open-local-gateway", openLocalGateway),
      listen("relayhub:open-api-key-create", openApiKeyCreator),
    ]).then((values) => { unlisten = values; });
    return () => unlisten.forEach((cleanup) => cleanup());
  }, [openApiKeyCreator, openLocalGateway]);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<MerchantRateRegistrationRequest>(MERCHANT_RATE_REGISTER_REQUEST_EVENT, (event) => {
      setMerchantImport(null);
      setMerchantRateRechargeStationId(null);
      setEditingStation(null);
      setStationPrefill(null);
      setShowAdd(false);
      setMerchantRateRegistration(event.payload);
      setView("accounts");
    }).then((value) => { unlisten = value; });
    return () => unlisten?.();
  }, []);
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    void listen<MerchantFreeClaimRequest>(MERCHANT_FREE_CLAIM_REQUEST_EVENT, (event) => {
      void (async () => {
        const emitResult = async (result: MerchantFreeClaimResult) => {
          await emitTo("merchant-market", MERCHANT_FREE_CLAIM_RESULT_EVENT, result).catch(() => undefined);
        };
        const station = stations.find((item) => normalizeStationBaseUrl(item.baseUrl) === normalizeStationBaseUrl(event.payload.stationUrl));
        if (station) {
          setView("accounts");
          try {
            const message = await merchantApi.claimAndRedeemFreeOffer(event.payload.offerId, station.id);
            await Promise.allSettled([loadStations(), loadAccountRows(), loadUsageSummary()]);
            await emitResult({ offerId: event.payload.offerId, success: true, completed: true, message });
          } catch (reason) {
            await emitResult({ offerId: event.payload.offerId, success: false, completed: false, message: errorMessage(reason, "免费额度兑换失败。") });
          }
          return;
        }
        setShowAdd(false);
        setEditingStation(null);
        setMerchantRateRegistration(null);
        setMerchantImport({ offerId: event.payload.offerId, stationName: event.payload.stationName, stationUrl: event.payload.stationUrl });
        setView("accounts");
        await emitResult({ offerId: event.payload.offerId, success: true, completed: false, message: "请完成站点账号注册，系统将自动兑换免费额度。" });
      })();
    }).then((value) => { unlisten = value; });
    return () => unlisten?.();
  }, [loadAccountRows, loadStations, loadUsageSummary, stations]);
  return (
    <AppRouteProvider value={routeContext}>
      <div className="app-shell min-h-screen text-slate-900">
        <header className="app-toolbar" data-tauri-drag-region="deep">
          <div className="window-drag-region" data-tauri-drag-region />
          <div className="app-toolbar-actions">
            <IconButton
              label="刷新当前中转站与剩余"
              className="window-action-button window-relay-refresh-button"
              disabled={activeRelayRefreshing}
              onClick={() => void loadActiveRelay()}
              icon={<RefreshCw size={16} className={activeRelayRefreshing ? "animate-spin" : ""} />}
            />
            {activeRelay && (
              <>
                <Button
                  variant="ghost"
                  className="window-station-button"
                  title={activeRelay.balanceError ? `${activeRelay.name}：${activeRelay.balanceError}` : activeRelay.name}
                  onClick={() => setView("keys")}
                >
                  <span className="window-station-name">{activeRelay.name}</span>
                </Button>
                {activeRelay.balance != null && (
                  <div
                    className="window-station-balance"
                    data-tauri-drag-region="false"
                    title={`当前剩余 $${activeRelay.balance.toFixed(2)}`}
                    aria-label={`剩余 $${activeRelay.balance.toFixed(2)}`}
                  >
                    <span>剩余：</span>
                    <strong>${activeRelay.balance.toFixed(2)}</strong>
                  </div>
                )}
              </>
            )}
            <IconButton label="商家信息" className="window-action-button window-merchant-button" onClick={() => void toggleMerchantWindow()} icon={<Store size={16} />} />
            <IconButton label="自动注册站点账号" className="window-action-button window-merchant-button" onClick={() => void toggleRegistrationWindow()} icon={<UserPlus size={16} />} />
            <IconButton
              label={unreadCount ? `通知，${unreadCount} 条未读` : "通知"}
              className="window-action-button window-notification-button"
              title={unreadCount ? `${unreadCount} 条未读通知` : "通知"}
              onClick={() => setShowMessages(true)}
              icon={<><Bell size={16} />{unreadCount > 0 && <span className="notification-unread-dot" aria-hidden="true" />}</>}
            />
            <WindowControls />
          </div>
        </header>
        <div className="app-content flex min-h-screen">
          <AppSidebar view={view} navigation={navigation} usage={usageScope === "current" ? (snapshot.usage ?? emptyUsageSummary) : usageSummary} usageScope={usageScope} onScopeChange={setUsageScope} onNavigate={navigate} onAddStation={() => { setEditingStation(null); setShowAdd(true); }} />
          <main className="min-w-0 flex-1">
            <section className="content-surface">
              {busy && <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"><div className="min-w-0"><strong>正在同步站点</strong><span className="ml-2 text-slate-500">{syncProgress?.currentStation ?? "准备中"} · {syncProgress?.completed ?? 0}/{syncProgress?.total ?? stations.length}</span><div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><i className="block h-full bg-black transition-all" style={{ width: `${Math.min(100, ((syncProgress?.completed ?? 0) / Math.max(1, syncProgress?.total ?? stations.length)) * 100)}%` }} /></div></div><Button type="button" variant="secondary" className="whitespace-nowrap" onClick={() => void cancelRefresh()}>取消同步</Button></div>}
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
            prefill={stationPrefill ?? undefined}
            onClose={() => {
              setEditingStation(null);
              setStationPrefill(null);
              setShowAdd(false);
            }}
            onManageProfiles={() => {
              setEditingStation(null);
              setStationPrefill(null);
              setShowAdd(false);
              openLoginProfiles();
            }}
            onAdded={async (keepOpen) => {
              setStationPrefill(null);
              if (!keepOpen) {
                setEditingStation(null);
                setShowAdd(false);
              }
              await Promise.all([loadStations(), loadAccountRows(), loadUsageSummary()]);
            }}
          />
        )}
        {merchantRateRegistration && (
          <AddStationWithProfiles
            key={`${merchantRateRegistration.stationUrl}:${merchantRateRegistration.rechargeUrl}`}
            demoProfiles={demoLoginProfiles}
            merchantRateOffer={merchantRateRegistration}
            onClose={() => setMerchantRateRegistration(null)}
            onExistingAccountLogin={() => {
              const offer = merchantRateRegistration;
              setMerchantRateRegistration(null);
              setEditingStation(null);
              setStationPrefill({ name: offer.stationName, baseUrl: offer.stationUrl, kind: "auto" });
              setShowAdd(true);
              setView("accounts");
            }}
            onManageProfiles={() => {
              setMerchantRateRegistration(null);
              openLoginProfiles();
            }}
            onAdded={async (_keepOpen, result) => {
              setMerchantRateRegistration(null);
              setView("accounts");
              await Promise.all([loadStations(), loadAccountRows(), loadUsageSummary()]);
              if (result?.station.id) setMerchantRateRechargeStationId(result.station.id);
            }}
          />
        )}
        {merchantImport && (
          <AddStationWithProfiles
            key={merchantImport.offerId}
            demoProfiles={demoLoginProfiles}
            merchantFreeOffer={merchantImport}
            onClose={() => {
              setMerchantImport(null);
            }}
            onManageProfiles={() => {
              setMerchantImport(null);
              openLoginProfiles();
            }}
            onAdded={async () => {
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
        <ConfigImportDialog onImported={() => { setSettingsTab("configProfiles"); setView("settings"); }} />
      </div>
    </AppRouteProvider>
  );
}

export default App;
