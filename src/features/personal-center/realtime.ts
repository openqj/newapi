import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "../../lib/platform";
import type { NotificationMessage } from "../notifications";
import { PERSONAL_CENTER_AUTH_CHANGED_EVENT, PERSONAL_CENTER_MEMBERSHIPS_CHANGED_EVENT, personalCenterApi } from "./api";
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

export function usePersonalCenterRealtime(onPreferencesChanged: () => Promise<void>, desktopEnabled = true) {
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

  const refreshMemberships = useCallback(async () => {
    if (!isTauri()) return;
    try {
      setMemberships(await personalCenterApi.memberships());
    } catch {
      // Preserve the last server snapshot during transient connectivity failures.
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([refreshNotifications(), refreshMemberships(), onPreferencesChanged()]);
    window.dispatchEvent(new Event(PERSONAL_CENTER_MEMBERSHIPS_CHANGED_EVENT));
  }, [onPreferencesChanged, refreshMemberships, refreshNotifications]);

  useEffect(() => {
    if (!isTauri()) return;
    let client: SupabaseClient | null = null;
    let channel: RealtimeChannel | null = null;
    let retryTimer: number | undefined;
    let stopped = false;
    let disconnecting = false;

    const disconnect = async () => {
      if (retryTimer) window.clearTimeout(retryTimer);
      retryTimer = undefined;
      disconnecting = true;
      if (client && channel) await client.removeChannel(channel);
      client = null;
      channel = null;
      disconnecting = false;
    };
    const reconnect = () => {
      if (stopped || retryTimer) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = undefined;
        void connect();
      }, 10_000);
    };
    const connect = async () => {
      await disconnect();
      try {
        const session = await personalCenterApi.realtimeSession();
        if (stopped) return;
        setAccess({ authenticated: true, isAdmin: session.isAdmin });
        client = createClient(session.url, session.anonKey, {
          auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
          accessToken: async () => session.accessToken,
        });
        client.realtime.setAuth(session.accessToken);
        channel = client.channel(`personal-center-${session.userId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "personal_center_notifications" }, () => void refreshNotifications(true))
          .on("postgres_changes", { event: "*", schema: "public", table: "notification_receipts", filter: `user_id=eq.${session.userId}` }, () => void refreshNotifications())
          .on("postgres_changes", { event: "*", schema: "public", table: "personal_center_memberships", filter: `user_id=eq.${session.userId}` }, () => { void refreshMemberships(); window.dispatchEvent(new Event(PERSONAL_CENTER_MEMBERSHIPS_CHANGED_EVENT)); })
          .on("postgres_changes", { event: "*", schema: "public", table: "personal_center_notification_preferences" }, () => void onPreferencesChanged())
          .subscribe((status) => {
            if (status === "SUBSCRIBED") void refreshAll();
            if (!disconnecting && (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")) reconnect();
          });
      } catch {
        reconnect();
      }
    };
    const recover = () => { if (document.visibilityState === "visible") void refreshAll(); };
    const authChanged = (event: Event) => {
      const status = (event as CustomEvent<{ email?: string; isAdmin?: boolean }>).detail;
      if (status && !status.email) {
        setAccess({ authenticated: false, isAdmin: false });
        setMemberships([]);
        setNotifications([]);
        void disconnect();
        return;
      }
      void connect();
    };
    window.addEventListener("focus", recover);
    document.addEventListener("visibilitychange", recover);
    window.addEventListener(PERSONAL_CENTER_AUTH_CHANGED_EVENT, authChanged);
    void connect();
    return () => {
      stopped = true;
      window.removeEventListener("focus", recover);
      document.removeEventListener("visibilitychange", recover);
      window.removeEventListener(PERSONAL_CENTER_AUTH_CHANGED_EVENT, authChanged);
      void disconnect();
    };
  }, [onPreferencesChanged, refreshAll, refreshMemberships, refreshNotifications]);

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
