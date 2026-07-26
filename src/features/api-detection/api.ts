import { isTauri } from "../../lib/platform";
import { invokeDesktop } from "../../lib/tauri";
import type { DetectionResult, ModelDetectionRequest } from "./types";

export async function detectModelAuthenticity(
  request: ModelDetectionRequest,
  demoResult: DetectionResult,
) {
  if (!isTauri()) return demoResult;
  return invokeDesktop<DetectionResult>("detect_model_authenticity", { request });
}
