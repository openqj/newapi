export type RoutingMode = "ccSwitch" | "localGateway";
export type ConnectionMode = "disabled" | "direct" | "localRouting";

export type GatewayRouteSelection = {
  stationId: string;
  keyId: string;
};

export type GatewayRouteHealthState = "closed" | "open" | "halfOpen";

export type GatewayRouteHealth = GatewayRouteSelection & {
  state: GatewayRouteHealthState;
  consecutiveFailures: number;
  totalRequests: number;
  failedRequests: number;
  cooldownRemainingMs: number;
  lastFailureAt?: string | null;
};

export type GatewayStatus = {
  mode: RoutingMode;
  connectionMode: ConnectionMode;
  running: boolean;
  port: number;
  baseUrl: string;
  activeStationId?: string | null;
  activeKeyId?: string | null;
  hasActiveRoute: boolean;
  routeQueue: GatewayRouteSelection[];
  routeHealth: GatewayRouteHealth[];
};
