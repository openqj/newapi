import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "./components/ui";
import { MessagesDialog, useNotifications } from "./features/notifications";
import { useNotificationPreferences, usePersonalCenterRealtime } from "./features/personal-center";
import { AppSidebar } from "./components/AppSidebar";
import {
  AddStationWithProfiles,
  EmptyWorkspace,
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
import { errorMessage } from "./lib/errors";
import { settingsApi } from "./features/settings/api";
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

const openStationUrl = (url: string) =>
  isTauri() ? openUrl(url) : window.open(url, "_blank", "noopener");
function App() {
  const { notify } = useToast();
  const personalCenterNotifications = useNotificationPreferences();
  const [view, setView] = useState<AppView>("overview");
  const [showAdd, setShowAdd] = useState(false);
  const [editingStation, setEditingStation] = useState<StationAccountDraft | null>(null);
  const [showMessages, setShowMessages] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [activeRelayName, setActiveRelayName] = useState<string | null>(null);
  const {
    stations, snapshot, keyRows, rateRows, accountRows, usageSummary, usageLogs,
    remoteServers, usageScope, setUsageScope, busy, syncProgress, loadStations, loadAccountRows,
    loadUsageSummary, loadUsageLogs, loadRemoteServers, refreshSupportingData,
    refreshAll, cancelRefresh,
  } = useAppData({ demo: appDemo, emptySnapshot, emptyUsageSummary, view });
  const loadActiveRelayName = useCallback(async () => {
    if (!isTauri()) {
      setActiveRelayName(null);
      return;
    }
    setActiveRelayName(await settingsApi.activeCodexRelayName().catch(() => null));
  }, []);
  const notificationSource = useMemo(() => ({
    stations,
    offers: snapshot.offers,
    unavailable: snapshot.unavailable,
    syncing: busy,
    syncProgress,
  }), [busy, snapshot.offers, snapshot.unavailable, stations, syncProgress]);
  const localNotifications = useNotifications(notificationSource, personalCenterNotifications.preferences);
  const cloudNotifications = usePersonalCenterRealtime(personalCenterNotifications.loadNotificationPreferences, personalCenterNotifications.preferences.desktopEnabled);
  const personalCenterPrivileges = useMemo(() => new Set(cloudNotifications.memberships
    .filter((membership) => membership.enabled && (!membership.expiresAt || membership.expiresAt * 1000 > Date.now()))
    .flatMap((membership) => membership.privileges)), [cloudNotifications.memberships]);
  const personalCenterAccess = useMemo(() => ({
    authenticated: cloudNotifications.access.authenticated,
    isAdmin: cloudNotifications.access.isAdmin,
    privileges: personalCenterPrivileges,
  }), [cloudNotifications.access, personalCenterPrivileges]);
  const canAdminister = !personalCenterAccess.authenticated || personalCenterAccess.isAdmin || personalCenterPrivileges.has("admin");
  const canUseApiKeys = !personalCenterAccess.authenticated || personalCenterAccess.isAdmin || personalCenterPrivileges.has("apiKeys");
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
    personalCenterNotificationPreferences: personalCenterNotifications.preferences,
    onSavePersonalCenterNotificationPreferences: personalCenterNotifications.saveNotificationPreferences,
    onReloadPersonalCenterNotificationPreferences: personalCenterNotifications.loadNotificationPreferences,
    personalCenterAccess,
    demoLoginProfiles,
    navigate: setView,
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
    onRefreshUsageLogs: loadUsageLogs,
    onRefreshRemoteServers: loadRemoteServers,
    onRefreshSupportingData: refreshSupportingData,
    onCodexRelayChanged: loadActiveRelayName,
    onOpenStation: (url) => {
      void openStationUrl(url);
    },
  };
  const navigation = getPrimaryNavigation(routeContext);
  const activePage = createRoutePage(view);

  useEffect(() => { void loadActiveRelayName(); }, [loadActiveRelayName]);
  useEffect(() => {
    if (view === "overview" || view === "personalCenter") return;
    if (!navigation.some((item) => item.view === view)) setView("personalCenter");
  }, [navigation, view]);
  useEffect(() => {
    if (!canAdminister) {
      setShowAdd(false);
      setEditingStation(null);
    }
  }, [canAdminister]);

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

  const controlWindow = async (action: "minimize" | "maximize" | "close") => {
    if (!isTauri()) return;
    const appWindow = getCurrentWindow();
    try {
      if (action === "minimize") await appWindow.minimize();
      if (action === "maximize") await appWindow.toggleMaximize();
      if (action === "close") await appWindow.close();
    } catch (reason) {
      notify(errorMessage(reason, "窗口操作失败，请稍后重试。"), "error");
    }
  };
  const startWindowDrag = async (event: React.MouseEvent<HTMLDivElement>) => {
    if (!isTauri() || event.button !== 0 || event.detail > 1) return;
    try {
      await getCurrentWindow().startDragging();
    } catch (reason) {
      notify(errorMessage(reason, "无法拖动窗口，请稍后重试。"), "error");
    }
  };

  return (
    <AppRouteProvider value={routeContext}>
    <div className="app-shell min-h-screen text-slate-900">
      <header className="window-titlebar">
        <div
          className="window-drag-region"
          onMouseDown={(event) => void startWindowDrag(event)}
          onDoubleClick={() => void controlWindow("maximize")}
        />
        <div className="window-titlebar-actions">
          {activeRelayName && canUseApiKeys && <button
            type="button"
            className="window-station-button"
            title={activeRelayName}
            onClick={() => setView("keys")}
          >
            <span className="station-status-dot" aria-hidden="true" />
            <span className="window-station-name">{activeRelayName}</span>
          </button>}
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
        <AppSidebar view={view} navigation={navigation} usage={usageScope === "current" ? (snapshot.usage ?? emptyUsageSummary) : usageSummary} usageScope={usageScope} canAddStation={canAdminister} onScopeChange={setUsageScope} onNavigate={setView} onAddStation={() => { setEditingStation(null); setShowAdd(true); }} />
        <main className="min-w-0 flex-1">
          <section className="content-surface">
            {busy && <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"><div className="min-w-0"><strong>正在同步站点</strong><span className="ml-2 text-slate-500">{syncProgress?.currentStation ?? "准备中"} · {syncProgress?.completed ?? 0}/{syncProgress?.total ?? stations.length}</span><div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><i className="block h-full bg-black transition-all" style={{ width: `${Math.min(100, ((syncProgress?.completed ?? 0) / Math.max(1, syncProgress?.total ?? stations.length)) * 100)}%` }} /></div></div><button className="button-secondary whitespace-nowrap" onClick={() => void cancelRefresh()}>取消同步</button></div>}
            {canAdminister && view === "overview" && stations.length === 0 && (
              <EmptyWorkspace onAdd={() => { setEditingStation(null); setShowAdd(true); }} />
            )}
            {(view !== "overview" || stations.length > 0 || !canAdminister) && (
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
            setView("profiles");
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
    </div>
    </AppRouteProvider>
  );
}

export default App;
