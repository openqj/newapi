import type { UsageSummary } from "../usage";

export type AccountRow = {
  stationId: string;
  stationName: string;
  stationUrl: string;
  kind: string;
  syncStatus: string;
  lastSyncedAt?: number;
  account: {
    id: string;
    username: string;
    displayName: string;
    email?: string;
    group?: string;
    role: string;
    status: string;
    balance?: number;
  };
  usage: UsageSummary;
};
