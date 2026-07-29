import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmationProvider, ToastProvider } from "../../components/ui";
import { useRemoteBulkActions, useRemoteServerActions } from "./hooks";
import type { RemoteServer } from "./types";

const { cancelOperation, verifyCodexSession } = vi.hoisted(() => ({ cancelOperation: vi.fn(), verifyCodexSession: vi.fn() }));

vi.mock("../../lib/platform", () => ({ isTauri: () => true }));
vi.mock("./api", () => ({ remoteApi: { cancelOperation, verifyCodexSession } }));

const server: RemoteServer = {
  id: "server-1",
  name: "测试服务器",
  host: "example.test",
  port: 22,
  username: "root",
  authType: "password",
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
});
