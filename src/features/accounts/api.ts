import { invokeDesktop } from "../../lib/tauri";

export const accountApi = {
  rows: <T>() => invokeDesktop<T>("list_account_rows"),
  remove: (id: string) => invokeDesktop<void>("delete_station", { id }),
  redeem: (stationId: string, code: string) => invokeDesktop<string>("redeem_station_code", { stationId, code }),
};
