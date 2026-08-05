import { invokeDesktop } from "../../lib/tauri";
import type { LocalModelPricing, LocalUsageDashboard, LocalUsageQuery } from "./types";

export const localUsageApi = {
  dashboard: (query: LocalUsageQuery) =>
    invokeDesktop<LocalUsageDashboard>("get_local_usage_dashboard", { query }),
  refreshInterval: () => invokeDesktop<number>("get_local_usage_refresh_interval"),
  saveRefreshInterval: (intervalMs: number) =>
    invokeDesktop<number>("save_local_usage_refresh_interval", { intervalMs }),
  pricing: () => invokeDesktop<LocalModelPricing[]>("get_local_usage_pricing"),
  savePricing: (pricing: LocalModelPricing) =>
    invokeDesktop<void>("save_local_usage_pricing", { pricing }),
  deletePricing: (modelId: string) =>
    invokeDesktop<void>("delete_local_usage_pricing", { modelId }),
  clearLogs: () => invokeDesktop<void>("clear_local_usage_logs"),
};
