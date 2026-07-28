import type { ReactNode } from "react";
import { Download, RefreshCw } from "lucide-react";
import { InlineAlert, useConfirm } from "../../components/ui";
import { isTauri } from "../../lib/platform";
import { useDesktopUpdate } from "./hooks";

/** Desktop updater presentation; all platform calls and lifecycle state live in this feature's api/hook. */
export function UpdateSettings() {
  const confirm = useConfirm();
  const { version, update, state, message, progress, setState, check, install: installUpdate } = useDesktopUpdate();

  const install = async () => {
    if (!update) return void check();
    const accepted = await confirm({
      title: "安装更新",
      description: `RelayHub ${update.version} 已可用。下载后将重启应用完成安装。`,
      confirmLabel: "下载并安装",
    });
    if (accepted) await installUpdate();
  };

  if (!isTauri()) {
    return <SettingRow title="桌面更新" description="请在 RelayHub 桌面应用中检查更新。" value="Web 演示" />;
  }

  return <div className="setting-update">
    <SettingRow
      title="桌面更新"
      description={version ? `当前版本 ${version}。更新仅在签名验证后安装。` : "检查已签名的 RelayHub 更新。"}
      value={update ? `可更新至 ${update.version}` : state === "latest" ? "已是最新" : ""}
      action={<>
        <button type="button" className="button-secondary" disabled={state === "checking" || state === "downloading"} onClick={() => void check()}>
          <RefreshCw size={15} className={state === "checking" ? "animate-spin" : ""} />检查更新
        </button>
        {update && <button type="button" className="button-primary" disabled={state === "downloading"} onClick={() => void install()}>
          <Download size={15} />{state === "downloading" ? "下载中" : "安装"}
        </button>}
      </>}
    />
    {state === "downloading" && <div className="setting-update-progress" role="status">
      <span>{progress == null ? "正在下载更新..." : `正在下载更新，${progress}%`}</span>
      {progress != null && <i><b style={{ width: `${progress}%` }} /></i>}
    </div>}
    {state === "error" && <div className="px-4 pb-4"><InlineAlert onDismiss={() => setState("idle")}>{message}</InlineAlert></div>}
  </div>;
}

function SettingRow({ title, description, value, action }: { title: string; description: string; value?: string; action?: ReactNode }) {
  return <div className="flex items-center justify-between gap-4 p-4"><div><p className="font-medium">{title}</p><p className="mt-1 text-sm text-slate-500">{description}</p></div><div className="flex shrink-0 items-center gap-2">{value && <span className="text-sm text-teal-700">{value}</span>}{action}</div></div>;
}
