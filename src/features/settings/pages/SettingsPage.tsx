import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { PageHeader, Panel, useToast } from "../../../components/ui";
import { errorMessage } from "../../../lib/errors";
import { UpdateSettings } from "../UpdateSettings";
import { AlertSettings } from "../../alerts";
import { settingsApi } from "../api";
import "./SettingsPage.css";

export function SettingsPage({ onManageProfiles, onViewAlertHistory }: { onManageProfiles: () => void; onViewAlertHistory: () => void }) {
  return <>
    <PageHeader title="设置" description="本地应用设置" />
    <Panel className="settings-panel">
      <SettingRow title="后台刷新" description="应用打开期间每 30 分钟自动刷新所有站点。" value="30 分钟" />
      <SettingRow title="桌面通知" description="倍率、密钥状态或优惠内容发生变化时提醒。" value="已开启" />
      <AlertSettings onViewHistory={onViewAlertHistory} />
      <SettingRow title="凭据存储" description="账号密码和登录态使用 Windows Credential Manager 保存。" value="系统凭据库" />
      <SettingRow title="常用登录" description="管理用于快速填写中转站登录信息的本地凭据。" action={<button type="button" className="button-secondary" onClick={onManageProfiles}>管理</button>} />
    </Panel>
    <CodexEnhancement />
    <Panel className="settings-panel settings-update-panel"><UpdateSettings /></Panel>
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
