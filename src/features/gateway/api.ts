import { invokeDesktop } from "../../lib/tauri";
import type { GatewayRouteSelection, GatewayStatus, RoutingMode } from "./types";

export const gatewayApi = {
  status: () => invokeDesktop<GatewayStatus>("get_gateway_status"),
  setMode: (mode: RoutingMode) => invokeDesktop<GatewayStatus>("set_routing_mode", { mode }),
  setPort: (port: number) => invokeDesktop<GatewayStatus>("set_gateway_port", { port }),
  start: () => invokeDesktop<GatewayStatus>("start_gateway"),
  stop: () => invokeDesktop<GatewayStatus>("stop_gateway"),
  setRoutes: (routes: GatewayRouteSelection[]) => invokeDesktop<GatewayStatus>("set_active_gateway_routes", { routes }),
  resetRouteHealth: (stationId: string, keyId: string) => invokeDesktop<GatewayStatus>("reset_gateway_route_health", { stationId, keyId }),
};
