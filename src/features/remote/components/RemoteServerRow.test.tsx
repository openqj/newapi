import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteServerRow } from "./RemoteServerRow";
import type { RemoteServer } from "../types";

const server: RemoteServer = {
  id: "server-1",
  name: "测试服务器",
  host: "example.test",
  port: 22,
  username: "root",
  authType: "password",
  relayUrl: "https://relay.example.com",
  relayKeyMasked: "sk-****",
  updatedAt: 0,
};

function renderRow(overrides: Partial<ComponentProps<typeof RemoteServerRow>> = {}) {
  const onSaveRelay = vi.fn();
  const onSwitchKey = vi.fn();
  const onSwitchLocal = vi.fn();
  const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
  const props: ComponentProps<typeof RemoteServerRow> = {
    server,
    index: 0,
    keyRows: [],
    selected: false,
    selectedKeyValue: "",
    selectedKeyLabel: "选择中转站密钥",
    saving: false,
    savingRelay: false,
    testing: false,
    verifyingSession: false,
    loadingLogs: false,
    codexAction: false,
    deleting: false,
    editingRelay: null,
    relayDraft: { url: server.relayUrl ?? "", key: "" },
    onToggleSelected: vi.fn(),
    onSwitchKey,
    onSwitchLocal,
    onOpenEditor: vi.fn(),
    onTest: vi.fn(),
    onShowLogs: vi.fn(),
    onVerifySession: vi.fn(),
    onCancelOperation: vi.fn(),
    onDelete: vi.fn(),
    onManageCodex: vi.fn(),
    onStartRelayEdit: vi.fn(),
    onCancelRelayEdit: vi.fn(),
    onRelayDraftChange: vi.fn(),
    onSaveRelay,
    ...overrides,
  };

  render(<form onSubmit={onSubmit}><table><tbody><RemoteServerRow {...props} /></tbody></table></form>);
  return { onSaveRelay, onSubmit, onSwitchKey, onSwitchLocal };
}

describe("RemoteServerRow relay editing", () => {
  afterEach(() => {
    cleanup();
  });

  it("saves the relay URL without submitting an enclosing form", () => {
    const { onSaveRelay, onSubmit } = renderRow({ editingRelay: { serverId: server.id, field: "url" } });

    fireEvent.click(screen.getByRole("button", { name: "保存中转站地址" }));

    expect(onSaveRelay).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("allows replacing the relay API key", () => {
    const { onSaveRelay } = renderRow({ editingRelay: { serverId: server.id, field: "key" } });

    fireEvent.change(screen.getByPlaceholderText("已安全保存，输入新密钥以替换"), { target: { value: "sk-new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存 API 密钥" }));

    expect(onSaveRelay).toHaveBeenCalledTimes(1);
  });

  it("does not show a cancel action while verifying the Codex session", () => {
    renderRow({ verifyingSession: true });

    expect(document.querySelector("button.cancel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "验证" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除" })).toBeDisabled();
  });

  it("uses the shared dropdown for local relay selection", () => {
    const { onSwitchLocal } = renderRow();

    fireEvent.click(screen.getByRole("button", { name: "选择中转站密钥" }));
    fireEvent.click(screen.getByRole("option", { name: "本地中转站 / API 密钥" }));

    expect(onSwitchLocal).toHaveBeenCalledTimes(1);
  });
});
