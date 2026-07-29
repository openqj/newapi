import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeDesktop } = vi.hoisted(() => ({ invokeDesktop: vi.fn() }));
vi.mock("../../lib/tauri", () => ({ invokeDesktop }));

import { stationApi } from "./api";

describe("stationApi command contract", () => {
  beforeEach(() => invokeDesktop.mockReset());

  it("keeps refresh and synchronization command names stable", async () => {
    await stationApi.refresh("station-1");
    await stationApi.syncProgress();
    await stationApi.cancelSync();

    expect(invokeDesktop).toHaveBeenNthCalledWith(1, "refresh_station", { id: "station-1" });
    expect(invokeDesktop).toHaveBeenNthCalledWith(2, "get_sync_progress");
    expect(invokeDesktop).toHaveBeenNthCalledWith(3, "cancel_sync");
  });

  it("keeps add and probe request shapes stable", async () => {
    await stationApi.probe("https://relay.example.com");
    await stationApi.add({ name: "Relay", baseUrl: "https://relay.example.com" });
    await stationApi.update({ id: "station-1", name: "Relay", baseUrl: "https://relay.example.com" });

    expect(invokeDesktop).toHaveBeenNthCalledWith(1, "probe_station", { baseUrl: "https://relay.example.com" });
    expect(invokeDesktop).toHaveBeenNthCalledWith(2, "add_station", { request: { name: "Relay", baseUrl: "https://relay.example.com" } });
    expect(invokeDesktop).toHaveBeenNthCalledWith(3, "update_station", { request: { id: "station-1", name: "Relay", baseUrl: "https://relay.example.com" } });
  });
});
