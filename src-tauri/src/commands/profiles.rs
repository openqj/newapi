use tauri::State;
use uuid::Uuid;

use crate::{
    keyring_store::{
        clear_login_profile_secret, load_login_profile_secret, save_login_profile_secret,
        LoginProfileSecret,
    },
    login_profiles::{LoginProfile, LoginProfileRequest, LoginProfileStore},
    AppState,
};

#[tauri::command]
pub(crate) fn list_login_profiles(state: State<'_, AppState>) -> Result<Vec<LoginProfile>, String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .list_login_profiles()
}

#[tauri::command]
pub(crate) fn get_login_profile(
    state: State<'_, AppState>,
    id: String,
) -> Result<LoginProfileSecret, String> {
    let profiles = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .list_login_profiles()?;
    if !profiles.iter().any(|profile| profile.id == id) {
        return Err("未找到该账号配置".into());
    }
    load_login_profile_secret(&id)
}

#[tauri::command]
pub(crate) fn save_login_profile(
    state: State<'_, AppState>,
    request: LoginProfileRequest,
) -> Result<LoginProfile, String> {
    if request.name.trim().is_empty()
        || request.username.trim().is_empty()
        || request.password.is_empty()
    {
        return Err("账号名称、用户名和密码不能为空".into());
    }
    let profile = LoginProfile {
        id: request
            .id
            .filter(|id| !id.trim().is_empty())
            .unwrap_or_else(|| Uuid::new_v4().to_string()),
        name: request.name.trim().to_string(),
        username: request.username.trim().to_string(),
    };
    save_login_profile_secret(&profile.id, &profile.username, &request.password)?;
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_login_profile(&profile)?;
    Ok(profile)
}

#[tauri::command]
pub(crate) fn delete_login_profile(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .delete_login_profile(&id)?;
    clear_login_profile_secret(&id);
    Ok(())
}
