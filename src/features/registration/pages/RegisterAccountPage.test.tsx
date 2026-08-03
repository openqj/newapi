import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RegisterAccountPage } from "./RegisterAccountPage";

const mocks = vi.hoisted(() => ({
  mailStatus: vi.fn(),
  pollCode: vi.fn(),
  probe: vi.fn(),
  sendVerificationCode: vi.fn(),
  registerAccount: vi.fn(),
  saveProfile: vi.fn(),
}));

vi.mock("../../../lib/platform", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ close: vi.fn() }) }));
vi.mock("../api", () => ({
  registrationApi: {
    mailStatus: mocks.mailStatus,
    pollCode: mocks.pollCode,
  },
}));
vi.mock("../../profiles", () => ({ profileApi: { save: mocks.saveProfile } }));
vi.mock("../../stations/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../stations/api")>();
  return {
    ...actual,
    stationApi: {
      ...actual.stationApi,
      probe: mocks.probe,
      sendVerificationCode: mocks.sendVerificationCode,
      registerAccount: mocks.registerAccount,
    },
  };
});

describe("RegisterAccountPage", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the form visible and accepts a manual code after automatic verification fails", async () => {
    mocks.probe.mockResolvedValue({ name: "测试站点", kind: "sub2api", requiresEmailVerification: true });
    mocks.mailStatus.mockImplementation(async (provider: string) => ({
      provider,
      connected: provider === "qq",
      email: provider === "qq" ? "mailbox@example.test" : null,
    }));
    mocks.sendVerificationCode.mockResolvedValue("验证码已发送");
    mocks.pollCode.mockResolvedValue("wrong-code");
    mocks.registerAccount
      .mockRejectedValueOnce(new Error("invalid or expired verification code"))
      .mockResolvedValueOnce({ station: { name: "测试站点", kind: "sub2api" } });
    mocks.saveProfile.mockResolvedValue(undefined);

    render(<RegisterAccountPage />);
    fireEvent.change(screen.getByRole("textbox", { name: "中转站网址" }), { target: { value: "https://relay.example.com" } });

    fireEvent.click(screen.getByRole("button", { name: "注册" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "继续注册" })).toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "用户名" })).not.toHaveValue("");
    expect(screen.getByRole("textbox", { name: "邮箱" })).toHaveValue("mailbox@example.test");
    expect(screen.getByLabelText("密码")).not.toHaveValue("");
    expect(screen.getByLabelText("邮箱验证码")).toHaveValue("wrong-code");
    expect(screen.getByRole("log")).toHaveTextContent("验证码校验失败");
    expect(screen.getByRole("log")).toHaveTextContent("已自动识别并填充验证码输入框");

    fireEvent.change(screen.getByLabelText("邮箱验证码"), { target: { value: "right-code" } });
    fireEvent.click(screen.getByRole("button", { name: "继续注册" }));

    await waitFor(() => expect(screen.getByText("注册并导入成功：测试站点")).toBeInTheDocument());
    expect(mocks.registerAccount).toHaveBeenLastCalledWith(expect.objectContaining({ verificationCode: "right-code" }));
    expect(mocks.saveProfile).toHaveBeenCalledWith(expect.objectContaining({ username: "mailbox@example.test" }));
    expect(screen.getByRole("log")).toHaveTextContent("正在使用手工填写的验证码继续注册");
    expect(screen.getByRole("log")).toHaveTextContent("已导入站点账号和常用登录");
  });
});
