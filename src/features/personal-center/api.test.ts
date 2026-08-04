import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeDesktop, isTauri } = vi.hoisted(() => ({ invokeDesktop: vi.fn(), isTauri: vi.fn() }));
vi.mock("../../lib/tauri", () => ({ invokeDesktop }));
vi.mock("../../lib/platform", () => ({ isTauri }));

import { defaultNotificationPreferences, personalCenterApi } from "./api";
import type { MembershipAccess } from "./types";

const membership: MembershipAccess = {
  stationId: "station-1", accountId: "account-1", userEmail: "user@example.com", plan: "pro", accessLevel: "admin", enabled: true,
  privileges: ["members"], updatedAt: 1,
};

describe("personalCenterApi", () => {
  beforeEach(() => {
    invokeDesktop.mockReset();
    isTauri.mockReturnValue(true);
    window.localStorage.clear();
  });

  it("uses the stable desktop command and argument contracts", async () => {
    invokeDesktop.mockResolvedValueOnce(defaultNotificationPreferences).mockResolvedValueOnce(defaultNotificationPreferences).mockResolvedValueOnce(defaultNotificationPreferences)
      .mockResolvedValueOnce([]).mockResolvedValueOnce(membership).mockResolvedValueOnce(undefined).mockResolvedValueOnce([])
      .mockResolvedValueOnce([]).mockResolvedValueOnce({ id: "notification-1" }).mockResolvedValueOnce([]).mockResolvedValueOnce({ id: "notification-1" }).mockResolvedValueOnce({ id: "notification-1" }).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ url: "https://example.supabase.co" }).mockResolvedValueOnce([]);

    await personalCenterApi.notificationPreferences();
    await personalCenterApi.refreshNotificationPreferences();
    await personalCenterApi.saveNotificationPreferences(defaultNotificationPreferences);
    await personalCenterApi.memberships();
    await personalCenterApi.saveMembership(membership);
    await personalCenterApi.deleteMembership("station-1", "account-1");
    await personalCenterApi.auditHistory(25);
    await personalCenterApi.notifications();
    await personalCenterApi.publishNotification({ audience: "all", kind: "info", title: "Notice", body: "Body", destination: "personalCenter" });
    await personalCenterApi.sentNotifications();
    await personalCenterApi.updateNotification("notification-1", { audience: "all", kind: "info", title: "Updated", body: "Body", destination: "personalCenter" });
    await personalCenterApi.revokeNotification("notification-1");
    await personalCenterApi.deleteNotification("notification-1");
    await personalCenterApi.markNotification("notification-1", true);
    await personalCenterApi.realtimeSession();
    await personalCenterApi.loginEvents(25);

    expect(invokeDesktop).toHaveBeenNthCalledWith(1, "get_personal_center_notification_preferences");
    expect(invokeDesktop).toHaveBeenNthCalledWith(2, "refresh_personal_center_notification_preferences");
    expect(invokeDesktop).toHaveBeenNthCalledWith(3, "save_personal_center_notification_preferences", { preferences: defaultNotificationPreferences });
    expect(invokeDesktop).toHaveBeenNthCalledWith(4, "list_personal_center_memberships");
    expect(invokeDesktop).toHaveBeenNthCalledWith(5, "save_personal_center_membership", { membership });
    expect(invokeDesktop).toHaveBeenNthCalledWith(6, "delete_personal_center_membership", { stationId: "station-1", accountId: "account-1" });
    expect(invokeDesktop).toHaveBeenNthCalledWith(7, "list_personal_center_audit_history", { limit: 25 });
    expect(invokeDesktop).toHaveBeenNthCalledWith(8, "list_personal_center_notifications");
    expect(invokeDesktop).toHaveBeenNthCalledWith(9, "publish_personal_center_notification", { request: { audience: "all", kind: "info", title: "Notice", body: "Body", destination: "personalCenter" } });
    expect(invokeDesktop).toHaveBeenNthCalledWith(10, "list_sent_personal_center_notifications");
    expect(invokeDesktop).toHaveBeenNthCalledWith(11, "update_personal_center_notification", { notificationId: "notification-1", request: { audience: "all", kind: "info", title: "Updated", body: "Body", destination: "personalCenter" } });
    expect(invokeDesktop).toHaveBeenNthCalledWith(12, "revoke_personal_center_notification", { notificationId: "notification-1" });
    expect(invokeDesktop).toHaveBeenNthCalledWith(13, "delete_personal_center_notification", { notificationId: "notification-1" });
    expect(invokeDesktop).toHaveBeenNthCalledWith(14, "mark_personal_center_notification", { notificationId: "notification-1", read: true });
    expect(invokeDesktop).toHaveBeenNthCalledWith(15, "get_personal_center_realtime_session");
    expect(invokeDesktop).toHaveBeenNthCalledWith(16, "list_personal_center_login_events", { limit: 25 });
  });

  it("persists browser-preview data without invoking Tauri", async () => {
    isTauri.mockReturnValue(false);
    const preferences = { ...defaultNotificationPreferences, offerEnabled: false };

    await personalCenterApi.saveNotificationPreferences(preferences);
    await personalCenterApi.saveMembership(membership);
    expect(await personalCenterApi.notificationPreferences()).toEqual(preferences);
    expect(await personalCenterApi.memberships()).toEqual([membership]);
    expect(await personalCenterApi.auditHistory()).toHaveLength(1);
    expect(await personalCenterApi.sentNotifications()).toEqual([]);
    expect(await personalCenterApi.loginEvents()).toEqual([]);

    await personalCenterApi.deleteMembership("station-1", "account-1");
    expect(await personalCenterApi.memberships()).toEqual([]);
    expect(await personalCenterApi.auditHistory()).toHaveLength(2);
    expect(invokeDesktop).not.toHaveBeenCalled();
  });
});
