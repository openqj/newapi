import { invokeDesktop } from "../../lib/tauri";

export const REMOTE_CODEX_INSTALL_LOG_EVENT = "relayhub:remote-codex-install-log";

export const remoteApi = {
  list: <T>() => invokeDesktop<T>("list_remote_servers"),
  remove: (id: string) => invokeDesktop<void>("delete_remote_server", { id }),
  test: <T>(id: string) => invokeDesktop<T>("test_remote_server", { id }),
  assignRelayKey: <T>(serverId: string, stationId: string, keyId: string) => invokeDesktop<T>("assign_remote_relay_key", { serverId, stationId, keyId }),
  updateRelay: <T>(serverId: string, relayUrl: string, relayKey: string | null) => invokeDesktop<T>("update_remote_relay", { request: { serverId, relayUrl, relayKey } }),
  verifyCodexSession: <T>(id: string) => invokeDesktop<T>("verify_remote_codex_session_command", { id }),
  cancelOperation: (id: string) => invokeDesktop<void>("cancel_remote_server_operation", { id }),
  manageCodex: <T>(id: string, action: "install" | "update") => invokeDesktop<T>("install_or_update_remote_codex_command", { id, action }),
  assignLocalRelay: <T>(serverId: string) => invokeDesktop<T>("assign_local_codex_relay", { serverId }),
  syncLogs: <T>(serverId: string) => invokeDesktop<T>("list_remote_sync_logs", { serverId }),
  auditEvents: <T>() => invokeDesktop<T>("list_audit_events", { limit: 200 }),
  rollbackAudit: <T>(eventId: number) => invokeDesktop<T>("rollback_audit_event", { eventId }),
  choosePrivateKey: () => invokeDesktop<string | null>("choose_private_key_file"),
  generateSshKey: <T>(request: Record<string, unknown>) => invokeDesktop<T>("generate_ssh_key", { request }),
  save: <T>(existingId: string | undefined, request: Record<string, unknown>) => invokeDesktop<T>(existingId ? "update_remote_server" : "add_remote_server", { request }),
};
