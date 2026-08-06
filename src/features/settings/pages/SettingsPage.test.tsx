import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../components/ui";
import { SettingsPage } from "./SettingsPage";

afterEach(cleanup);

describe("SettingsPage policies", () => {
  it("shows the privacy, terms, and cookie documents", () => {
    render(
      <SettingsPage
        demoProfiles={[]}
        keyRows={[]}
        backgroundRefreshMinutes={30}
        onBackgroundRefreshMinutesChange={vi.fn()}
        activeTab="policies"
      />,
    );

    expect(screen.getByRole("button", { name: "隐私与政策" })).toHaveAttribute("aria-current", "page");
    const settingsNav = screen.getByRole("navigation", { name: "设置导航" });
    expect(Array.from(settingsNav.querySelectorAll("button"), (button) => button.textContent)).toEqual([
      "常规",
      "本地路由",
      "隐私与政策",
      "告警历史与趋势",
      "常用登录",
      "配置档案",
      "使用统计",
    ]);
    expect(screen.queryByRole("button", { name: "Gateway" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "通知与告警" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Codex" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "更新" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "隐私政策" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "服务条款" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Cookie / 数据说明" })).toBeInTheDocument();
    expect(screen.getByText("RelayHub 桌面客户端不使用用于广告画像的浏览器 Cookie，也不接入基于 Cookie 的第三方广告追踪或页面行为分析。")).toBeInTheDocument();
  });

  it("places auto registration under common login", () => {
    render(
      <ToastProvider>
        <SettingsPage
          demoProfiles={[]}
          keyRows={[]}
          backgroundRefreshMinutes={30}
          onBackgroundRefreshMinutesChange={vi.fn()}
          activeTab="profiles"
        />
      </ToastProvider>,
    );

    expect(screen.getByRole("button", { name: "常用登录" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { name: "自动注册" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "自动注册" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Gmail" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Microsoft Outlook" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "QQ 邮箱" })).toBeInTheDocument();
  });
});
