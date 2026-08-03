import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmationProvider, ToastProvider } from "../../components/ui";
import { useRemoteBulkActions, useRemoteServerActions } from "./hooks";
import type { RemoteServer } from "./types";

const { cancelOperation, updateRelay, verifyCodexSession } = vi.hoisted(() => ({ cancelOperation: vi.fn(), updateRelay: vi.fn(), verifyCodexSession: vi.fn() }));

vi.mock("../../lib/platform", () => ({ isTauri: () => true }));
vi.mock("./api", () => ({ remoteApi: { cancelOperation, updateRelay, verifyCodexSession } }));

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

function RemoteActionProbe() {
  const { cancelServerOperation, testResult } = useRemoteServerActions({
    keyRows: [],
    onChanged: vi.fn(),
    onCredentialsRequired: vi.fn(),
  });
  return <><button type="button" onClick={() => void cancelServerOperation(server)}>取消操作</button>{testResult && <p>{testResult.message}</p>}</>;
}

function RemoteBulkActionProbe({ onResult }: { onResult: (result: { success: boolean; message: string }) => void }) {
  const { toggleServer, verifySelectedCodexSessions } = useRemoteBulkActions({
    servers: [server],
    keyRows: [],
    onChanged: vi.fn(),
    onSavingChange: vi.fn(),
    onTestingChange: vi.fn(),
    onVerifyingSessionChange: vi.fn(),
    onResult,
    onKeyAssigned: vi.fn(),
  });
  return <><button type="button" onClick={() => toggleServer(server.id)}>选择</button><button type="button" onClick={() => void verifySelectedCodexSessions()}>测试 CLI 会话</button></>;
}

function RemoteRelaySaveProbe({ field }: { field: "url" | "key" }) {
  const { relayDraft, setEditingRelay, updateRelayDraft, saveRelay } = useRemoteServerActions({
    keyRows: [],
    onChanged: vi.fn().mockResolvedValue(undefined),
    onCredentialsRequired: vi.fn(),
  });
  const draft = relayDraft(server);
  return <>
    <button type="button" onClick={() => setEditingRelay({ serverId: server.id, field })}>编辑</button>
    <input aria-label={field === "key" ? "API 密钥" : "中转站网址"} value={field === "key" ? draft.key : draft.url} onChange={(event) => updateRelayDraft(server, field === "key" ? { key: event.target.value } : { url: event.target.value })} />
    <button type="button" onClick={() => void saveRelay(server)}>保存</button>
  </>;
}

describe("useRemoteServerActions", () => {
  it("reports that a remote operation is being cancelled", async () => {
    cancelOperation.mockResolvedValueOnce(undefined);

    render(<ToastProvider><ConfirmationProvider><RemoteActionProbe /></ConfirmationProvider></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "取消操作" }));

    await waitFor(() => expect(cancelOperation).toHaveBeenCalledWith("server-1"));
    expect(screen.getByText("测试服务器 的操作正在取消，当前 SSH 请求最多还会等待 20 秒。")).toBeInTheDocument();
  });

  it("verifies Codex CLI sessions for selected servers", async () => {
    const onResult = vi.fn();
    verifyCodexSession.mockResolvedValueOnce({ success: true });

    render(<ToastProvider><ConfirmationProvider><RemoteBulkActionProbe onResult={onResult} /></ConfirmationProvider></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "选择" }));
    fireEvent.click(screen.getByRole("button", { name: "测试 CLI 会话" }));

    await waitFor(() => expect(verifyCodexSession).toHaveBeenCalledWith("server-1"));
    expect(onResult).toHaveBeenCalledWith({ success: true, message: "1 台服务器 Codex CLI 会话验证成功" });
  });

  it("shows a success toast after saving the relay API key", async () => {
    updateRelay.mockResolvedValueOnce(server);

    render(<ToastProvider><ConfirmationProvider><RemoteRelaySaveProbe field="key" /></ConfirmationProvider></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    fireEvent.change(screen.getByRole("textbox", { name: "API 密钥" }), { target: { value: "sk-new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(updateRelay).toHaveBeenCalledWith("server-1", "https://relay.example.com", "sk-new-secret"));
    expect(await screen.findByText("服务器“测试服务器”的 API 密钥已保存。")).toBeInTheDocument();
  });
});
