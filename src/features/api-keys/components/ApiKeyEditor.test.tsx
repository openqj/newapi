import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiKeyEditor } from "./ApiKeyEditor";
import type { KeyRow } from "../types";

const { groups, isTauri, save } = vi.hoisted(() => ({ groups: vi.fn(), isTauri: vi.fn(() => false), save: vi.fn() }));

vi.mock("../api", () => ({
  apiKeyApi: { groups, save },
}));

vi.mock("../../../lib/platform", () => ({ isTauri }));

describe("ApiKeyEditor", () => {
  afterEach(cleanup);

  it("fills the key name from a preset", () => {
    render(
      <ApiKeyEditor
        rows={[]}
        stations={[{ id: "station-1", name: "站点", baseUrl: "https://example.test", kind: "sub2api", status: "online" }]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onError={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Codex" }));

    expect(screen.getByLabelText("密钥名称")).toHaveValue("Codex");
  });

  it("keeps the editor open and reports a failed save", async () => {
    save.mockRejectedValueOnce(new Error("request failed"));
    const onError = vi.fn();
    const onSaved = vi.fn();

    render(
      <ApiKeyEditor
        rows={[]}
        stations={[{ id: "station-1", name: "站点", baseUrl: "https://example.test", kind: "sub2api", status: "online" }]}
        onClose={vi.fn()}
        onSaved={onSaved}
        onError={onError}
      />,
    );

    fireEvent.change(screen.getByLabelText("密钥名称"), { target: { value: "用于测试" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "创建 API 密钥" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建" })).not.toBeDisabled();
  });

  it("syncs the station before loading remote groups", async () => {
    isTauri.mockReturnValue(true);
    groups.mockResolvedValueOnce([{ name: "vip", multiplier: 0.5 }]);
    const onRefreshStation = vi.fn().mockResolvedValue(undefined);

    render(
      <ApiKeyEditor
        rows={[]}
        stations={[{ id: "station-1", name: "station", baseUrl: "https://example.test", kind: "sub2api", status: "online" }]}
        onRefreshStation={onRefreshStation}
        onClose={vi.fn()}
        onSaved={vi.fn()}
        onError={vi.fn()}
      />,
    );

    await waitFor(() => expect(onRefreshStation).toHaveBeenCalledWith("station-1"));
    await waitFor(() => expect(groups).toHaveBeenCalledWith("station-1"));
    fireEvent.click(screen.getByRole("button", { name: "请选择分组" }));
    expect(screen.getByRole("option", { name: "vip 0.500x" })).toBeInTheDocument();
    expect(onRefreshStation.mock.invocationCallOrder[0]).toBeLessThan(groups.mock.invocationCallOrder[0]);
  });

  it("does not refresh the same station again when rows update", async () => {
    isTauri.mockReturnValue(true);
    groups.mockResolvedValue([]);
    const onRefreshStation = vi.fn().mockResolvedValue(undefined);
    const props = {
      rows: [],
      stations: [{ id: "station-1", name: "station", baseUrl: "https://example.test", kind: "sub2api", status: "online" }],
      onRefreshStation,
      onClose: vi.fn(),
      onSaved: vi.fn(),
      onError: vi.fn(),
    };
    const { rerender } = render(<ApiKeyEditor {...props} />);

    await waitFor(() => expect(onRefreshStation).toHaveBeenCalledTimes(1));
    const updatedRows: KeyRow[] = [{
      stationId: "station-1",
      stationName: "station",
      stationUrl: "https://example.test",
      groups: [],
      models: [],
      key: { id: "key-1", name: "key", maskedKey: "sk-***", status: "active" },
    }];
    rerender(<ApiKeyEditor {...props} rows={updatedRows} />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onRefreshStation).toHaveBeenCalledTimes(1);
  });
});
