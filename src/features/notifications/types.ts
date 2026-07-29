export type NotificationMessage = {
  id: string;
  kind: "sync" | "warning" | "offer" | "announcement";
  title: string;
  summary: string;
  createdAt: number;
  destination: "overview" | "offers" | "personalCenter";
  cloudNotificationId?: string;
  read?: boolean;
};

export type NotificationSource = {
  stations: { id: string; name: string; status: string; lastSyncedAt?: number; lastError?: string }[];
  offers: { id: string; title: string; summary: string; publishedAt?: number }[];
  unavailable: string[];
  syncing: boolean;
  syncProgress?: { operationId: string; completed: number; total: number; currentStation?: string } | null;
};

export type NotificationPreferences = {
  syncEnabled?: boolean;
  alertEnabled?: boolean;
  offerEnabled?: boolean;
};
