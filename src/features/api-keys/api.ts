import { invokeDesktop } from "../../lib/tauri";

export const apiKeyApi = {
  rows: <T>() => invokeDesktop<T>("list_key_rows"),
  reveal: (stationId: string, keyId: string) => invokeDesktop<string>("reveal_key", { stationId, keyId }),
  applyToCodex: (stationId: string, keyId: string) => invokeDesktop<void>("apply_api_key_to_codex", { stationId, keyId }),
  remove: <T>(stationId: string, keyId: string) => invokeDesktop<T>("delete_api_key", { stationId, keyId }),
  importToCcSwitch: (stationId: string, keyId: string, targetApp: string) => invokeDesktop<void>("import_to_cc_switch", { stationId, keyId, targetApp }),
  updateGroup: <T>(stationId: string, keyId: string, group: string) => invokeDesktop<T>("update_key_group", { stationId, keyId, group }),
  testModels: <T>(stationId: string, keyId: string, models: string[], testMode: string) => invokeDesktop<T>("test_api_models", { stationId, keyId, models, testMode }),
  groups: <T>(stationId: string) => invokeDesktop<T>("list_station_groups", { stationId }),
  update: <T>(request: unknown) => invokeDesktop<T>("update_api_key", { request }),
  save: <T>(request: unknown, exists: boolean) => invokeDesktop<T>(exists ? "update_api_key" : "create_api_key", { request }),
};
