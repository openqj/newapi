/** Per-account controls for messages surfaced by the personal center. */
export type NotificationPreferences = {
  desktopEnabled: boolean;
  syncEnabled: boolean;
  alertEnabled: boolean;
  offerEnabled: boolean;
};

/** A member's entitlement for one managed station account. */
export type MembershipAccess = {
  stationId: string;
  accountId: string;
  userEmail: string;
  plan: string;
  accessLevel: string;
  enabled: boolean;
  expiresAt?: number;
  privileges: string[];
  updatedAt: number;
};

/** A redacted, user-facing event for personal-center administration. */
export type PersonalCenterAuditEntry = {
  id: number;
  action: string;
  subject: string;
  detail: string;
  actorId?: string | null;
  actorEmail?: string | null;
  before?: unknown;
  after?: unknown;
  createdAt: number;
};

export type PersonalCenterNotification = {
  id: string;
  audience: "all" | "members" | "guests" | "user";
  targetEmail?: string;
  kind: "info" | "warning" | "offer";
  title: string;
  body: string;
  destination: "overview" | "offers" | "personalCenter";
  publishedAt: number;
  expiresAt?: number;
  revokedAt?: number;
  deliveredAt?: number;
  readAt?: number;
};

export type PublishNotificationRequest = {
  audience: "all" | "members" | "guests" | "user";
  targetEmail?: string;
  kind: "info" | "warning" | "offer";
  title: string;
  body: string;
  destination: "overview" | "offers" | "personalCenter";
  expiresAt?: number;
};

export type PersonalCenterLoginEvent = {
  id: number;
  email: string;
  ipAddress?: string;
  userAgent?: string;
  outcome: "success" | "failure";
  failureReason?: string;
  createdAt: number;
};

export type PersonalCenterRealtimeSession = {
  url: string;
  anonKey: string;
  accessToken: string;
  userId: string;
  isAdmin: boolean;
  isAnonymous: boolean;
  expiresAt: number;
};
