use std::path::PathBuf;

use tauri::State;

use crate::{AppState, Store};

#[tauri::command]
pub(crate) fn backup_database(
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
