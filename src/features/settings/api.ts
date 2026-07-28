import { isTauri } from "../../lib/platform";
import type { PendingDesktopUpdate } from "./types";

/** Official Tauri updater calls are kept behind this feature boundary. */
export const settingsApi = {
  async appVersion() {
    if (!isTauri()) return "";
    const { getVersion } = await import("@tauri-apps/api/app");
    return getVersion();
  },
  async checkForUpdate(): Promise<PendingDesktopUpdate | null> {
    if (!isTauri()) return null;
    const { check } = await import("@tauri-apps/plugin-updater");
    return (await check()) as PendingDesktopUpdate | null;
  },
  async relaunch() {
    if (!isTauri()) return;
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  },
};
