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
