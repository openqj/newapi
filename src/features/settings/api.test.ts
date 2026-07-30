import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeDesktop } = vi.hoisted(() => ({ invokeDesktop: vi.fn() }));
vi.mock("../../lib/tauri", () => ({ invokeDesktop }));
vi.mock("../../lib/platform", () => ({ isTauri: () => true }));

import { settingsApi } from "./api";

describe("settingsApi cloud backup contract", () => {
  beforeEach(() => invokeDesktop.mockReset());

  it("reads the active Codex relay name", async () => {
    await settingsApi.activeCodexRelayName();

    expect(invokeDesktop).toHaveBeenCalledWith("get_active_codex_relay_name");
  });

  it("keeps cloud authentication and backup request shapes stable", async () => {
    await settingsApi.cloudSignIn("user@example.com", "password-123");
    await settingsApi.cloudRequestPasswordReset("user@example.com");
    await settingsApi.localCloudBackupPreview();
    await settingsApi.createCloudBackup("recovery-password");
    await settingsApi.deleteCloudBackup("backup-1");
    await settingsApi.previewCloudBackup("backup-1", "recovery-password");
    await settingsApi.restoreCloudBackup("backup-1", "recovery-password");

    expect(invokeDesktop).toHaveBeenNthCalledWith(1, "cloud_sign_in", { email: "user@example.com", password: "password-123" });
    expect(invokeDesktop).toHaveBeenNthCalledWith(2, "cloud_request_password_reset", { email: "user@example.com" });
    expect(invokeDesktop).toHaveBeenNthCalledWith(3, "get_local_cloud_backup_preview");
    expect(invokeDesktop).toHaveBeenNthCalledWith(4, "create_cloud_backup", { recoveryPassword: "recovery-password" });
    expect(invokeDesktop).toHaveBeenNthCalledWith(5, "delete_cloud_backup", { id: "backup-1" });
    expect(invokeDesktop).toHaveBeenNthCalledWith(6, "preview_cloud_backup", { id: "backup-1", recoveryPassword: "recovery-password" });
    expect(invokeDesktop).toHaveBeenNthCalledWith(7, "restore_cloud_backup", { id: "backup-1", recoveryPassword: "recovery-password" });
  });
});
