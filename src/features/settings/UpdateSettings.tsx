import type { ReactNode } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button, InlineAlert, useConfirm } from "../../components/ui";
import { isTauri } from "../../lib/platform";
import { useDesktopUpdate } from "./hooks";

/** Desktop updater presentation; all platform calls and lifecycle state live in this feature's api/hook. */
export function UpdateSettings() {
  const confirm = useConfirm();
  const { version, update, state, message, progress, setState, check, install: installUpdate } = useDesktopUpdate();
  const repositoryLink = <a className="button-secondary settings-repository-link" href="https://github.com/openqj/newapi" target="_blank" rel="noreferrer" aria-label="GitHub: openqj/newapi" title="GitHub: openqj/newapi"><svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.18-3.37-1.18-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.54 1.03 1.54 1.03.9 1.53 2.35 1.09 2.93.83.09-.65.35-1.09.64-1.34-2.22-.25-4.56-1.1-4.56-4.93 0-1.09.4-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.65 0 0 .84-.27 2.75 1.03a9.62 9.62 0 0 1 5 0c1.9-1.3 2.74-1.03 2.74-1.03.55 1.38.2 2.4.1 2.65.64.7 1.03 1.6 1.03 2.69 0 3.84-2.34 4.67-4.57 4.92.36.31.68.9.68 1.82v2.7c0 .27.18.58.69.48A10 10 0 0 0 12 2Z" /></svg></a>;

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
    return <SettingRow title="桌面更新" description="请在 RelayHub 桌面应用中检查更新。" value="Web 演示" action={repositoryLink} />;
  }

  return <div className="setting-update">
    <SettingRow
      title="桌面更新"
      description={version ? `当前版本 ${version}。更新仅在签名验证后安装。` : "检查已签名的 RelayHub 更新。"}
      value={update ? `可更新至 ${update.version}` : state === "latest" ? "已是最新" : ""}
      action={<>
        {repositoryLink}
        <Button variant="secondary" disabled={state === "checking" || state === "downloading"} onClick={() => void check()}>
          <RefreshCw size={15} className={state === "checking" ? "animate-spin" : ""} />检查更新
        </Button>
        {update && <Button variant="primary" disabled={state === "downloading"} onClick={() => void install()}>
          <Download size={15} />{state === "downloading" ? "下载中" : "安装"}
        </Button>}
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
