import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmationProvider, ToastProvider } from "../../../components/ui";
import { ApiKeysPage } from "./ApiKeysPage";
import type { KeyRow } from "../types";

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
  it("shows one-click testing after selecting a key and reports success in demo mode", async () => {
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
