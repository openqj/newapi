import { invokeDesktop } from "../../lib/tauri";
import type { AlertHistoryItem, AlertPolicy, StationAlert } from "./types";

export const alertApi = {
  policy: () => invokeDesktop<AlertPolicy>("get_alert_policy"),
  savePolicy: (policy: AlertPolicy) => invokeDesktop<AlertPolicy>("save_alert_policy", { policy }),
  evaluate: () => invokeDesktop<StationAlert[]>("evaluate_alerts"),
  history: (limit = 50) => invokeDesktop<AlertHistoryItem[]>("list_alert_history", { limit }),
};
