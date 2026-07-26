import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./platform";

/** Feature API modules use this instead of importing Tauri directly. */
export async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) {
    throw new Error("此操作只能在 RelayHub 桌面应用中执行。");
  }
  return invoke<T>(command, args);
}
