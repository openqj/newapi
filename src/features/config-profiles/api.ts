import { invokeDesktop } from "../../lib/tauri";
import type { ActiveConfigProfile, ConfigBackupPreview, ConfigBackupRestoreResult, ConfigBackupSummary, ConfigImportPreview, ConfigImportRequest, ConfigProfile, ConfigProfileApplyResult, ConfigProfileDraft } from "./types";

export const CONFIG_PROFILE_CHANGED_EVENT = "relayhub:config-profile-changed";

export const configProfileApi = {
  list: () => invokeDesktop<ConfigProfile[]>("list_config_profiles"),
  save: (request: ConfigProfileDraft) => invokeDesktop<ConfigProfile>("save_config_profile", { request }),
  remove: (id: string) => invokeDesktop<void>("delete_config_profile", { id }),
  active: () => invokeDesktop<ActiveConfigProfile | null>("get_active_config_profile"),
  apply: (id: string) => invokeDesktop<ConfigProfileApplyResult>("apply_config_profile", { id }),
  backups: () => invokeDesktop<ConfigBackupSummary[]>("list_config_backups"),
  previewBackup: (id: string) => invokeDesktop<ConfigBackupPreview>("preview_config_backup", { id }),
  restoreBackup: (id: string) => invokeDesktop<ConfigBackupRestoreResult>("restore_config_backup", { id }),
  previewImport: (request: ConfigImportRequest) => invokeDesktop<ConfigImportPreview>("preview_config_import", { request }),
  importProfile: (request: ConfigImportRequest) => invokeDesktop<ConfigProfile>("import_config_profile", { request }),
  exportToCcSwitch: (id: string) => invokeDesktop<void>("export_config_profile_to_cc_switch", { id }),
};
