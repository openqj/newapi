import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmationProvider, ToastProvider } from "../../../components/ui";
import { ApiKeysPage } from "./ApiKeysPage";
import type { KeyRow } from "../types";

const { applyToCodex, gatewayStatus, groups, isTauri, reauthenticate, refresh, setRoutes, testModels } = vi.hoisted(() => ({
  applyToCodex: vi.fn(),
  gatewayStatus: vi.fn(() => Promise.resolve({ mode: "ccSwitch", routeQueue: [] as { stationId: string; keyId: string }[] })),
  setRoutes: vi.fn(),
  groups: vi.fn(),
  isTauri: vi.fn(() => false),
  reauthenticate: vi.fn(),
  refresh: vi.fn(),
  testModels: vi.fn(),
}));

vi.mock("../../../lib/platform", () => ({ isTauri }));
vi.mock("../../stations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stations")>();
  return { ...actual, stationApi: { ...actual.stationApi, reauthenticate, refresh } };
});
vi.mock("../../gateway/api", () => ({ gatewayApi: { status: gatewayStatus, setRoutes } }));
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { apiKeyApi: { ...actual.apiKeyApi, applyToCodex, groups, testModels } };
});

const row: KeyRow = {
  stationId: "station-1",
  stationName: "测试站点",
  stationUrl: "https://example.test",
  stationBalance: 12.345,
  groups: [{ name: "default", multiplier: 0.75 }],
  models: ["gpt-test"],
  key: {
    id: "key-1",
    name: "测试密钥",
    maskedKey: "sk-...test",
    status: "active",
    unlimitedQuota: true,
  },
};
const claudeRow: KeyRow = { ...row, key: { ...row.key, id: "key-2", name: "Claude 密钥" }, models: ["claude-sonnet-4-5"] };

