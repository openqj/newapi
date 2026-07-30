import { useCallback, useEffect, useState } from "react";
import { useToast } from "../../components/ui";
import { errorMessage } from "../../lib/errors";
import { defaultNotificationPreferences, PERSONAL_CENTER_MEMBERSHIPS_CHANGED_EVENT, personalCenterApi } from "./api";
import type { MembershipAccess, NotificationPreferences, PersonalCenterAuditEntry } from "./types";

type LoadOptions = { loadOnMount?: boolean };

/** Owns notification preferences, including the desktop command boundary. */
export function useNotificationPreferences({ loadOnMount = true }: LoadOptions = {}) {
  const { notify } = useToast();
  const [preferences, setPreferences] = useState<NotificationPreferences>(defaultNotificationPreferences);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadNotificationPreferences = useCallback(async () => {
    setLoading(true);
    try {
      setPreferences(await personalCenterApi.notificationPreferences());
    } catch (reason) {
      notify(errorMessage(reason, "加载通知设置失败，请稍后重试。"), "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const refreshNotificationPreferences = useCallback(async () => {
    setLoading(true);
    try {
      setPreferences(await personalCenterApi.refreshNotificationPreferences());
    } catch (reason) {
      notify(errorMessage(reason, "加载云端通知设置失败，请稍后重试。"), "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const saveNotificationPreferences = useCallback(async (next: NotificationPreferences) => {
    setSaving(true);
    try {
      setPreferences(await personalCenterApi.saveNotificationPreferences(next));
      return true;
    } catch (reason) {
      notify(errorMessage(reason, "保存通知设置失败，请稍后重试。"), "error");
      return false;
    } finally {
      setSaving(false);
    }
  }, [notify]);

  useEffect(() => { if (loadOnMount) void loadNotificationPreferences(); }, [loadNotificationPreferences, loadOnMount]);
  return { preferences, setPreferences, loading, saving, loadNotificationPreferences, refreshNotificationPreferences, saveNotificationPreferences };
}

/** Owns membership access records and exposes local state only after successful saves. */
export function useMembershipAccess({ loadOnMount = true }: LoadOptions = {}) {
  const { notify } = useToast();
  const [memberships, setMemberships] = useState<MembershipAccess[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadMemberships = useCallback(async () => {
    setLoading(true);
    try {
      setMemberships(await personalCenterApi.memberships());
    } catch (reason) {
      notify(errorMessage(reason, "加载会员权限失败，请稍后重试。"), "error");
    } finally {
      setLoading(false);
    }
  }, [notify]);

  const saveMembership = useCallback(async (membership: MembershipAccess) => {
    setSaving(true);
    try {
      const saved = await personalCenterApi.saveMembership(membership);
      setMemberships((current) => {
        const index = current.findIndex((item) => item.stationId === saved.stationId && item.accountId === saved.accountId);
        return index < 0 ? [saved, ...current] : current.map((item, itemIndex) => itemIndex === index ? saved : item);
      });
      return true;
    } catch (reason) {
      notify(errorMessage(reason, "保存会员权限失败，请稍后重试。"), "error");
      return false;
    } finally {
      setSaving(false);
    }
  }, [notify]);

  const deleteMembership = useCallback(async (stationId: string, accountId: string) => {
    setSaving(true);
    try {
      await personalCenterApi.deleteMembership(stationId, accountId);
      setMemberships((current) => current.filter((item) => item.stationId !== stationId || item.accountId !== accountId));
      return true;
    } catch (reason) {
      notify(errorMessage(reason, "删除会员权限失败，请稍后重试。"), "error");
      return false;
    } finally {
      setSaving(false);
    }
  }, [notify]);

  useEffect(() => { if (loadOnMount) void loadMemberships(); }, [loadMemberships, loadOnMount]);
  useEffect(() => {
    if (!loadOnMount) return;
    const reload = () => void loadMemberships();
    window.addEventListener(PERSONAL_CENTER_MEMBERSHIPS_CHANGED_EVENT, reload);
    return () => window.removeEventListener(PERSONAL_CENTER_MEMBERSHIPS_CHANGED_EVENT, reload);
  }, [loadMemberships, loadOnMount]);
  return { memberships, setMemberships, loading, saving, loadMemberships, saveMembership, deleteMembership };
}

/** Loads the immutable audit timeline independently from editable membership state. */
export function usePersonalCenterAuditHistory({ loadOnMount = true, limit }: LoadOptions & { limit?: number } = {}) {
  const { notify } = useToast();
  const [entries, setEntries] = useState<PersonalCenterAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAuditHistory = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await personalCenterApi.auditHistory(limit));
    } catch (reason) {
      notify(errorMessage(reason, "加载管理记录失败，请稍后重试。"), "error");
    } finally {
      setLoading(false);
    }
  }, [limit, notify]);

  useEffect(() => { if (loadOnMount) void loadAuditHistory(); }, [loadAuditHistory, loadOnMount]);
  return { entries, setEntries, loading, loadAuditHistory };
}
