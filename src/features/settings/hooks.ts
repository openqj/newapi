import { useCallback, useEffect, useState } from "react";
import { useToast } from "../../components/ui";
import { errorMessage } from "../../lib/errors";
import { settingsApi } from "./api";
import type { DesktopUpdateState, PendingDesktopUpdate } from "./types";

/** Shared signed-update lifecycle. The UI retains ownership of confirmation wording. */
export function useDesktopUpdate() {
  const { notify } = useToast();
  const [version, setVersion] = useState("");
  const [update, setUpdate] = useState<PendingDesktopUpdate | null>(null);
  const [state, setState] = useState<DesktopUpdateState>("idle");
  const [message, setMessage] = useState("");
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => { void settingsApi.appVersion().then(setVersion).catch(() => undefined); }, []);

  const check = useCallback(async () => {
    setState("checking");
    setMessage("");
    try {
      const available = await settingsApi.checkForUpdate();
      setUpdate(available);
      setState(available ? "idle" : "latest");
      if (!available) notify("当前已是最新版本。", "success");
      return available;
    } catch (reason) {
      setUpdate(null);
      setState("error");
      setMessage(errorMessage(reason, "无法检查更新，请稍后重试。"));
      return null;
    }
  }, [notify]);

  const install = useCallback(async () => {
    if (!update) return check();
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
      await settingsApi.relaunch();
    } catch (reason) {
      setState("error");
      setMessage(errorMessage(reason, "无法安装更新，请稍后重试。"));
    }
  }, [check, update]);

  return { version, update, state, message, progress, setState, check, install };
}
