export type KeyInfo = {
  id: string;
  name: string;
  maskedKey: string;
  group?: string;
  status: string;
  remainingQuota?: number;
  totalQuota?: number;
  unlimitedQuota?: boolean;
  currentConcurrency?: number;
  usedQuota?: number;
  todaySpent?: number;
  last30DaysSpent?: number;
  expiresAt?: number;
  createdAt?: number;
};

export type GroupOption = {
  name: string;
  multiplier?: number;
};

export type ModelTestResult = {
  model: string;
  response?: string;
  error?: string;
  elapsedMs: number;
};

export type KeyRow = {
  stationId: string;
  stationName: string;
  stationUrl: string;
  stationBalance?: number;
  groups: GroupOption[];
  models: string[];
  key: KeyInfo;
};
