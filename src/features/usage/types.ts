export type UsageSummary = {
  todayInputTokens?: number;
  todayOutputTokens?: number;
  todayRequests?: number;
  totalRequests?: number;
  todaySpent?: number;
  todayLimit?: number;
  totalSpent?: number;
  totalLimit?: number;
};

export type UsageLog = {
  id: string;
  stationId: string;
  stationName: string;
  stationUrl?: string;
  apiKeyName?: string;
  groupName?: string;
  endpoint?: string;
  ipAddress?: string;
  reasoningEffort?: string;
  billingType?: string;
  billingMode?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  actualCost: number;
  requestType: string;
  durationMs?: number;
  createdAt: number;
};
