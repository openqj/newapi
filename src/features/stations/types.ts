export type Station = {
  id: string;
  name: string;
  baseUrl: string;
  kind: string;
  status: string;
  lastSyncedAt?: number;
  lastError?: string;
};

export type StationConnectionResult = {
  success: boolean;
  status: "online" | "error";
  reason?: string;
};

export type StationSaveResult = {
  station: Station;
  connection: StationConnectionResult;
};
