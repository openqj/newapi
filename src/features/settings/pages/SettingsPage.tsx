import { useEffect, useState } from "react";
import { CloudSync, KeyRound, Layers3, Megaphone, Settings2, UserRound } from "lucide-react";
import { Panel, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { UpdateSettings } from "../UpdateSettings";
import { AlertSettings } from "../../alerts";
import { AlertHistoryPage } from "../../alerts/pages/AlertHistoryPage";
import { LoginProfilesPage } from "../../profiles";
import { ConfigProfilesPage } from "../../config-profiles";
import { GatewaySettings } from "../../gateway";
import type { KeyRow } from "../../api-keys";
import { BACKGROUND_REFRESH_OPTIONS, MIN_BACKGROUND_REFRESH_MINUTES, settingsApi } from "../api";
import { AutoRegistrationSettings } from "../components/AutoRegistrationSettings";
import { isTauri } from "../../../lib/platform";
import type { LoginProfile } from "../../profiles";
import type { StationSnapshot } from "../../stations";
import "./SettingsPage.css";

export type SettingsTab = "general" | "alerts" | "alertHistory" | "profiles" | "configProfiles" | "gateway" | "autoRegistration" | "codex" | "updates";

const settingsTabs: { id: SettingsTab; label: string }[] = [
  { id: "gateway", label: "Gateway" },
  { id: "general", label: "常规" },
  { id: "alerts", label: "通知与告警" },
  { id: "alertHistory", label: "告警历史与趋势" },
  { id: "profiles", label: "常用登录" },
  { id: "configProfiles", label: "配置档案" },
  { id: "autoRegistration", label: "自动注册" },
  { id: "codex", label: "Codex" },
  { id: "updates", label: "更新" },
];

export function SettingsPage({ demoProfiles, keyRows, syncStatuses, backgroundRefreshMinutes, onBackgroundRefreshMinutesChange, activeTab = "general", onActiveTabChange }: { demoProfiles: LoginProfile[]; keyRows: KeyRow[]; syncStatuses?: StationSnapshot["syncStatuses"]; backgroundRefreshMinutes: number; onBackgroundRefreshMinutesChange: (minutes: number) => void; activeTab?: SettingsTab; onActiveTabChange?: (tab: SettingsTab) => void }) {
  const selectTab = (tab: SettingsTab) => onActiveTabChange?.(tab);
  const hasSyncStatuses = Object.keys(syncStatuses ?? {}).length > 0;

  return <>
    <SettingsHeader syncStatuses={hasSyncStatuses ? syncStatuses : undefined} />
    <nav className="settings-tabs" aria-label="设置导航">
      {settingsTabs.map((tab) => <button
        key={tab.id}
        type="button"
        aria-current={activeTab === tab.id ? "page" : undefined}
        className={`settings-tab ${activeTab === tab.id ? "active" : ""}`}
        onClick={() => selectTab(tab.id)}
      >{tab.label}</button>)}
    </nav>
    <section>
      {activeTab === "general" && <GeneralSettings backgroundRefreshMinutes={backgroundRefreshMinutes} onBackgroundRefreshMinutesChange={onBackgroundRefreshMinutesChange} />}
      {activeTab === "alerts" && <AlertSettingsPanel />}
      {activeTab === "alertHistory" && <AlertHistoryPage />}
      {activeTab === "profiles" && <ProfilesSettings demoProfiles={demoProfiles} />}
      {activeTab === "configProfiles" && <ConfigProfilesPage keyRows={keyRows} />}
      {activeTab === "gateway" && <GatewaySettings keyRows={keyRows} />}
      {activeTab === "autoRegistration" && <AutoRegistrationSettings />}
      {activeTab === "codex" && <CodexEnhancement />}
      {activeTab === "updates" && <Panel className="settings-panel"><UpdateSettings /></Panel>}
    </section>
  </>;
}

const syncItems = [
  ["account", "账户信息", UserRound],
  ["api_keys", "API 密钥", KeyRound],
  ["groups", "分组和倍率", Layers3],
  ["announcements", "公告", Megaphone],
] as const;

function SettingsHeader({ syncStatuses }: { syncStatuses?: StationSnapshot["syncStatuses"] }) {
  const statuses = syncItems.map(([key]) => syncStatuses?.[key]);
  const successCount = statuses.filter((status) => status?.status === "success").length;
  const failureCount = statuses.filter((status) => status && status.status !== "success").length;
  const summaryState = failureCount > 0 ? "warning" : successCount === syncItems.length ? "success" : "pending";
  const summaryLabel = summaryState === "success" ? "运行正常" : summaryState === "warning" ? "需要检查" : "同步中";
  const summaryDetail = failureCount > 0 ? `${failureCount} 项需要处理` : `${successCount}/${syncItems.length} 项已完成`;

  return <header className="settings-header">
    <div className="settings-header-top">
      <div className="settings-header-title">
        <span className="settings-header-icon" aria-hidden="true"><Settings2 size={21} /></span>
        <div>
          <span className="settings-header-kicker">应用控制台</span>
          <h1>设置</h1>
          <p>管理本地应用、站点同步与 Gateway 行为</p>
        </div>
      </div>
      {syncStatuses && <div className={`settings-sync-summary is-${summaryState}`}>
        <span className="settings-sync-summary-icon" aria-hidden="true"><CloudSync size={18} /></span>
        <span className="settings-sync-summary-copy"><span>站点同步</span><strong>{summaryDetail}</strong></span>
        <span className="settings-sync-summary-state">{summaryLabel}</span>
      </div>}
    </div>
    {syncStatuses && <SyncStatusCards syncStatuses={syncStatuses} />}
  </header>;
}

function SyncStatusCards({ syncStatuses }: { syncStatuses: StationSnapshot["syncStatuses"] }) {
  return <section className="settings-sync-panel" aria-labelledby="settings-sync-title">
    <div className="settings-sync-panel-heading">
      <div><span className="settings-sync-kicker">数据状态</span><h2 id="settings-sync-title">同步概览</h2></div>
      <span>随站点刷新自动更新</span>
    </div>
    <div className="settings-sync-grid">
      {syncItems.map(([key, label, Icon]) => {
        const status = syncStatuses?.[key];
        const state = status?.status === "success" ? "success" : status ? "error" : "pending";
        const stateLabel = state === "success" ? "已同步" : state === "error" ? "同步失败" : "等待同步";
        const detail = state === "success" ? `最近同步 ${formatSyncTime(status?.lastSyncedAt)}` : state === "error" ? status?.error || "请稍后重试" : "尚未获得同步结果";
        return <article key={key} className={`settings-sync-item is-${state}`}>
          <span className="settings-sync-item-icon" aria-hidden="true"><Icon size={16} /></span>
          <div className="settings-sync-item-copy"><strong>{label}</strong><span title={detail}>{detail}</span></div>
          <span className="settings-sync-item-status"><i aria-hidden="true" />{stateLabel}</span>
        </article>;
      })}
    </div>
  </section>;
}

function formatSyncTime(value?: number) {
  if (!value) return "尚未同步";
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(value * 1000);
}

function GeneralSettings({ backgroundRefreshMinutes, onBackgroundRefreshMinutesChange }: { backgroundRefreshMinutes: number; onBackgroundRefreshMinutesChange: (minutes: number) => void }) {
  const { notify } = useToast();
  const [selectedMinutes, setSelectedMinutes] = useState(backgroundRefreshMinutes);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelectedMinutes(backgroundRefreshMinutes);
  }, [backgroundRefreshMinutes]);

  const saveRefreshInterval = async (minutes: number) => {
    setSelectedMinutes(minutes);
    if (!isTauri()) {
      onBackgroundRefreshMinutesChange(minutes);
      return;
    }
    setSaving(true);
    try {
      const savedMinutes = await settingsApi.saveBackgroundRefreshMinutes(minutes);
      setSelectedMinutes(savedMinutes);
      onBackgroundRefreshMinutesChange(savedMinutes);
      notify("后台刷新间隔已更新。", "success");
    } catch (reason) {
      setSelectedMinutes(backgroundRefreshMinutes);
      notify(errorMessage(reason, "保存后台刷新设置失败。"), "error");
    } finally {
      setSaving(false);
    }
  };

  return <Panel className="settings-panel">
    <div className="settings-refresh-row">
      <div>
        <p className="font-medium">后台刷新</p>
        <p className="mt-1 text-sm text-slate-500">应用打开期间按选定间隔自动刷新所有站点。</p>
        <p className="mt-1 text-xs text-slate-500">建议不低于 {MIN_BACKGROUND_REFRESH_MINUTES} 分钟；站点较多时建议 30 分钟以上。</p>
      </div>
      <select
        className="input settings-refresh-select"
        aria-label="后台刷新间隔"
        value={selectedMinutes}
        disabled={saving}
        onChange={(event) => void saveRefreshInterval(Number(event.target.value))}
      >
        {BACKGROUND_REFRESH_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes >= 60 ? `${minutes / 60} 小时` : `${minutes} 分钟`}</option>)}
      </select>
    </div>
  </Panel>;
}

