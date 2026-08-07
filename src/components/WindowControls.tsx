import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../lib/platform";
import { IconButton } from "./ui";
import "./WindowControls.css";

export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const currentWindow = getCurrentWindow();
    void currentWindow.isMaximized().then(setMaximized);
    let unlisten: (() => void) | undefined;
    void currentWindow.onResized(() => void currentWindow.isMaximized().then(setMaximized)).then((value) => { unlisten = value; });
    return () => unlisten?.();
  }, []);

  if (!isTauri()) return null;

  const toggleMaximize = async () => {
    const currentWindow = getCurrentWindow();
    await currentWindow.toggleMaximize();
    setMaximized(await currentWindow.isMaximized());
  };

  return <div className="window-controls">
    <IconButton variant="ghost" className="window-control-button" label="最小化" onClick={() => void getCurrentWindow().minimize()} icon={<span className="window-control-icon window-minimize-icon" />} />
    <IconButton variant="ghost" className="window-control-button" label="最大化或还原" onClick={() => void toggleMaximize()} icon={<span className={`window-control-icon ${maximized ? "window-restore-icon" : "window-maximize-icon"}`} />} />
    <IconButton variant="ghost" className="window-control-button window-close-button" label="关闭窗口" onClick={() => void getCurrentWindow().close()} icon={<span className="window-control-icon window-close-icon" />} />
  </div>;
}
