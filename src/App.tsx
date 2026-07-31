import { useCallback, useEffect, useMemo, useState } from "react";
import { useToast } from "./components/ui";
import { MessagesDialog, useNotifications } from "./features/notifications";
import { PERSONAL_CENTER_AUTH_CHANGED_EVENT, useNotificationPreferences, usePersonalCenterRealtime } from "./features/personal-center";
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
import { PasswordResetDialog } from "./features/settings/components/PasswordResetDialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";
import type { AccountRole } from "./features/merchant";
import type { CloudAuthStatus } from "./features/settings";
import {
  Bell,
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
  const [activeRelayName, setActiveRelayName] = useState<string | null>(null);
  const [accountRole, setAccountRole] = useState<AccountRole>("member");
  const {
    stations, snapshot, keyRows, rateRows, accountRows, usageSummary, usageLogs,
    remoteServers, usageScope, setUsageScope, busy, syncProgress, loadStations, loadAccountRows,
    loadUsageSummary, loadUsageLogs, refreshUsageLogs, loadRemoteServers, refreshSupportingData,
    refreshRatesAndKeys, refreshAll, cancelRefresh,
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
    personalCenterNotificationPreferences: personalCenterNotifications.preferences,
    accountRole,
    onPersonalCenterAuthChanged: (status) => setAccountRole(status.role ?? (status.isAdmin ? "admin" : "member")),
    onSavePersonalCenterNotificationPreferences: personalCenterNotifications.saveNotificationPreferences,
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
    onRefreshRatesAndKeys: refreshRatesAndKeys,
    onRefreshUsageLogs: refreshUsageLogs,
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
    if (!isTauri()) return;
    const applyAuth = (status: CloudAuthStatus) => setAccountRole(status.role ?? (status.isAdmin ? "admin" : "member"));
    void settingsApi.cloudAuthStatus().then(applyAuth).catch(() => undefined);
    const onAuthChanged = (event: Event) => applyAuth((event as CustomEvent<CloudAuthStatus>).detail ?? { configured: true });
    window.addEventListener(PERSONAL_CENTER_AUTH_CHANGED_EVENT, onAuthChanged);
    let unlisten: (() => void) | undefined;
    void listen("relayhub:stations-changed", () => void Promise.all([loadStations(), loadAccountRows(), loadUsageSummary()])).then((value) => { unlisten = value; });
    return () => { window.removeEventListener(PERSONAL_CENTER_AUTH_CHANGED_EVENT, onAuthChanged); unlisten?.(); };
  }, [loadAccountRows, loadStations, loadUsageSummary]);
  return (
    <AppRouteProvider value={routeContext}>
    <div className="app-shell min-h-screen text-slate-900">
      <header className="app-toolbar">
        <div className="app-toolbar-actions">
          {activeRelayName && <button
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
        </div>
      </header>
      <div className="app-content flex min-h-screen">
        <AppSidebar view={view} navigation={navigation} usage={usageScope === "current" ? (snapshot.usage ?? emptyUsageSummary) : usageSummary} usageScope={usageScope} onScopeChange={setUsageScope} onNavigate={setView} onAddStation={() => { setEditingStation(null); setShowAdd(true); }} />
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
      <PasswordResetDialog />
    </div>
    </AppRouteProvider>
  );
}

export default App;
