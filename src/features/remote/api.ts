import { invokeDesktop } from "../../lib/tauri";

export const remoteApi = {
  list: <T>() => invokeDesktop<T>("list_remote_servers"),
  remove: (id: string) => invokeDesktop<void>("delete_remote_server", { id }),
  test: <T>(id: string) => invokeDesktop<T>("test_remote_server", { id }),
};
