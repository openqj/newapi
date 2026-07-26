import { invokeDesktop } from "../../lib/tauri";

export const apiKeyApi = {
  rows: <T>() => invokeDesktop<T>("list_key_rows"),
  reveal: (stationId: string, keyId: string) => invokeDesktop<string>("reveal_key", { stationId, keyId }),
  remove: <T>(stationId: string, keyId: string) => invokeDesktop<T>("delete_api_key", { stationId, keyId }),
};
