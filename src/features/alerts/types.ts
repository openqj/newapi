export type AlertPolicy = {
  enabled: boolean;
  lowBalanceThreshold?: number;
  remainingQuotaPercent?: number;
  quotaResetWarningHours?: number;
  notifyStationFailures: boolean;
};

export type StationAlert = {
  id: string;
  stationId: string;
  stationName: string;
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
};

export type AlertHistoryItem = StationAlert & {
  status: "active" | "resolved";
  occurredAt: number;
};
