import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RemoteBulkActions } from "./RemoteBulkActions";

describe("RemoteBulkActions", () => {
  it("keeps bulk action buttons visible and disabled without a selection", () => {
    render(<RemoteBulkActions count={0} keyRows={[]} action={null} onSwitch={vi.fn()} onSwitchLocal={vi.fn()} onTest={vi.fn()} onVerifySession={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByRole("button", { name: "SSH测试" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "测试 Codex CLI 会话" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();
  });
});
