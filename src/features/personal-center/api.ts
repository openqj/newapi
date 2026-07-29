import { isTauri } from "../../lib/platform";
import { invokeDesktop } from "../../lib/tauri";
import type { MembershipAccess, NotificationPreferences, PersonalCenterAuditEntry, PersonalCenterLoginEvent, PersonalCenterNotification, PersonalCenterRealtimeSession, PublishNotificationRequest } from "./types";

const NOTIFICATION_PREFERENCES_KEY = "relayhub-personal-center-notification-preferences";
const MEMBERSHIPS_KEY = "relayhub-personal-center-memberships";
const AUDIT_HISTORY_KEY = "relayhub-personal-center-audit-history";

export const defaultNotificationPreferences: NotificationPreferences = {
  desktopEnabled: true,
  syncEnabled: true,
  alertEnabled: true,
  offerEnabled: true,
};

function readLocal<T>(key: string, fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeLocal<T>(key: string, value: T) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Browser previews remain usable when storage is unavailable.
  }
}

function membershipKey({ stationId, accountId }: Pick<MembershipAccess, "stationId" | "accountId">) {
  return `${stationId}:${accountId}`;
}

function appendLocalAudit(action: string, membership: MembershipAccess) {
  const entries = readLocal<PersonalCenterAuditEntry[]>(AUDIT_HISTORY_KEY, []);
  entries.unshift({
    id: Date.now(),
    action,
    subject: membershipKey(membership),
    detail: `${membership.plan} / ${membership.accessLevel}`,
    createdAt: Date.now(),
  });
  writeLocal(AUDIT_HISTORY_KEY, entries.slice(0, 200));
}

/** Desktop commands with a persisted browser-preview implementation. */
export const personalCenterApi = {
  async notificationPreferences(): Promise<NotificationPreferences> {
    if (isTauri()) return invokeDesktop<NotificationPreferences>("get_personal_center_notification_preferences");
    return { ...defaultNotificationPreferences, ...readLocal<Partial<NotificationPreferences>>(NOTIFICATION_PREFERENCES_KEY, {}) };
  },

  async saveNotificationPreferences(preferences: NotificationPreferences): Promise<NotificationPreferences> {
    if (isTauri()) return invokeDesktop<NotificationPreferences>("save_personal_center_notification_preferences", { preferences });
    writeLocal(NOTIFICATION_PREFERENCES_KEY, preferences);
    return preferences;
  },

  async memberships(): Promise<MembershipAccess[]> {
    if (isTauri()) return invokeDesktop<MembershipAccess[]>("list_personal_center_memberships");
    return readLocal<MembershipAccess[]>(MEMBERSHIPS_KEY, []);
  },

  async saveMembership(membership: MembershipAccess): Promise<MembershipAccess> {
    if (isTauri()) return invokeDesktop<MembershipAccess>("save_personal_center_membership", { membership });
    const memberships = readLocal<MembershipAccess[]>(MEMBERSHIPS_KEY, []);
    const index = memberships.findIndex((item) => membershipKey(item) === membershipKey(membership));
    if (index >= 0) memberships[index] = membership;
    else memberships.unshift(membership);
    writeLocal(MEMBERSHIPS_KEY, memberships);
    appendLocalAudit(index >= 0 ? "membership.updated" : "membership.created", membership);
    return membership;
  },

  async deleteMembership(stationId: string, accountId: string): Promise<void> {
    if (isTauri()) return invokeDesktop<void>("delete_personal_center_membership", { stationId, accountId });
    const memberships = readLocal<MembershipAccess[]>(MEMBERSHIPS_KEY, []);
    const membership = memberships.find((item) => item.stationId === stationId && item.accountId === accountId);
    writeLocal(MEMBERSHIPS_KEY, memberships.filter((item) => item.stationId !== stationId || item.accountId !== accountId));
    if (membership) appendLocalAudit("membership.deleted", membership);
  },

  async auditHistory(limit?: number): Promise<PersonalCenterAuditEntry[]> {
    if (isTauri()) return invokeDesktop<PersonalCenterAuditEntry[]>("list_personal_center_audit_history", limit === undefined ? undefined : { limit });
    const entries = readLocal<PersonalCenterAuditEntry[]>(AUDIT_HISTORY_KEY, []);
    return limit === undefined ? entries : entries.slice(0, limit);
  },

  notifications: () => isTauri()
    ? invokeDesktop<PersonalCenterNotification[]>("list_personal_center_notifications")
    : Promise.resolve([]),

  publishNotification: (request: PublishNotificationRequest) =>
    invokeDesktop<PersonalCenterNotification>("publish_personal_center_notification", { request }),

  markNotification: (notificationId: string, read: boolean) =>
    invokeDesktop<void>("mark_personal_center_notification", { notificationId, read }),

  realtimeSession: () => invokeDesktop<PersonalCenterRealtimeSession>("get_personal_center_realtime_session"),

  loginEvents: (limit = 100) => invokeDesktop<PersonalCenterLoginEvent[]>("list_personal_center_login_events", { limit }),
};

export const PERSONAL_CENTER_AUTH_CHANGED_EVENT = "relayhub:personal-center-auth-changed";
export const PERSONAL_CENTER_MEMBERSHIPS_CHANGED_EVENT = "relayhub:personal-center-memberships-changed";

export function signalPersonalCenterAuthChanged(status?: { email?: string; isAdmin?: boolean }) {
  window.dispatchEvent(new CustomEvent(PERSONAL_CENTER_AUTH_CHANGED_EVENT, { detail: status }));
}
