import { useEffect, useState } from "react";
import { useToast } from "./components/ui";
import { MessagesDialog } from "./features/notifications";
import { AppSidebar } from "./components/AppSidebar";
import {
  AddStationWithProfiles,
  EmptyWorkspace,
} from "./features/stations";
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
  const { notify } = useToast();
  const [view, setView] = useState<AppView>("overview");
  const [showAdd, setShowAdd] = useState(false);
  const [showMessages, setShowMessages] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const {
    stations, selectedId, snapshot, keyRows, rateRows, accountRows, usageSummary, usageLogs,
    remoteServers, usageScope, setUsageScope, busy, syncProgress, loadStations,
    loadRateRows, loadUsageSummary, loadUsageLogs, loadRemoteServers, refreshSupportingData,
    refreshAll, cancelRefresh,
  } = useAppData({ demo: appDemo, emptySnapshot, emptyUsageSummary, view });
  const selected = stations.find((station) => station.id === selectedId);
  const routeContext: AppRouteContext = {
    stations,
    snapshot,
    keyRows,
    rateRows,
    accountRows,
    usageSummary,
    usageLogs,
    remoteServers,
    demoLoginProfiles,
    navigate: setView,
    onAddStation: () => setShowAdd(true),
    onRefreshAll: refreshAll,
    onRefreshRates: loadRateRows,
    onRefreshUsageLogs: loadUsageLogs,
    onRefreshRemoteServers: loadRemoteServers,
    onRefreshSupportingData: refreshSupportingData,
    onOpenStation: (url) => {
      void openStationUrl(url);
    },
  };
  const navigation = getPrimaryNavigation(routeContext);
  const activePage = createRoutePage(view);

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
        <AppSidebar view={view} navigation={navigation} usage={usageScope === "current" ? (snapshot.usage ?? emptyUsageSummary) : usageSummary} usageScope={usageScope} onScopeChange={setUsageScope} onNavigate={setView} onAddStation={() => setShowAdd(true)} />
        <main className="min-w-0 flex-1">
          <section className="content-surface">
            {busy && <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm"><div className="min-w-0"><strong>正在同步站点</strong><span className="ml-2 text-slate-500">{syncProgress?.currentStation ?? "准备中"} · {syncProgress?.completed ?? 0}/{syncProgress?.total ?? stations.length}</span><div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100"><i className="block h-full bg-black transition-all" style={{ width: `${Math.min(100, ((syncProgress?.completed ?? 0) / Math.max(1, syncProgress?.total ?? stations.length)) * 100)}%` }} /></div></div><button className="button-secondary whitespace-nowrap" onClick={() => void cancelRefresh()}>取消同步</button></div>}
            {view === "overview" && stations.length === 0 && (
              <EmptyWorkspace onAdd={() => setShowAdd(true)} />
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
    </AppRouteProvider>
  );
}

export default App;