describe("ApiKeysPage selection and testing", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    isTauri.mockReturnValue(false);
    gatewayStatus.mockResolvedValue({ mode: "ccSwitch", routeQueue: [] });
  });

  it("writes the selected key directly to the local Codex config", async () => {
    isTauri.mockReturnValue(true);
    applyToCodex.mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <ConfirmationProvider>
          <ApiKeysPage
            rows={[row]}
            stations={[]}
            onRefresh={vi.fn().mockResolvedValue(undefined)}
            onUpdated={vi.fn().mockResolvedValue(undefined)}
          />
        </ConfirmationProvider>
      </ToastProvider>,
    );

    expect(screen.queryByRole("button", { name: "导入" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Claude" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "启用" }));

    await waitFor(() => expect(applyToCodex).toHaveBeenCalledWith("station-1", "key-1"));
    expect(setRoutes).not.toHaveBeenCalled();
  });

  it("automatically logs in before creating a key for a disconnected station", async () => {
    isTauri.mockReturnValue(true);
    reauthenticate.mockResolvedValueOnce(undefined);
    groups.mockResolvedValueOnce([]);

    render(
      <ToastProvider>
        <ConfirmationProvider>
          <ApiKeysPage
            rows={[]}
            stations={[{ id: "station-1", name: "测试站点", baseUrl: "https://example.test", kind: "sub2api", status: "error" }]}
            onRefresh={vi.fn().mockResolvedValue(undefined)}
            onUpdated={vi.fn().mockResolvedValue(undefined)}
          />
        </ConfirmationProvider>
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建密钥" }));

    await waitFor(() => expect(reauthenticate).toHaveBeenCalledWith("station-1", null));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("uses cached groups when the station credential is missing", async () => {
    isTauri.mockReturnValue(true);
    reauthenticate.mockRejectedValueOnce(new Error("未找到该站点的安全凭据"));
    groups.mockResolvedValueOnce([{ name: "cached" }]);

    render(
      <ToastProvider>
        <ConfirmationProvider>
          <ApiKeysPage
            rows={[]}
            stations={[{ id: "station-1", name: "站点", baseUrl: "https://example.test", kind: "sub2api", status: "error" }]}
            onRefresh={vi.fn().mockResolvedValue(undefined)}
            onUpdated={vi.fn().mockResolvedValue(undefined)}
          />
        </ConfirmationProvider>
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "新建密钥" }));

    await waitFor(() => expect(groups).toHaveBeenCalledWith("station-1"));
    expect(screen.queryByText("未找到该站点的安全凭据")).not.toBeInTheDocument();
  });

  it("shows one-click testing after selecting a key and reports success in demo mode", async () => {
    isTauri.mockReturnValue(false);
    render(
      <ToastProvider>
        <ConfirmationProvider>
          <ApiKeysPage
            rows={[row]}
            stations={[]}
            onRefresh={vi.fn().mockResolvedValue(undefined)}
            onUpdated={vi.fn().mockResolvedValue(undefined)}
          />
        </ConfirmationProvider>
      </ToastProvider>,
    );

    expect(screen.queryByRole("columnheader", { name: "模型类型" })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "倍率" })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "余额" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "请选择分组: default 0.750x" })).toBeInTheDocument();
    expect(screen.getAllByText("0.750x").length).toBeGreaterThan(0);
    expect(screen.getAllByText("12.35 元").length).toBeGreaterThan(0);
    expect(screen.getAllByText("ChatGPT").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "一键测试" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("checkbox", { name: "选择 API 密钥 测试密钥" })[0]);
    expect(screen.getByRole("button", { name: "一键测试" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "一键测试" }));

    await waitFor(() => expect(screen.getAllByText("测试正常").length).toBeGreaterThan(0));
  });

  it("tests a single key from its row action", async () => {
    isTauri.mockReturnValue(true);
    testModels.mockResolvedValue([{ model: "gpt-test", available: true, response: "hi", elapsedMs: 12 }]);
    render(
      <ToastProvider>
        <ConfirmationProvider>
          <ApiKeysPage
            rows={[row]}
            stations={[]}
            onRefresh={vi.fn().mockResolvedValue(undefined)}
            onUpdated={vi.fn().mockResolvedValue(undefined)}
          />
        </ConfirmationProvider>
      </ToastProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "测试" })[0]);

    await waitFor(() => expect(testModels).toHaveBeenCalledWith("station-1", "key-1", ["gpt-test"], "chat"));
    expect(screen.getAllByText("测试正常").length).toBeGreaterThan(0);
  });

  it("filters keys by model type", () => {
    render(
      <ToastProvider>
        <ConfirmationProvider>
          <ApiKeysPage
            rows={[row, claudeRow]}
            stations={[]}
            onRefresh={vi.fn().mockResolvedValue(undefined)}
            onUpdated={vi.fn().mockResolvedValue(undefined)}
          />
        </ConfirmationProvider>
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "模型类型筛选" }));
    fireEvent.click(screen.getByRole("option", { name: "Claude" }));

    expect(screen.queryByText("测试密钥")).not.toBeInTheDocument();
    expect(screen.getAllByText("Claude").length).toBeGreaterThan(0);
  });

  it("sorts the selectable key columns in both directions", () => {
    const betaRow: KeyRow = { ...row, key: { ...row.key, id: "key-beta", name: "Beta", createdAt: 300, currentConcurrency: 1 } };
    const alphaRow: KeyRow = { ...row, key: { ...row.key, id: "key-alpha", name: "Alpha", createdAt: 200, currentConcurrency: 2 } };
    render(
      <ToastProvider>
        <ConfirmationProvider>
          <ApiKeysPage
            rows={[betaRow, alphaRow]}
            stations={[]}
            onRefresh={vi.fn().mockResolvedValue(undefined)}
            onUpdated={vi.fn().mockResolvedValue(undefined)}
          />
        </ConfirmationProvider>
      </ToastProvider>,
    );

    for (const label of ["名称", "当前并发", "过期时间", "状态", "创建时间"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    const table = screen.getByRole("table");
    const names = () => within(table).getAllByRole("row").slice(1).map((tableRow) => tableRow.querySelector('[data-key-column="name"]')?.textContent?.trim());

    expect(names()).toEqual(["Beta", "Alpha"]);
    fireEvent.click(screen.getByRole("button", { name: "名称" }));
    expect(names()).toEqual(["Alpha", "Beta"]);
    fireEvent.click(screen.getByRole("button", { name: "名称" }));
    expect(names()).toEqual(["Beta", "Alpha"]);
  });

  it("appends a key to the local route queue", async () => {
    isTauri.mockReturnValue(true);
    gatewayStatus.mockResolvedValue({ mode: "localGateway", routeQueue: [{ stationId: "station-2", keyId: "key-2" }] });
    setRoutes.mockResolvedValue({});
    render(
      <ToastProvider>
        <ConfirmationProvider>
          <ApiKeysPage
            rows={[row]}
            stations={[]}
            onRefresh={vi.fn().mockResolvedValue(undefined)}
            onUpdated={vi.fn().mockResolvedValue(undefined)}
          />
        </ConfirmationProvider>
      </ToastProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "加入路由" })[0]);

    await waitFor(() => expect(setRoutes).toHaveBeenCalledWith([
      { stationId: "station-2", keyId: "key-2" },
      { stationId: "station-1", keyId: "key-1" },
    ]));
  });

  it("opens the create dialog for a tray create request", () => {
    render(
      <ToastProvider>
        <ConfirmationProvider>
          <ApiKeysPage
            rows={[]}
            stations={[{ id: "station-1", name: "测试站点", baseUrl: "https://example.test", kind: "sub2api", status: "online" }]}
            openCreateRequest={1}
            onRefresh={vi.fn().mockResolvedValue(undefined)}
            onUpdated={vi.fn().mockResolvedValue(undefined)}
          />
        </ConfirmationProvider>
      </ToastProvider>,
    );

    expect(screen.getByRole("dialog", { name: "创建 API 密钥" })).toBeInTheDocument();
  });
});