function AlertSettingsPanel() {
  return <Panel className="settings-panel">
    <SettingRow title="桌面通知" description="倍率、密钥状态或优惠内容发生变化时提醒。" value="已开启" />
    <AlertSettings />
  </Panel>;
}

function ProfilesSettings({ demoProfiles }: { demoProfiles: LoginProfile[] }) {
  return <LoginProfilesPage demoProfiles={demoProfiles} />;
}

function CodexEnhancement() {
  const { notify } = useToast();
  const [preserveOfficialLogin, setPreserveOfficialLogin] = useState(true);
  const [configDirectory, setConfigDirectory] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void settingsApi.codexIntegration()
      .then((status) => {
        setPreserveOfficialLogin(status.preserveOfficialLogin);
        setConfigDirectory(status.configDirectory);
      })
      .catch(() => undefined);
  }, []);

  const togglePreservation = async () => {
    const next = !preserveOfficialLogin;
    setSaving(true);
    try {
      const status = await settingsApi.setCodexOfficialLoginPreservation(next);
      setPreserveOfficialLogin(status.preserveOfficialLogin);
      setConfigDirectory(status.configDirectory);
    } catch (reason) {
      notify(errorMessage(reason), "error");
    } finally {
      setSaving(false);
    }
  };

  return <Panel className="settings-panel codex-enhancement-panel">
    <header className="codex-enhancement-header"><KeyRound size={20} /><h2>Codex 应用增强</h2></header>
    <div className="codex-enhancement-row">
      <div>
        <p>非接管切换时保留官方登录</p>
        <small>控制未开启路由接管时切换第三方供应商是否保留 Codex 官方登录；路由接管期间始终保留。</small>
        {configDirectory && <small className="codex-config-path">{configDirectory}</small>}
      </div>
      <button
        type="button"
        className={`settings-toggle ${preserveOfficialLogin ? "active" : ""}`}
        role="switch"
        aria-checked={preserveOfficialLogin}
        aria-label="非接管切换时保留官方登录"
        disabled={saving}
        onClick={() => void togglePreservation()}
      ><i /></button>
    </div>
  </Panel>;
}

function SettingRow({ title, description, value, action }: { title: string; description: string; value?: string; action?: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 border-b border-slate-100 p-4 last:border-b-0"><div><p className="font-medium">{title}</p><p className="mt-1 text-sm text-slate-500">{description}</p></div><div className="flex shrink-0 items-center gap-2">{value && <span className="text-sm text-teal-700">{value}</span>}{action}</div></div>;
}
