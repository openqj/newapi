import { invokeDesktop } from "../../lib/tauri";

export const accountApi = {
  rows: <T>() => invokeDesktop<T>("list_account_rows"),
  remove: (id: string) => invokeDesktop<void>("delete_station", { id }),
};
