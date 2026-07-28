export type DetectionStatus = "pass" | "warning" | "fail";

export type DetectionCheck = {
  name: string;
  status: DetectionStatus;
  detail: string;
  trace?: string;
};

export type DetectionResult = {
  score: number;
  checks: DetectionCheck[];
  elapsedMs: number;
  tokensPerSecond?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
};

export type ModelDetectionRequest = {
  endpoint?: string;
  apiKey?: string;
  model: string;
  protocol: string;
  stationId?: string;
  keyId?: string;
};

export type SavedApiKeyRow = {
  stationId: string;
  stationName: string;
  stationUrl: string;
  models: string[];
  key: { id: string; name: string; maskedKey: string };
};

export type ModelDiscoveryResult = {
  models: string[];
  elapsedMs: number;
  fetchedAt?: number;
  fromCache: boolean;
  error?: string;
};

export type ModelTestResult = {
  model: string;
  available: boolean;
  protocol: string;
  response?: string;
  error?: string;
  elapsedMs: number;
  firstTokenMs?: number;
  tokensPerSecond?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cost?: number;
};

export type ProviderDoctorReport = {
  stationId: string;
  stationName: string;
  adapter: string;
  healthy: boolean;
  elapsedMs: number;
  checks: Array<{
    id: string;
    name: string;
    status: "pass" | "warning" | "fail" | "skipped";
    detail: string;
    remediation?: string;
    elapsedMs: number;
  }>;
};
