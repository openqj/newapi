import { useCallback, useEffect, useMemo, useState } from "react";
import { notificationsApi } from "./api";
import type { NotificationPreferences, NotificationSource } from "./types";

const READ_NOTIFICATION_IDS_KEY = "relayhub-read-notification-ids";

function readStoredIds() {
  try {
    return new Set<string>(JSON.parse(window.localStorage.getItem(READ_NOTIFICATION_IDS_KEY) ?? "[]"));
  } catch {
    return new Set<string>();
  }
}

/** Local dialog state so shell and future notification surfaces share one contract. */
export function useMessagesDialog(initiallyOpen = false) {
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  return { isOpen, open, close };
}

export function useNotifications(source: NotificationSource, preferences?: NotificationPreferences) {
  const messages = useMemo(() => notificationsApi.compose(source, preferences), [source, preferences]);
  const [readIds, setReadIds] = useState(readStoredIds);

  useEffect(() => {
    try {
      window.localStorage.setItem(READ_NOTIFICATION_IDS_KEY, JSON.stringify([...readIds]));
    } catch {
      // Notifications remain usable when browser storage is unavailable.
    }
  }, [readIds]);

  const markRead = useCallback((id: string) => {
    setReadIds((current) => current.has(id) ? current : new Set([...current, id]));
  }, []);
  const markAllRead = useCallback(() => {
    setReadIds((current) => new Set([...current, ...messages.map(({ id }) => id)]));
  }, [messages]);
  const unreadCount = messages.filter(({ id }) => !readIds.has(id)).length;

  return { messages, unreadCount, markRead, markAllRead };
}
