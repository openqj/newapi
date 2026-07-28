import { isTauri } from "../../lib/platform";
import { invokeDesktop } from "../../lib/tauri";
import type {
  DetectionResult,
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
