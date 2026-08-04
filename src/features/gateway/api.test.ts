import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeDesktop } = vi.hoisted(() => ({ invokeDesktop: vi.fn() }));
vi.mock("../../lib/tauri", () => ({ invokeDesktop }));

import { gatewayApi } from "./api";

describe("gatewayApi command contract", () => {
  beforeEach(() => invokeDesktop.mockReset());

  it("keeps Gateway status, route and health commands stable", async () => {
    const routes = [{ stationId: "station-1", keyId: "key-1" }];

    await gatewayApi.status();
    await gatewayApi.setMode("localGateway");
    await gatewayApi.setPort(18765);
    await gatewayApi.start();
    await gatewayApi.stop();
    await gatewayApi.setRoutes(routes);
    await gatewayApi.resetRouteHealth("station-1", "key-1");

    expect(invokeDesktop).toHaveBeenNthCalledWith(1, "get_gateway_status");
    expect(invokeDesktop).toHaveBeenNthCalledWith(2, "set_routing_mode", { mode: "localGateway" });
    expect(invokeDesktop).toHaveBeenNthCalledWith(3, "set_gateway_port", { port: 18765 });
    expect(invokeDesktop).toHaveBeenNthCalledWith(4, "start_gateway");
    expect(invokeDesktop).toHaveBeenNthCalledWith(5, "stop_gateway");
    expect(invokeDesktop).toHaveBeenNthCalledWith(6, "set_active_gateway_routes", { routes });
    expect(invokeDesktop).toHaveBeenNthCalledWith(7, "reset_gateway_route_health", { stationId: "station-1", keyId: "key-1" });
  });
});
