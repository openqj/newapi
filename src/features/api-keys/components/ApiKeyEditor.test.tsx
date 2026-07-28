import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiKeyEditor } from "./ApiKeyEditor";

const { save } = vi.hoisted(() => ({ save: vi.fn() }));

vi.mock("../api", () => ({
  apiKeyApi: { groups: vi.fn(), save },
}));

describe("ApiKeyEditor", () => {
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
});
