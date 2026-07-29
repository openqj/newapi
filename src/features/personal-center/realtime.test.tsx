import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, () => void>();
  let statusCallback: ((status: string) => void) | undefined;
  const channel = {
    on: vi.fn((_event: string, filter: { table: string }, callback: () => void) => {
      handlers.set(filter.table, callback);
      return channel;
    }),
    subscribe: vi.fn((callback: (status: string) => void) => {
      statusCallback = callback;
      queueMicrotask(() => callback("SUBSCRIBED"));
      return channel;
    }),
  };
  const client = {
    realtime: { setAuth: vi.fn() },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  };
  return {
    handlers,
    channel,
    client,
    createClient: vi.fn(() => client),
    notifications: vi.fn(),
    memberships: vi.fn(),
    markNotification: vi.fn().mockResolvedValue(undefined),
    realtimeSession: vi.fn(),
    emitStatus: (status: string) => statusCallback?.(status),
  };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("../../lib/platform", () => ({ isTauri: () => true }));
vi.mock("./api", () => ({
  PERSONAL_CENTER_AUTH_CHANGED_EVENT: "relayhub:personal-center-auth-changed",
  PERSONAL_CENTER_MEMBERSHIPS_CHANGED_EVENT: "relayhub:personal-center-memberships-changed",
  personalCenterApi: {
    notifications: mocks.notifications,
    memberships: mocks.memberships,
    markNotification: mocks.markNotification,
    realtimeSession: mocks.realtimeSession,
  },
}));

import { usePersonalCenterRealtime } from "./realtime";

describe("usePersonalCenterRealtime", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.handlers.clear();
    mocks.realtimeSession.mockResolvedValue({
      url: "https://example.supabase.co",
      anonKey: "publishable",
      accessToken: "access-token",
      userId: "user-1",
      isAdmin: false,
    });
    mocks.notifications.mockResolvedValue([{
      id: "notice-1",
      audience: "all",
      kind: "info",
      title: "Maintenance",
      body: "Tonight",
      destination: "personalCenter",
      publishedAt: 10,
    }]);
    mocks.memberships.mockResolvedValue([{
      stationId: "station-1",
      accountId: "account-1",
      userEmail: "user@example.com",
      plan: "pro",
      accessLevel: "member",
      enabled: true,
      privileges: ["usage"],
      updatedAt: 10,
    }]);
  });

  it("loads a recovery snapshot after subscribing and exposes cloud messages and permissions", async () => {
    const onPreferencesChanged = vi.fn().mockResolvedValue(undefined);
    const { result, unmount } = renderHook(() => usePersonalCenterRealtime(onPreferencesChanged));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]).toMatchObject({ title: "Maintenance", kind: "announcement", cloudNotificationId: "notice-1" });
    expect(result.current.memberships[0].privileges).toEqual(["usage"]);
    expect(result.current.access).toEqual({ authenticated: true, isAdmin: false });
    expect(mocks.markNotification).toHaveBeenCalledWith("notice-1", false);
    expect(onPreferencesChanged).toHaveBeenCalled();
    unmount();
  });

  it("refetches after realtime changes and when the window regains focus", async () => {
    const onPreferencesChanged = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => usePersonalCenterRealtime(onPreferencesChanged));
    await waitFor(() => expect(mocks.memberships).toHaveBeenCalled());
    const calls = mocks.memberships.mock.calls.length;

    act(() => mocks.handlers.get("personal_center_memberships")?.());
    await waitFor(() => expect(mocks.memberships.mock.calls.length).toBeGreaterThan(calls));
    const afterRealtime = mocks.memberships.mock.calls.length;

    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(mocks.memberships.mock.calls.length).toBeGreaterThan(afterRealtime));

    const afterFocus = mocks.memberships.mock.calls.length;
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(mocks.memberships.mock.calls.length).toBeGreaterThan(afterFocus));
    unmount();
  });

  it("reconnects and recovers a snapshot after a channel error", async () => {
    const nativeSetTimeout = window.setTimeout.bind(window);
    let retry: (() => void) | undefined;
    const timer = vi.spyOn(window, "setTimeout").mockImplementation((handler, timeout, ...args) => {
      if (timeout === 10_000 && typeof handler === "function") {
        retry = () => handler(...args);
        return 10_000;
      }
      return nativeSetTimeout(handler, timeout, ...args);
    });
    const onPreferencesChanged = vi.fn().mockResolvedValue(undefined);
    const { unmount } = renderHook(() => usePersonalCenterRealtime(onPreferencesChanged));
    await waitFor(() => expect(mocks.realtimeSession).toHaveBeenCalledTimes(1));

    act(() => mocks.emitStatus("CHANNEL_ERROR"));
    expect(retry).toBeTypeOf("function");
    await act(async () => {
      retry?.();
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(mocks.realtimeSession.mock.calls.length).toBeGreaterThan(1));
    unmount();
    timer.mockRestore();
  });
});
