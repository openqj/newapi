import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteBulkActions } from "./RemoteBulkActions";

describe("RemoteBulkActions", () => {
  afterEach(() => cleanup());

  it("keeps bulk action buttons visible and disabled without a selection", () => {
    render(<RemoteBulkActions count={0} keyRows={[]} action={null} onSwitch={vi.fn()} onSwitchLocal={vi.fn()} onTest={vi.fn()} onVerifySession={vi.fn()} onDelete={vi.fn()} />);

    expect(screen.getByRole("button", { name: "SSH测试" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "测试 Codex CLI 会话" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();
  });

  it("routes the shared dropdown to a local relay switch", () => {
    const onSwitchLocal = vi.fn();
    render(<RemoteBulkActions count={1} keyRows={[]} action={null} onSwitch={vi.fn()} onSwitchLocal={onSwitchLocal} onTest={vi.fn()} onVerifySession={vi.fn()} onDelete={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "一键切换中转站密钥" }));
    fireEvent.click(screen.getByRole("option", { name: "本地中转站 / API 密钥" }));

    expect(onSwitchLocal).toHaveBeenCalledTimes(1);
  });
});
