import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "./DashboardPage";
import type { KeyRow } from "../../api-keys";

const { gatewayStatus, isTauri } = vi.hoisted(() => ({
  gatewayStatus: vi.fn(),
  isTauri: vi.fn(() => true),
}));

vi.mock("../../../lib/platform", () => ({ isTauri }));
vi.mock("../../gateway/api", () => ({
  gatewayApi: {
    status: gatewayStatus,
    setMode: vi.fn(),
    setRoute: vi.fn(),
  },
}));
vi.mock("../../settings/api", () => ({
  settingsApi: {
    appVersion: vi.fn(() => Promise.resolve("0.1.5")),
    checkForUpdate: vi.fn(() => Promise.resolve(null)),
  },
}));

const keyRow: KeyRow = {
  stationId: "station-1",
  stationName: "Alpha Gateway",
  stationUrl: "https://alpha.example.com",
  stationBalance: 12.345,
  groups: [],
  models: [],
  key: {
    id: "key-1",
    name: "开发环境",
    maskedKey: "sk-...test",
    status: "active",
  },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DashboardPage local route pool", () => {
  it("shows queued routes and their health in local routing mode", async () => {
    gatewayStatus.mockResolvedValue({
      mode: "localGateway",
      running: true,
      port: 8787,
      baseUrl: "http://127.0.0.1:8787/v1",
      activeStationId: "station-1",
      activeKeyId: "key-1",
      hasActiveRoute: true,
      routeQueue: [
        { stationId: "station-1", keyId: "key-1" },
        { stationId: "station-2", keyId: "key-2" },
      ],
      routeHealth: [
        { stationId: "station-1", keyId: "key-1", state: "closed", consecutiveFailures: 0, totalRequests: 12, failedRequests: 0, cooldownRemainingMs: 0 },
        { stationId: "station-2", keyId: "key-2", state: "open", consecutiveFailures: 2, totalRequests: 4, failedRequests: 2, cooldownRemainingMs: 12_000 },
      ],
    });

    render(
      <DashboardPage
        stations={[
          { id: "station-1", name: "Alpha Gateway", baseUrl: "https://alpha.example.com", kind: "newapi", status: "online" },
          { id: "station-2", name: "Orbit API", baseUrl: "https://orbit.example.com", kind: "sub2api", status: "online" },
        ]}
        keys={[keyRow]}
        remoteServers={[]}
        accountRows={[]}
        summary={{}}
        usageRows={[]}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onNavigate={vi.fn()}
        onOpenUpdates={vi.fn()}
      />,
    );

    const pool = await waitFor(() => screen.getByRole("region", { name: "本地路由池" }));
    expect(within(pool).getByText("Alpha Gateway")).toBeInTheDocument();
    expect(within(pool).getByText("开发环境")).toBeInTheDocument();
    expect(within(pool).getByText("可用")).toBeInTheDocument();
    expect(within(pool).getByText("station-2")).toBeInTheDocument();
    expect(within(pool).getByText("冷却中 · 冷却 12 秒")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开 auth.json" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开 config.toml" })).not.toBeInTheDocument();
  });

  it("shows detailed credentials and relay information in direct mode", async () => {
    gatewayStatus.mockResolvedValue({
      mode: "ccSwitch",
      running: false,
      port: 8787,
      baseUrl: "http://127.0.0.1:8787/v1",
      activeStationId: "station-1",
      activeKeyId: "key-1",
      hasActiveRoute: true,
      routeQueue: [],
      routeHealth: [],
    });

    render(
      <DashboardPage
        stations={[{ id: "station-1", name: "Alpha Gateway", baseUrl: "https://alpha.example.com", kind: "newapi", status: "online" }]}
        keys={[{ ...keyRow, key: { ...keyRow.key, group: "default" } }]}
        remoteServers={[]}
        accountRows={[]}
        summary={{}}
        usageRows={[]}
        onRefresh={vi.fn().mockResolvedValue(undefined)}
        onNavigate={vi.fn()}
        onOpenUpdates={vi.fn()}
      />,
    );

    const routingCard = await waitFor(() => screen.getByRole("heading", { name: "中转方式" }).closest("article"));
    expect(routingCard).not.toBeNull();
    expect(within(routingCard as HTMLElement).getByText("开发环境")).toBeInTheDocument();
    expect(within(routingCard as HTMLElement).getByText("sk-...test")).toBeInTheDocument();
    expect(within(routingCard as HTMLElement).getByText("分组：default")).toBeInTheDocument();
    expect(within(routingCard as HTMLElement).getByText("Alpha Gateway")).toBeInTheDocument();
    expect(within(routingCard as HTMLElement).getByText("https://alpha.example.com")).toBeInTheDocument();
    expect(within(routingCard as HTMLElement).getByText("剩余：$12.35")).toBeInTheDocument();
  });
});
