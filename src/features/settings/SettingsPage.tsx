import { PageHeader, Panel } from "../../components/ui";
import { UpdateSettings } from "./UpdateSettings";

export function SettingsPage({ onManageProfiles }: { onManageProfiles: () => void }) {
  return <>
    <PageHeader title="设置" description="本地应用设置" />
    <Panel className="settings-panel">
      <SettingRow title="后台刷新" description="应用打开期间每 30 分钟自动刷新所有站点。" value="30 分钟" />
      <SettingRow title="桌面通知" description="仅在倍率、密钥状态或优惠内容发生变化时提醒。" value="已开启" />
      <SettingRow title="凭据存储" description="账号密码和登录态使用 Windows Credential Manager 保存。" value="系统凭据库" />
      <UpdateSettings />
      <SettingRow title="常用登录" description="管理用于快速填写中转站登录信息的本地凭据。" action={<button type="button" className="button-secondary" onClick={onManageProfiles}>管理</button>} />
    </Panel>
  </>;
}

function SettingRow({ title, description, value, action }: { title: string; description: string; value?: string; action?: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 border-b border-slate-100 p-4 last:border-b-0"><div><p className="font-medium">{title}</p><p className="mt-1 text-sm text-slate-500">{description}</p></div><div className="flex shrink-0 items-center gap-2">{value && <span className="text-sm text-teal-700">{value}</span>}{action}</div></div>;
}
