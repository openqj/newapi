import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { PageHeader, Panel, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { UpdateSettings } from "../UpdateSettings";
import { AlertSettings } from "../../alerts";
import { AlertHistoryPage } from "../../alerts/pages/AlertHistoryPage";
import { LoginProfilesPage } from "../../profiles";
import { settingsApi } from "../api";
import { AutoRegistrationSettings } from "../components/AutoRegistrationSettings";
import type { LoginProfile } from "../../profiles";
import "./SettingsPage.css";

type SettingsTab = "general" | "alerts" | "alertHistory" | "profiles" | "autoRegistration" | "codex" | "updates";

const settingsTabs: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "常规" },
  { id: "alerts", label: "通知与告警" },
  { id: "alertHistory", label: "告警历史与趋势" },
  { id: "profiles", label: "常用登录" },
  { id: "autoRegistration", label: "自动注册" },
  { id: "codex", label: "Codex" },
  { id: "updates", label: "更新" },
];

export function SettingsPage({ demoProfiles }: { demoProfiles: LoginProfile[] }) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");

  return <>
    <PageHeader title="设置" description="本地应用设置" />
    <nav className="settings-tabs" aria-label="设置导航">
      {settingsTabs.map((tab) => <button
        key={tab.id}
        type="button"
        aria-current={activeTab === tab.id ? "page" : undefined}
        className={`settings-tab ${activeTab === tab.id ? "active" : ""}`}
        onClick={() => setActiveTab(tab.id)}
      >{tab.label}</button>)}
    </nav>
    <section>
      {activeTab === "general" && <GeneralSettings />}
      {activeTab === "alerts" && <AlertSettingsPanel />}
      {activeTab === "alertHistory" && <AlertHistoryPage />}
      {activeTab === "profiles" && <ProfilesSettings demoProfiles={demoProfiles} />}
      {activeTab === "autoRegistration" && <AutoRegistrationSettings />}
      {activeTab === "codex" && <CodexEnhancement />}
      {activeTab === "updates" && <Panel className="settings-panel"><UpdateSettings /></Panel>}
    </section>
  </>;
}

function GeneralSettings() {
  return <Panel className="settings-panel">
    <SettingRow title="后台刷新" description="应用打开期间每 30 分钟自动刷新所有站点。" value="30 分钟" />
  </Panel>;
}

function AlertSettingsPanel() {
  return <Panel className="settings-panel">
    <SettingRow title="桌面通知" description="倍率、密钥状态或优惠内容发生变化时提醒。" value="已开启" />
    <AlertSettings />
  </Panel>;
}

function ProfilesSettings({ demoProfiles }: { demoProfiles: LoginProfile[] }) {
  return <>
    <LoginProfilesPage demoProfiles={demoProfiles} />
    <Panel className="settings-panel credential-storage-panel">
      <SettingRow title="凭据存储" description="账号密码和登录态使用 Windows Credential Manager 保存。" value="系统凭据库" />
    </Panel>
  </>;
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
