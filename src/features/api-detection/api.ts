import { isTauri } from "../../lib/platform";
import { invokeDesktop } from "../../lib/tauri";
import type {
  DetectionResult,
  IntelligenceDetectionResult,
  ModelDetectionRequest,
  ModelDiscoveryResult,
  ModelTestResult,
  ProviderDoctorReport,
} from "./types";

export async function detectModelAuthenticity(
  request: ModelDetectionRequest,
  demoResult: DetectionResult,
) {
  if (!isTauri()) return demoResult;
  return invokeDesktop<DetectionResult>("detect_model_authenticity", { request });
}

export async function detectModelIntelligence(
  request: ModelDetectionRequest,
  demoResult?: IntelligenceDetectionResult,
): Promise<IntelligenceDetectionResult> {
  if (!isTauri()) {
    return demoResult ?? {
      score: 83,
      correct: 10,
      total: 12,
      confidence: 0.83,
      elapsedMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      items: [
        { id: "arithmetic", name: "算术推理", status: "pass", detail: "重复试验 2/2 次通过", attempts: 2, successes: 2 },
        { id: "multi_step_logic", name: "多步逻辑", status: "pass", detail: "重复试验 2/2 次通过", attempts: 2, successes: 2 },
        { id: "conditional_reasoning", name: "条件推理", status: "pass", detail: "重复试验 2/2 次通过", attempts: 2, successes: 2 },
        { id: "counterfactual", name: "反事实判断", status: "warning", detail: "重复试验 1/2 次通过", attempts: 2, successes: 1 },
        { id: "structured_constraints", name: "结构化约束", status: "pass", detail: "重复试验 2/2 次通过", attempts: 2, successes: 2 },
        { id: "instruction_following", name: "指令遵循", status: "pass", detail: "重复试验 2/2 次通过", attempts: 2, successes: 2 },
      ],
    };
  }
  return invokeDesktop<IntelligenceDetectionResult>("detect_model_intelligence", { request });
}

export async function discoverSavedKeyModels(
  stationId: string,
  keyId: string,
  forceRefresh = false,
): Promise<ModelDiscoveryResult> {
  return invokeDesktop<ModelDiscoveryResult>("discover_api_models", { stationId, keyId, forceRefresh });
}

export async function testSavedKeyModels(
  stationId: string,
  keyId: string,
  models: string[],
  testMode = "chat",
): Promise<ModelTestResult[]> {
  return invokeDesktop<ModelTestResult[]>("test_api_models", { stationId, keyId, models, testMode });
}

export function diagnoseStation(stationId: string, keyId?: string) {
  return invokeDesktop<ProviderDoctorReport>("diagnose_station", { stationId, keyId });
}
