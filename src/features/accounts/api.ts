import { invokeDesktop } from "../../lib/tauri";

export const accountApi = { rows: <T>() => invokeDesktop<T>("list_account_rows") };
