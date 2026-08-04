export type DetectionStatus = "pass" | "warning" | "fail";
export type DetectionEvidenceStatus = DetectionStatus | "unsupported";

export type DetectionCheck = {
  name: string;
  status: DetectionStatus;
  detail: string;
  trace?: string;
  weight?: number;
  confidence?: number;
};

export type DetectionResult = {
  score: number;
  checks: DetectionCheck[];
  elapsedMs: number;
  tokensPerSecond?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  model?: string;
  endpoint?: string;
  detectedAt?: number;
  source?: DetectionSourceEvidence;
  behavior?: BehaviorFingerprintEvidence;
  telemetryAttempted?: boolean;
  telemetryUploaded?: boolean;
};

export type DetectionProgress = {
  completed: number;
  total: number;
  current: string;
};

export type DetectionEvidenceItem = {
  id: string;
  name: string;
  status: DetectionStatus;
  detail: string;
};

export type DetectionSourceEvidence = {
  classification: "official_direct" | "compatible_relay" | "unknown_proxy";
  score: number;
  confidence: number;
  observedModel?: string;
  systemFingerprint?: string;
  requestIds: string[];
  signals: DetectionEvidenceItem[];
};

export type BehaviorFingerprintProbe = {
  id: string;
  name: string;
  status: DetectionEvidenceStatus;
  detail: string;
  trace?: string;
  confidence: number;
};

export type BehaviorFingerprintEvidence = {
  probeVersion: string;
  probeSeed: string;
  score: number;
  confidence: number;
  probes: BehaviorFingerprintProbe[];
  observedModels: string[];
  observedFingerprints: string[];
  latencyMedianMs: number;
  latencySpreadMs: number;
  completionTokens: number[];
  completionTokenVariance: number;
};

export type ModelDetectionRequest = {
  endpoint?: string;
  apiKey?: string;
  model: string;
  protocol: string;
  stationId?: string;
  keyId?: string;
};

export type IntelligenceTestItem = {
  id: string;
  name: string;
  status: DetectionStatus;
  detail: string;
  trace?: string;
  attempts: number;
  successes: number;
};

export type IntelligenceDetectionResult = {
  score: number;
  correct: number;
  total: number;
  confidence: number;
  items: IntelligenceTestItem[];
  elapsedMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  telemetryAttempted?: boolean;
  telemetryUploaded?: boolean;
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
