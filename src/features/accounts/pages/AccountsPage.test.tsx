import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmationProvider, ToastProvider } from "../../../components/ui";
import { AccountsPage } from "./AccountsPage";
import type { AccountRow } from "../types";

const row: AccountRow = {
  stationId: "station-1",
  stationName: "测试站点",
  stationUrl: "https://example.test",
  kind: "sub2api",
  syncStatus: "online",
  account: {
    id: "account-1",
    username: "user",
    displayName: "测试账号",
    role: "admin",
    status: "active",
  },
  usage: {},
};

afterEach(cleanup);

describe("AccountsPage selection", () => {
  it("selects the visible account from the row checkbox and header checkbox", () => {
    render(
      <ToastProvider>
        <ConfirmationProvider>
          <AccountsPage
            rows={[row]}
            stations={[]}
            onRefresh={vi.fn().mockResolvedValue(undefined)}
            onUpdated={vi.fn().mockResolvedValue(undefined)}
            onRefreshStation={vi.fn().mockResolvedValue(undefined)}
            onOpenStation={vi.fn()}
            onAdd={vi.fn()}
            onEdit={vi.fn()}
          />
        </ConfirmationProvider>
      </ToastProvider>,
    );

    expect(screen.getByRole("button", { name: "批量删除" })).toBeDisabled();
    fireEvent.click(screen.getAllByRole("checkbox", { name: "选择站点账号 测试站点" })[0]);
    expect(screen.getByRole("checkbox", { name: "全选站点账号" })).toBeChecked();
    expect(screen.getByRole("button", { name: "批量删除" })).toBeEnabled();
  });

  it("refreshes only the selected station login status", async () => {
    const onRefreshStation = vi.fn().mockResolvedValue(undefined);
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    render(
      <ToastProvider>
        <ConfirmationProvider>
          <AccountsPage
            rows={[row]}
            stations={[]}
            onRefresh={onRefresh}
            onUpdated={vi.fn().mockResolvedValue(undefined)}
            onRefreshStation={onRefreshStation}
            onOpenStation={vi.fn()}
            onAdd={vi.fn()}
            onEdit={vi.fn()}
          />
        </ConfirmationProvider>
      </ToastProvider>,
    );

    fireEvent.click(screen.getAllByRole("button", { name: "刷新 测试站点 登录状态" })[0]);

    await waitFor(() => expect(onRefreshStation).toHaveBeenCalledWith("station-1"));
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
