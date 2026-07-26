import { PageHeader, Panel } from "../../components/ui";
import { UpdateSettings } from "./UpdateSettings";

export function SettingsPage({ onManageProfiles }: { onManageProfiles: () => void }) {
  return <>
    <PageHeader title="\u8bbe\u7f6e" description="\u672c\u5730\u5e94\u7528\u8bbe\u7f6e" />
    <Panel className="settings-panel">
      <SettingRow title="\u540e\u53f0\u5237\u65b0" description="\u5e94\u7528\u6253\u5f00\u671f\u95f4\u6bcf 30 \u5206\u949f\u81ea\u52a8\u5237\u65b0\u6240\u6709\u7ad9\u70b9\u3002" value="30 \u5206\u949f" />
      <SettingRow title="\u684c\u9762\u901a\u77e5" description="\u4ec5\u5728\u500d\u7387\u3001\u5bc6\u94a5\u72b6\u6001\u6216\u4f18\u60e0\u5185\u5bb9\u53d1\u751f\u53d8\u5316\u65f6\u63d0\u9192\u3002" value="\u5df2\u5f00\u542f" />
      <SettingRow title="\u51ed\u636e\u5b58\u50a8" description="\u8d26\u53f7\u5bc6\u7801\u548c\u767b\u5f55\u6001\u4f7f\u7528 Windows Credential Manager \u4fdd\u5b58\u3002" value="\u7cfb\u7edf\u51ed\u636e\u5e93" />
      <UpdateSettings />
      <SettingRow title="\u5e38\u7528\u767b\u5f55" description="\u7ba1\u7406\u7528\u4e8e\u5feb\u901f\u586b\u5199\u4e2d\u8f6c\u7ad9\u767b\u5f55\u4fe1\u606f\u7684\u672c\u5730\u51ed\u636e\u3002" action={<button type="button" className="button-secondary" onClick={onManageProfiles}>\u7ba1\u7406</button>} />
    </Panel>
  </>;
}

function SettingRow({ title, description, value, action }: { title: string; description: string; value?: string; action?: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-4 border-b border-slate-100 p-4 last:border-b-0"><div><p className="font-medium">{title}</p><p className="mt-1 text-sm text-slate-500">{description}</p></div><div className="flex shrink-0 items-center gap-2">{value && <span className="text-sm text-teal-700">{value}</span>}{action}</div></div>;
}
