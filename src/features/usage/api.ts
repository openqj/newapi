import { invokeDesktop } from "../../lib/tauri";

export const usageApi = {
  summary: <T>() => invokeDesktop<T>("get_usage_summary"),
  logs: <T>() => invokeDesktop<T>("list_usage_logs"),
  refreshLogs: <T>() => invokeDesktop<T>("refresh_usage_logs"),
};
