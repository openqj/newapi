import { invokeDesktop } from "../../lib/tauri";

export const profileApi = {
  list: <T>() => invokeDesktop<T>("list_login_profiles"),
  get: <T>(id: string) => invokeDesktop<T>("get_login_profile", { id }),
  save: <T>(request: Record<string, unknown>) => invokeDesktop<T>("save_login_profile", { request }),
  remove: (id: string) => invokeDesktop<void>("delete_login_profile", { id }),
};
