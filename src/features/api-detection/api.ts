import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../lib/platform";
import type { DetectionResult, ModelDetectionRequest } from "./types";

export async function detectModelAuthenticity(
  request: ModelDetectionRequest,
  demoResult: DetectionResult,
) {
  if (!isTauri()) return demoResult;
  return invoke<DetectionResult>("detect_model_authenticity", { request });
}
