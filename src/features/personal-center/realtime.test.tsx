import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notifications: vi.fn(),
  markNotification: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/platform", () => ({ isTauri: () => true }));
vi.mock("./api", () => ({
  personalCenterApi: {
    notifications: mocks.notifications,
    markNotification: mocks.markNotification,
  },
}));

import { usePersonalCenterRealtime } from "./realtime";

describe("usePersonalCenterRealtime", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.notifications.mockResolvedValue([{
      id: "notice-1",
      audience: "all",
      kind: "info",
      title: "Maintenance",
      body: "Tonight",
      destination: "personalCenter",
      publishedAt: 10,
      deliveredAt: 10,
    }]);
  });

  afterEach(() => vi.useRealTimers());

  it("polls public notifications without creating a realtime session", async () => {
    const { result, unmount } = renderHook(() => usePersonalCenterRealtime(vi.fn(), true));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]).toMatchObject({ title: "Maintenance", kind: "announcement", cloudNotificationId: "notice-1" });
    expect(result.current.access).toEqual({ authenticated: false, isAdmin: false });
    expect(mocks.markNotification).not.toHaveBeenCalled();
    unmount();
  });

  it("does not poll while notifications are disabled", async () => {
    renderHook(() => usePersonalCenterRealtime(vi.fn(), false));
    await act(async () => { await Promise.resolve(); });
    expect(mocks.notifications).not.toHaveBeenCalled();
  });

  it("polls on its interval only and ignores focus restoration", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => usePersonalCenterRealtime(vi.fn(), true));
    await act(async () => { await Promise.resolve(); });
    expect(mocks.notifications).toHaveBeenCalledTimes(1);

    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(mocks.notifications).toHaveBeenCalledTimes(1);

    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(mocks.notifications).toHaveBeenCalledTimes(2);
    unmount();
  });
});
