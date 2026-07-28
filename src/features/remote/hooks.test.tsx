import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmationProvider, ToastProvider } from "../../components/ui";
import { useRemoteServerActions } from "./hooks";
import type { RemoteServer } from "./types";

const { cancelOperation } = vi.hoisted(() => ({ cancelOperation: vi.fn() }));

vi.mock("../../lib/platform", () => ({ isTauri: () => true }));
vi.mock("./api", () => ({ remoteApi: { cancelOperation } }));

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

describe("useRemoteServerActions", () => {
  it("reports that a remote operation is being cancelled", async () => {
    cancelOperation.mockResolvedValueOnce(undefined);

    render(<ToastProvider><ConfirmationProvider><RemoteActionProbe /></ConfirmationProvider></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "取消操作" }));

    await waitFor(() => expect(cancelOperation).toHaveBeenCalledWith("server-1"));
    expect(screen.getByText("测试服务器 的操作正在取消，当前 SSH 请求最多还会等待 20 秒。")).toBeInTheDocument();
  });
});
