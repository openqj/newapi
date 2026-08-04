use crate::services::config_backups::{
    self, ConfigBackupPreview, ConfigBackupRestoreResult, ConfigBackupSummary,
};

#[tauri::command]
pub(crate) fn list_config_backups() -> Result<Vec<ConfigBackupSummary>, String> {
    config_backups::list()
}

#[tauri::command]
pub(crate) fn preview_config_backup(id: String) -> Result<ConfigBackupPreview, String> {
    config_backups::preview(&id)
}

#[tauri::command]
pub(crate) fn restore_config_backup(id: String) -> Result<ConfigBackupRestoreResult, String> {
    config_backups::restore(&id)
}
