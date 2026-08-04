import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeDesktop } = vi.hoisted(() => ({ invokeDesktop: vi.fn() }));
vi.mock("../../lib/tauri", () => ({ invokeDesktop }));

import { configProfileApi } from "./api";

describe("configProfileApi command contract", () => {
  beforeEach(() => invokeDesktop.mockReset());

  it("keeps profile CRUD and apply payloads stable", async () => {
    const draft = {
      name: "Daily Claude",
      application: "claude" as const,
      stationId: "station-1",
      keyId: "key-1",
      baseUrl: "",
      model: "claude-sonnet-4-5",
      protocol: "anthropic",
    };
    await configProfileApi.list();
    await configProfileApi.save(draft);
    await configProfileApi.active();
    await configProfileApi.apply("profile-1");
    await configProfileApi.backups();
    await configProfileApi.previewBackup("backup-1");
    await configProfileApi.restoreBackup("backup-1");
    await configProfileApi.remove("profile-1");

    expect(invokeDesktop).toHaveBeenNthCalledWith(1, "list_config_profiles");
    expect(invokeDesktop).toHaveBeenNthCalledWith(2, "save_config_profile", { request: draft });
    expect(invokeDesktop).toHaveBeenNthCalledWith(3, "get_active_config_profile");
    expect(invokeDesktop).toHaveBeenNthCalledWith(4, "apply_config_profile", { id: "profile-1" });
    expect(invokeDesktop).toHaveBeenNthCalledWith(5, "list_config_backups");
    expect(invokeDesktop).toHaveBeenNthCalledWith(6, "preview_config_backup", { id: "backup-1" });
    expect(invokeDesktop).toHaveBeenNthCalledWith(7, "restore_config_backup", { id: "backup-1" });
    expect(invokeDesktop).toHaveBeenNthCalledWith(8, "delete_config_profile", { id: "profile-1" });
  });
});
