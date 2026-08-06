import type { MembershipAccess, PersonalCenterAuditEntry } from "./types";

export const auditActionLabels: Record<string, string> = {
  "membership.created": "新增会员权限",
  "membership.updated": "修改会员权限",
  "membership.deleted": "撤销会员权限",
  membership_insert: "新增会员权限",
  membership_update: "修改会员权限",
  membership_delete: "撤销会员权限",
  "notification.created": "发布云端通知",
  "notification.updated": "修改云端通知",
  "notification.revoked": "撤回云端通知",
  "notification.deleted": "删除云端通知",
  "notification_preferences.updated": "修改通知规则",
  notification_insert: "发布云端通知",
  notification_update: "修改云端通知",
  notification_delete: "删除云端通知",
  notification_preferences_update: "修改通知规则",
  merchant_code_revealed: "查看兑换码",
  merchant_code_copied: "复制兑换码",
};

export function auditActionLabel(action: string) {
  return auditActionLabels[action] ?? action.replace(/[._-]+/g, " ");
}

export function auditActorLabel(entry: Pick<PersonalCenterAuditEntry, "actorEmail" | "actorId">) {
  return entry.actorEmail || entry.actorId || "系统自动记录";
}

export function auditSnapshotText(value: unknown) {
  if (value == null) return "无快照";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function epochMilliseconds(value?: number | null) {
  if (!value) return 0;
  return value < 10_000_000_000 ? value * 1000 : value;
}

export type MembershipEffectiveStatus = "active" | "expired" | "disabled";

export function membershipEffectiveStatus(membership: Pick<MembershipAccess, "enabled" | "expiresAt">): MembershipEffectiveStatus {
  if (!membership.enabled) return "disabled";
  if (membership.expiresAt && epochMilliseconds(membership.expiresAt) <= Date.now()) return "expired";
  return "active";
}

export function membershipStatusLabel(status: MembershipEffectiveStatus) {
  return status === "active" ? "当前有效" : status === "expired" ? "已过期" : "当前无效";
}

export function membershipEnabledLabel(enabled: boolean) {
  return enabled ? "已启用" : "已停用";
}

export function formatAuditDateTime(value?: number | null) {
  if (!value) return "未知时间";
  const date = new Date(epochMilliseconds(value));
  return Number.isNaN(date.getTime()) ? "未知时间" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function maskRedeemCode(code?: string | null) {
  if (!code) return "未显示";
  if (code.length <= 6) return "******";
  return `${code.slice(0, 3)}******${code.slice(-3)}`;
}
