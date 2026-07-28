import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../components/ui";
import { ApiDetectionPage } from "./ApiDetectionPage";

const { detectModelAuthenticity } = vi.hoisted(() => ({ detectModelAuthenticity: vi.fn() }));

vi.mock("../api", () => ({
  detectModelAuthenticity,
  diagnoseStation: vi.fn(),
  discoverSavedKeyModels: vi.fn(),
  testSavedKeyModels: vi.fn(),
}));

describe("ApiDetectionPage", () => {
  it("shows a user-facing toast when a detection request fails", async () => {
    detectModelAuthenticity.mockRejectedValueOnce(new Error("网络连接失败"));

    render(<ToastProvider><ApiDetectionPage keyRows={[]} /></ToastProvider>);

    fireEvent.change(screen.getByPlaceholderText("https://api.anthropic.com"), { target: { value: "https://example.test" } });
    fireEvent.change(screen.getByPlaceholderText("sk-..."), { target: { value: "sk-test" } });
    fireEvent.click(screen.getByRole("button", { name: "开始检测" }));

    await waitFor(() => expect(detectModelAuthenticity).toHaveBeenCalledOnce());
    expect(await screen.findByText("网络连接失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "开始检测" })).not.toBeDisabled();
  });
});
