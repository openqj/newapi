import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmationProvider, ToastProvider } from "../../../components/ui";
import { ApiKeysPage } from "./ApiKeysPage";
import type { KeyRow } from "../types";

const { groups, isTauri, reauthenticate, refresh } = vi.hoisted(() => ({
  groups: vi.fn(),
  isTauri: vi.fn(() => false),
  reauthenticate: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("../../../lib/platform", () => ({ isTauri }));
vi.mock("../../stations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stations")>();
  return { ...actual, stationApi: { ...actual.stationApi, reauthenticate, refresh } };
});
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { apiKeyApi: { ...actual.apiKeyApi, groups } };
});

const row: KeyRow = {
  stationId: "station-1",
  stationName: "测试站点",
  stationUrl: "https://example.test",
  groups: [{ name: "default" }],
  models: ["gpt-test"],
  key: {
    id: "key-1",
    name: "测试密钥",
    maskedKey: "sk-...test",
    status: "active",
    unlimitedQuota: true,
  },
};

describe("ApiKeysPage selection and testing", () => {
  afterEach(cleanup);

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

    expect(screen.getByRole("button", { name: "一键测试" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("checkbox", { name: "选择 API 密钥 测试密钥" })[0]);
    expect(screen.getByRole("button", { name: "一键测试" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "一键测试" }));

    await waitFor(() => expect(screen.getAllByText("测试正常").length).toBeGreaterThan(0));
  });
});
