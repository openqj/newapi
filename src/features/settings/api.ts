import { isTauri } from "../../lib/platform";
import { invokeDesktop } from "../../lib/tauri";
import type { ActiveCodexRelayStatus, CloudAuthStatus, CloudBackupPreview, CloudBackupSummary, CodexIntegrationStatus } from "./types";
import type { PendingDesktopUpdate } from "./types";

export const DEFAULT_BACKGROUND_REFRESH_MINUTES = 30;
export const MIN_BACKGROUND_REFRESH_MINUTES = 10;
export const BACKGROUND_REFRESH_OPTIONS = [10, 15, 30, 60, 120, 240, 480, 1440] as const;

/** Official Tauri updater calls are kept behind this feature boundary. */
export const settingsApi = {
  backgroundRefreshMinutes: () => invokeDesktop<number>("get_background_refresh_minutes"),
  saveBackgroundRefreshMinutes: (minutes: number) => invokeDesktop<number>("save_background_refresh_minutes", { minutes }),
  codexIntegration: () => invokeDesktop<CodexIntegrationStatus>("get_codex_integration"),
  activeCodexRelayStatus: () => invokeDesktop<ActiveCodexRelayStatus | null>("get_active_codex_relay_status"),
  setCodexOfficialLoginPreservation: (preserveOfficialLogin: boolean) => invokeDesktop<CodexIntegrationStatus>("set_codex_preserve_official_login", { preserveOfficialLogin }),
  cloudAuthStatus: () => invokeDesktop<CloudAuthStatus>("get_cloud_auth_status"),
  cloudSignUp: (email: string, password: string) => invokeDesktop<CloudAuthStatus>("cloud_sign_up", { email, password }),
  cloudSignIn: (email: string, password: string) => invokeDesktop<CloudAuthStatus>("cloud_sign_in", { email, password }),
  cloudRequestPasswordReset: (email: string) => invokeDesktop<void>("cloud_request_password_reset", { email }),
  cloudCompletePasswordReset: (accessToken: string, refreshToken: string, expiresIn: number, password: string) =>
    invokeDesktop<CloudAuthStatus>("cloud_complete_password_reset", { accessToken, refreshToken, expiresIn, password }),
  cloudSignOut: () => invokeDesktop<void>("cloud_sign_out"),
  cloudBackups: () => invokeDesktop<CloudBackupSummary[]>("list_cloud_backups"),
  localCloudBackupPreview: () => invokeDesktop<CloudBackupPreview>("get_local_cloud_backup_preview"),
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
