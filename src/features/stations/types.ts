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

export type StationAccountCredentials = {
  username: string;
  password: string;
};

export type StationCodeImportResult = StationSaveResult & {
  redemptionMessage?: string;
};

export type StationAccountDraft = {
  id: string;
  name: string;
  baseUrl: string;
  kind: string;
  username?: string;
};

/**
 * The server snapshot deliberately lives with the stations feature: it is the
 * result of synchronising one station and is consumed by the other read-only
 * dashboard features.
 */
export type StationSnapshot<Rate = unknown, ApiKey = unknown, Usage = unknown> = {
  stationBalance?: number;
  rates: Rate[];
  apiKeys: ApiKey[];
  offers: { id: string; title: string; summary: string; sourceUrl: string; publishedAt?: number }[];
  unavailable: string[];
  usage?: Usage;
};

export type StationSyncProgress = {
  operationId: string;
  completed: number;
  total: number;
  currentStation?: string;
  status: string;
};

export type StationSyncResult<Snapshot = StationSnapshot> = {
  station: Station;
  snapshot: Snapshot;
  changed: boolean;
  changeSummary: string[];
};
