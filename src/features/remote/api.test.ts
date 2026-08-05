import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeDesktop } = vi.hoisted(() => ({ invokeDesktop: vi.fn() }));
vi.mock("../../lib/tauri", () => ({ invokeDesktop }));

import { remoteApi } from "./api";

describe("remoteApi command contract", () => {
  beforeEach(() => invokeDesktop.mockReset());

  it("keeps relay-key and remote-save payloads stable", async () => {
    await remoteApi.assignRelayKey("server-1", "station-1", "key-1");
    await remoteApi.updateRelay("server-1", "https://relay.example.com", "secret");
    await remoteApi.save(undefined, { name: "new server" });
    await remoteApi.save("server-1", { id: "server-1", name: "edited server" });

    expect(invokeDesktop).toHaveBeenNthCalledWith(1, "assign_remote_relay_key", { serverId: "server-1", stationId: "station-1", keyId: "key-1" });
    expect(invokeDesktop).toHaveBeenNthCalledWith(2, "update_remote_relay", { request: { serverId: "server-1", relayUrl: "https://relay.example.com", relayKey: "secret" } });
    expect(invokeDesktop).toHaveBeenNthCalledWith(3, "add_remote_server", { request: { name: "new server" } });
    expect(invokeDesktop).toHaveBeenNthCalledWith(4, "update_remote_server", { request: { id: "server-1", name: "edited server" } });
  });

  it("uses the local Codex relay transfer command", async () => {
    await remoteApi.assignLocalRelay("server-1");

    expect(invokeDesktop).toHaveBeenCalledWith("assign_local_codex_relay", { serverId: "server-1" });
  });
});
