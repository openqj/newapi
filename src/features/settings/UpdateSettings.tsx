import { useEffect, useState, type ReactNode } from "react";
import { Download, RefreshCw } from "lucide-react";
import { InlineAlert, useConfirm, useToast } from "../../components/ui";
import { errorMessage } from "../../lib/errors";
import { isTauri } from "../../lib/platform";

type PendingUpdate = {
  version: string;
  downloadAndInstall: (onEvent?: (event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void>;
};

export function UpdateSettings() {
  const confirm = useConfirm();
  const { notify } = useToast();
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<PendingUpdate | null>(null);
  const [state, setState] = useState<"idle" | "checking" | "downloading" | "latest" | "error">("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  const check = async () => {
    if (!isTauri()) return;
    setState("checking");
    setMessage("");
    try {
      const { check } = await import("@tauri-apps/plugin-updater");
      const available = await check();
      setUpdate(available as PendingUpdate | null);
      setState(available ? "idle" : "latest");
      if (!available) notify("You are running the latest version.", "success");
    } catch (reason) {
      setUpdate(null);
      setState("error");
      setMessage(errorMessage(reason, "Unable to check for updates. Please try again."));
    }
  };

  const install = async () => {
    if (!update) return void check();
    if (!(await confirm({ title: "Install update", description: `RelayHub ${update.version} is available. Download and restart to install it?`, confirmLabel: "Download and install" }))) return;
    setState("downloading");
    setProgress(0);
    let contentLength = 0;
    let downloaded = 0;
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") contentLength = event.data?.contentLength ?? 0;
        if (event.event === "Progress") {
          downloaded += event.data?.chunkLength ?? 0;
          setProgress(contentLength > 0 ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : null);
        }
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (reason) {
      setState("error");
      setMessage(errorMessage(reason, "Unable to install the update. Please try again."));
    }
  };

  if (!isTauri()) return <SettingRow title="Desktop updates" description="Updates are available in the RelayHub desktop app." value="Web demo" />;
  return <div className="setting-update"><SettingRow title="Desktop updates" description={version ? `Current version ${version}. Updates are installed only after signature verification.` : "Check for a signed RelayHub update."} value={update ? `Version ${update.version} available` : state === "latest" ? "Up to date" : ""} action={<><button type="button" className="button-secondary" disabled={state === "checking" || state === "downloading"} onClick={() => void check()}><RefreshCw size={15} className={state === "checking" ? "animate-spin" : ""} />Check</button>{update && <button type="button" className="button-primary" disabled={state === "downloading"} onClick={() => void install()}><Download size={15} />{state === "downloading" ? "Downloading" : "Install"}</button>}</>} />{state === "downloading" && <div className="setting-update-progress" role="status"><span>{progress == null ? "Downloading update..." : `Downloading update: ${progress}%`}</span>{progress != null && <i><b style={{ width: `${progress}%` }} /></i>}</div>}{state === "error" && <div className="px-4 pb-4"><InlineAlert onDismiss={() => setState("idle")}>{message}</InlineAlert></div>}</div>;
}

function SettingRow({ title, description, value, action }: { title: string; description: string; value?: string; action?: ReactNode }) {
  return <div className="flex items-center justify-between gap-4 p-4"><div><p className="font-medium">{title}</p><p className="mt-1 text-sm text-slate-500">{description}</p></div><div className="flex shrink-0 items-center gap-2">{value && <span className="text-sm text-teal-700">{value}</span>}{action}</div></div>;
}
