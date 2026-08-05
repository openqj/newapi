export type LocalUsageQuery = {
  startDate?: number;
  endDate?: number;
  appType?: string;
  providerName?: string;
  model?: string;
  page: number;
  pageSize: number;
};

export type LocalUsageSummary = {
  totalRequests: number;
  totalCost: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  successRate: number;
  realTotalTokens: number;
  cacheHitRate: number;
};

export type LocalUsageDailyStats = {
  date: string;
  requestCount: number;
  totalCost: string;
  totalTokens: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
};

export type LocalUsageProviderStats = {
  providerId: string;
  providerName: string;
  requestCount: number;
  totalTokens: number;
  totalCost: string;
  successRate: number;
  avgLatencyMs: number;
};

export type LocalUsageModelStats = {
  model: string;
  requestCount: number;
  totalTokens: number;
  totalCost: string;
  avgCostPerRequest: string;
};

export type LocalUsageLogDetail = {
  requestId: string;
  providerId: string;
  providerName: string;
  appType: string;
  model: string;
  requestModel?: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  inputCostUsd: string;
  outputCostUsd: string;
  cacheReadCostUsd: string;
  cacheCreationCostUsd: string;
  totalCostUsd: string;
  isStreaming: boolean;
  latencyMs: number;
  firstTokenMs?: number;
  durationMs?: number;
  statusCode: number;
  errorMessage?: string;
  endpoint?: string;
  keyId?: string;
  createdAt: number;
  dataSource: string;
};

export type LocalUsageDashboard = {
  summary: LocalUsageSummary;
  trends: LocalUsageDailyStats[];
  providerStats: LocalUsageProviderStats[];
  modelStats: LocalUsageModelStats[];
  logs: LocalUsageLogDetail[];
  totalLogs: number;
  providers: string[];
  models: string[];
  appTypes: string[];
};

export type LocalModelPricing = {
  modelId: string;
  displayName: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cacheReadCostPerMillion: number;
  cacheCreationCostPerMillion: number;
};
