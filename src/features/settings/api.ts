import { isTauri } from "../../lib/platform";
import { invokeDesktop } from "../../lib/tauri";
import type { CloudAuthStatus, CloudBackupPreview, CloudBackupSummary, CodexIntegrationStatus } from "./types";
import type { PendingDesktopUpdate } from "./types";

/** Official Tauri updater calls are kept behind this feature boundary. */
export const settingsApi = {
  codexIntegration: () => invokeDesktop<CodexIntegrationStatus>("get_codex_integration"),
  activeCodexRelayName: () => invokeDesktop<string | null>("get_active_codex_relay_name"),
  setCodexOfficialLoginPreservation: (preserveOfficialLogin: boolean) => invokeDesktop<CodexIntegrationStatus>("set_codex_preserve_official_login", { preserveOfficialLogin }),
  cloudAuthStatus: () => invokeDesktop<CloudAuthStatus>("get_cloud_auth_status"),
  cloudSignUp: (email: string, password: string) => invokeDesktop<CloudAuthStatus>("cloud_sign_up", { email, password }),
  cloudSignIn: (email: string, password: string) => invokeDesktop<CloudAuthStatus>("cloud_sign_in", { email, password }),
  cloudRequestPasswordReset: (email: string) => invokeDesktop<void>("cloud_request_password_reset", { email }),
  cloudSignOut: () => invokeDesktop<void>("cloud_sign_out"),
  cloudBackups: () => invokeDesktop<CloudBackupSummary[]>("list_cloud_backups"),
  createCloudBackup: (recoveryPassword: string) => invokeDesktop<CloudBackupSummary>("create_cloud_backup", { recoveryPassword }),
  deleteCloudBackup: (id: string) => invokeDesktop<void>("delete_cloud_backup", { id }),
  previewCloudBackup: (id: string, recoveryPassword: string) => invokeDesktop<CloudBackupPreview>("preview_cloud_backup", { id, recoveryPassword }),
  restoreCloudBackup: (id: string, recoveryPassword: string) => invokeDesktop<CloudBackupPreview>("restore_cloud_backup", { id, recoveryPassword }),
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
