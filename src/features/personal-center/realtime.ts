import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "../../lib/platform";
import type { NotificationMessage } from "../notifications";
import { personalCenterApi } from "./api";
import type { MembershipAccess, PersonalCenterNotification } from "./types";

function epochMilliseconds(value: number) {
  return value < 10_000_000_000 ? value * 1000 : value;
}

function asMessage(notification: PersonalCenterNotification): NotificationMessage {
  return {
    id: `cloud:${notification.id}`,
    cloudNotificationId: notification.id,
    kind: notification.kind === "offer" ? "offer" : notification.kind === "warning" ? "warning" : "announcement",
    title: notification.title,
    summary: notification.body,
    createdAt: epochMilliseconds(notification.publishedAt),
    destination: notification.destination,
    read: Boolean(notification.readAt),
  };
}

export function usePersonalCenterRealtime(_onPreferencesChanged: () => Promise<void>, enabled: boolean, desktopEnabled = true) {
  const [notifications, setNotifications] = useState<PersonalCenterNotification[]>([]);
  const [memberships, setMemberships] = useState<MembershipAccess[]>([]);
  const [access, setAccess] = useState<{ authenticated: boolean; isAdmin: boolean }>({ authenticated: false, isAdmin: false });
  const knownNotificationIds = useRef(new Set<string>());

  const refreshNotifications = useCallback(async (announceNew = false) => {
    if (!isTauri()) return;
    try {
      const next = await personalCenterApi.notifications();
      const newNotifications = next.filter((item) => !knownNotificationIds.current.has(item.id));
      next.forEach((item) => knownNotificationIds.current.add(item.id));
      setNotifications(next);
      await Promise.all(next.filter((item) => !item.deliveredAt).map((item) => personalCenterApi.markNotification(item.id, false)));
      if (announceNew && desktopEnabled && newNotifications.length) {
        const { isPermissionGranted, sendNotification } = await import("@tauri-apps/plugin-notification");
        if (await isPermissionGranted()) {
          const latest = newNotifications[0];
          sendNotification({ title: latest.title, body: latest.body });
        }
      }
    } catch {
      setNotifications([]);
    }
  }, [desktopEnabled]);

  useEffect(() => {
    if (!enabled) {
      setAccess({ authenticated: false, isAdmin: false });
      setMemberships([]);
      setNotifications([]);
      return;
    }
    if (!isTauri()) return;
    void refreshNotifications();
    const notificationTimer = window.setInterval(() => void refreshNotifications(true), 5 * 60_000);
    return () => {
      window.clearInterval(notificationTimer);
    };
  }, [enabled, refreshNotifications]);

  const messages = useMemo(() => notifications.map(asMessage), [notifications]);
  const unreadCount = notifications.filter((item) => !item.readAt).length;
  const markRead = useCallback(async (id: string) => {
    await personalCenterApi.markNotification(id, true);
    setNotifications((current) => current.map((item) => item.id === id ? { ...item, readAt: Date.now() } : item));
  }, []);
  const markAllRead = useCallback(async () => {
    await Promise.all(notifications.filter((item) => !item.readAt).map((item) => personalCenterApi.markNotification(item.id, true)));
    setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? Date.now() })));
  }, [notifications]);

  return { messages, unreadCount, memberships, access, refreshNotifications, markRead, markAllRead };
}
