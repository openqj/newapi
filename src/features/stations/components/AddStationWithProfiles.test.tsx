import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../../../components/ui";
import { AddStationWithProfiles, normalizeStationBaseUrl } from "./AddStationWithProfiles";

describe("normalizeStationBaseUrl", () => {
  it("keeps only the HTTPS origin for login-page URLs", () => {
    expect(normalizeStationBaseUrl("https://openkun.xyz/sign-in?redirect=%2Fwallet")).toBe("https://openkun.xyz/");
    expect(normalizeStationBaseUrl("https://chat.178266.xyz/login")).toBe("https://chat.178266.xyz/");
  });

  it("adds HTTPS for a bare host", () => {
    expect(normalizeStationBaseUrl("openkun.xyz/login")).toBe("https://openkun.xyz/");
  });

  it("shows the saved password masked by default and supports revealing it", async () => {
    render(
      <ToastProvider>
        <AddStationWithProfiles
          initial={{ id: "station-1", name: "测试站点", baseUrl: "https://example.test/", kind: "sub2api", username: "user" }}
          demoProfiles={[]}
          onClose={vi.fn()}
          onManageProfiles={vi.fn()}
          onAdded={vi.fn().mockResolvedValue(undefined)}
        />
      </ToastProvider>,
    );

    const password = screen.getByLabelText("密码");
    await waitFor(() => expect(password).toHaveValue("demo-password"));
    expect(password).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "显示密码" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "隐藏密码" })).toBeInTheDocument();
  });
});
