import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../lib/platform";
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
    <button type="button" className="window-control-button" aria-label="最小化" title="最小化" onClick={() => void getCurrentWindow().minimize()}><span className="window-control-icon window-minimize-icon" /></button>
    <button type="button" className="window-control-button" aria-label="最大化或还原" title="最大化或还原" onClick={() => void toggleMaximize()}><span className={`window-control-icon ${maximized ? "window-restore-icon" : "window-maximize-icon"}`} /></button>
    <button type="button" className="window-control-button window-close-button" aria-label="关闭窗口" title="关闭" onClick={() => void getCurrentWindow().close()}><span className="window-control-icon window-close-icon" /></button>
  </div>;
}
