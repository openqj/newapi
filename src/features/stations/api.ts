import { invokeDesktop } from "../../lib/tauri";

export const stationApi = {
  list: <T>() => invokeDesktop<T>("list_stations"),
  snapshot: <T>(id: string) => invokeDesktop<T | null>("get_snapshot", { id }),
  refreshAll: <T>() => invokeDesktop<T>("refresh_all"),
  refresh: <T>(id: string) => invokeDesktop<T>("refresh_station", { id }),
  reauthenticate: <T>(id: string, totp: string | null) => invokeDesktop<T>("reauthenticate_station", { id, totp }),
  clearSession: (id: string) => invokeDesktop<void>("clear_station_session", { id }),
  syncProgress: <T>() => invokeDesktop<T | null>("get_sync_progress"),
  cancelSync: () => invokeDesktop<void>("cancel_sync"),
  probe: <T>(baseUrl: string) => invokeDesktop<T>("probe_station", { baseUrl }),
  sendVerificationCode: (baseUrl: string, email: string) => invokeDesktop<string>("send_station_verification_code", { baseUrl, email }),
  add: <T>(request: Record<string, unknown>) => invokeDesktop<T>("add_station", { request }),
  registerAccount: <T>(request: Record<string, unknown>) => invokeDesktop<T>("register_station_account", { request }),
  importWithCode: <T>(request: Record<string, unknown>) => invokeDesktop<T>("import_station_with_code", { request }),
  update: <T>(request: Record<string, unknown>) => invokeDesktop<T>("update_station", { request }),
};
