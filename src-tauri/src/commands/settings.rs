use std::path::PathBuf;

use tauri::State;

use crate::{
    services::{cloud_backup, codex_config},
    settings_store::SettingsStore,
    AppState, CloudAuthStatus, CloudBackupPreview, CloudBackupSummary, CodexIntegrationStatus,
    Store,
};

const BACKGROUND_REFRESH_MINUTES_KEY: &str = "backgroundRefreshMinutes";
const DEFAULT_BACKGROUND_REFRESH_MINUTES: u64 = 30;
const MIN_BACKGROUND_REFRESH_MINUTES: u64 = 10;
const MAX_BACKGROUND_REFRESH_MINUTES: u64 = 24 * 60;

fn read_background_refresh_minutes(state: &AppState) -> Result<u64, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?;
    let value = store.setting(BACKGROUND_REFRESH_MINUTES_KEY)?;
    Ok(value
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|minutes| {
            (MIN_BACKGROUND_REFRESH_MINUTES..=MAX_BACKGROUND_REFRESH_MINUTES).contains(minutes)
        })
        .unwrap_or(DEFAULT_BACKGROUND_REFRESH_MINUTES))
}

#[tauri::command]
pub(crate) fn get_background_refresh_minutes(
    state: tauri::State<'_, AppState>,
) -> Result<u64, String> {
    read_background_refresh_minutes(&state)
}

#[tauri::command]
pub(crate) fn save_background_refresh_minutes(
    state: tauri::State<'_, AppState>,
    minutes: u64,
) -> Result<u64, String> {
    if !(MIN_BACKGROUND_REFRESH_MINUTES..=MAX_BACKGROUND_REFRESH_MINUTES).contains(&minutes) {
        return Err(format!(
            "后台刷新间隔需在 {MIN_BACKGROUND_REFRESH_MINUTES} 分钟到 {MAX_BACKGROUND_REFRESH_MINUTES} 分钟之间。"
        ));
    }
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_setting(BACKGROUND_REFRESH_MINUTES_KEY, &minutes.to_string())?;
    Ok(minutes)
}

#[tauri::command]
pub(crate) async fn get_cloud_auth_status(
    state: State<'_, AppState>,
) -> Result<CloudAuthStatus, String> {
    Ok(cloud_backup::auth_status(&state).await)
}

#[tauri::command]
pub(crate) async fn cloud_sign_up(
    state: State<'_, AppState>,
    email: String,
    password: String,
) -> Result<CloudAuthStatus, String> {
    cloud_backup::sign_up(&state, email, password).await
}

#[tauri::command]
pub(crate) async fn cloud_sign_in(
    state: State<'_, AppState>,
    email: String,
    password: String,
) -> Result<CloudAuthStatus, String> {
    cloud_backup::sign_in(&state, email, password).await
}

#[tauri::command]
pub(crate) async fn cloud_request_password_reset(
    state: State<'_, AppState>,
    email: String,
) -> Result<(), String> {
    cloud_backup::request_password_reset(&state, email).await
}

#[tauri::command]
pub(crate) async fn cloud_complete_password_reset(
    state: State<'_, AppState>,
    access_token: String,
    refresh_token: String,
    expires_in: i64,
    password: String,
) -> Result<CloudAuthStatus, String> {
    cloud_backup::complete_password_reset(&state, access_token, refresh_token, expires_in, password)
        .await
}

#[tauri::command]
pub(crate) fn cloud_sign_out() {
    cloud_backup::sign_out();
}

#[tauri::command]
pub(crate) async fn list_cloud_backups(
    state: State<'_, AppState>,
) -> Result<Vec<CloudBackupSummary>, String> {
    cloud_backup::list_backups(&state).await
}

#[tauri::command]
pub(crate) async fn create_cloud_backup(
    state: State<'_, AppState>,
    recovery_password: String,
) -> Result<CloudBackupSummary, String> {
    cloud_backup::create_backup(&state, recovery_password).await
}

#[tauri::command]
pub(crate) async fn delete_cloud_backup(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    cloud_backup::delete_backup(&state, id).await
}

#[tauri::command]
pub(crate) async fn preview_cloud_backup(
    state: State<'_, AppState>,
    id: String,
    recovery_password: String,
) -> Result<CloudBackupPreview, String> {
    cloud_backup::preview_backup(&state, id, recovery_password).await
}

#[tauri::command]
pub(crate) async fn restore_cloud_backup(
    state: State<'_, AppState>,
    id: String,
    recovery_password: String,
) -> Result<CloudBackupPreview, String> {
    cloud_backup::restore_backup(&state, id, recovery_password).await
}

#[tauri::command]
pub(crate) async fn get_codex_integration(
    state: State<'_, AppState>,
) -> Result<CodexIntegrationStatus, String> {
    codex_config::status(&state)
}

#[tauri::command]
pub(crate) fn get_local_cloud_backup_preview(
    state: State<'_, AppState>,
) -> Result<CloudBackupPreview, String> {
    cloud_backup::local_backup_preview(&state)
}

#[tauri::command]
pub(crate) async fn get_active_codex_relay_status(
    state: State<'_, AppState>,
) -> Result<Option<crate::ActiveCodexRelayStatus>, String> {
    codex_config::active_relay_status(&state).await
}

#[tauri::command]
pub(crate) async fn set_codex_preserve_official_login(
    state: State<'_, AppState>,
    preserve_official_login: bool,
) -> Result<CodexIntegrationStatus, String> {
    codex_config::set_preserve_official_login(&state, preserve_official_login)
}

#[tauri::command]
pub(crate) async fn backup_database(
    state: State<'_, AppState>,
    destination: String,
) -> Result<(), String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?;
    let destination = PathBuf::from(destination);
    if destination == store.path {
        return Err("备份文件不能覆盖当前数据库".into());
    }
    store.checkpoint_and_copy(&destination)?;
    Store::open(destination)
        .map(|_| ())
        .map_err(|error| format!("备份校验失败：{error}"))
}
