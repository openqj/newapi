import { invokeDesktop } from "../../lib/tauri";

export const rateApi = { rows: <T>() => invokeDesktop<T>("list_rate_rows") };
