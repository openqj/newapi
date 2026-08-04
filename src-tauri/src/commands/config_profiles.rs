use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;
use url::Url;
use uuid::Uuid;

use crate::{
    config_profiles::{
        mask_secret, new_imported_profile, new_profile, ActiveConfigProfile, ConfigImportPreview,
        ConfigImportRequest, ConfigProfile, ConfigProfileApplyResult, ConfigProfileRequest,
        ConfigProfileStore,
    },
    keyring_store::{
        clear_config_profile_secret, load_config_profile_secret, save_config_profile_secret,
    },
    services::{
        api_keys::read_api_key,
        claude_config, codex_config,
        gateway::{current_routing_mode, RoutingMode},
        gemini_config,
    },
    station_snapshot_store::StationSnapshotStore,
    station_store::StationStore,
    support::{api_base_url, now, station_base},
    AppState,
};

#[tauri::command]
pub(crate) fn list_config_profiles(
    state: State<'_, AppState>,
) -> Result<Vec<ConfigProfile>, String> {
    state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .list_config_profiles()
}

#[tauri::command]
pub(crate) fn save_config_profile(
    state: State<'_, AppState>,
    request: ConfigProfileRequest,
) -> Result<ConfigProfile, String> {
    let profile = new_profile(request)?;
    let previous_secret_ref = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .list_config_profiles()?
        .into_iter()
        .find(|item| item.id == profile.id)
        .and_then(|item| item.secret_ref);
    state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .save_config_profile(&profile)?;
    if let Some(secret_ref) = previous_secret_ref {
        clear_config_profile_secret(&secret_ref);
    }
    Ok(profile)
}

#[tauri::command]
pub(crate) fn delete_config_profile(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let secret_ref = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .list_config_profiles()?
        .into_iter()
        .find(|profile| profile.id == id)
        .and_then(|profile| profile.secret_ref);
    state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .delete_config_profile(&id)?;
    if let Some(secret_ref) = secret_ref {
        clear_config_profile_secret(&secret_ref);
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn get_active_config_profile(
    state: State<'_, AppState>,
) -> Result<Option<ActiveConfigProfile>, String> {
    state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .active_config_profile()
}

#[tauri::command]
pub(crate) async fn apply_config_profile(
    state: State<'_, AppState>,
    id: String,
) -> Result<ConfigProfileApplyResult, String> {
    let profile = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .list_config_profiles()?
        .into_iter()
        .find(|profile| profile.id == id)
        .ok_or("Config profile was not found")?;

    let backup_files = match profile.application.as_str() {
        "claude" => {
            if let Some(secret_ref) = profile.secret_ref.as_deref() {
                let endpoint = profile
                    .base_url
                    .as_deref()
                    .ok_or("Imported Claude profile has no endpoint")?;
                let api_key = load_config_profile_secret(secret_ref)?;
                claude_config::apply_raw_with_options(endpoint, &api_key, profile.model.as_deref())?
            } else {
                claude_config::apply_api_key_with_options(
                    &state,
                    profile.station_id.clone(),
                    profile.key_id.clone(),
                    profile.base_url.as_deref(),
                    profile.model.as_deref(),
                )
                .await?
            }
        }
        "codex" => {
            if let Some(secret_ref) = profile.secret_ref.as_deref() {
                let endpoint = profile
                    .base_url
                    .as_deref()
                    .ok_or("Imported Codex profile has no endpoint")?;
                let api_key = load_config_profile_secret(secret_ref)?;
                codex_config::apply_raw_with_options(
                    &state,
                    &profile.name,
                    endpoint,
                    &api_key,
                    profile.model.as_deref(),
                )?
                .0
            } else {
                codex_config::apply_api_key_with_options(
                    &state,
                    profile.station_id.clone(),
                    profile.key_id.clone(),
                    profile.base_url.as_deref(),
                    profile.model.as_deref(),
                )
                .await?
                .0
            }
        }
        "gemini" => {
            if let Some(secret_ref) = profile.secret_ref.as_deref() {
                let endpoint = profile
                    .base_url
                    .as_deref()
                    .ok_or("Imported Gemini profile has no endpoint")?;
                let api_key = load_config_profile_secret(secret_ref)?;
                gemini_config::apply_raw_with_options(endpoint, &api_key, profile.model.as_deref())?
            } else {
                gemini_config::apply_api_key_with_options(
                    &state,
                    profile.station_id.clone(),
                    profile.key_id.clone(),
                    profile.base_url.as_deref(),
                    profile.model.as_deref(),
                )
                .await?
            }
        }
        _ => return Err("Unsupported client application".into()),
    };

    let applied_at = now();
    let active = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .set_active_config_profile(&profile, applied_at)?;
    Ok(ConfigProfileApplyResult {
        active,
        backup_files,
    })
}

#[derive(Clone)]
struct ImportBinding {
    station_id: String,
    station_name: String,
    key_id: String,
    key_name: String,
}

fn normalized_endpoint(value: &str) -> String {
    value.trim().trim_end_matches('/').to_ascii_lowercase()
}

fn matches_station_endpoint(endpoint: &str, station_url: &str) -> bool {
    let endpoint = normalized_endpoint(endpoint);
    let station_api = normalized_endpoint(&api_base_url(station_url));
    endpoint == station_api || station_base(endpoint.as_str()) == station_base(station_url)
}

fn normalize_import_request(
    mut request: ConfigImportRequest,
) -> Result<ConfigImportRequest, String> {
    request.application = request.application.trim().to_lowercase();
    request.name = request.name.trim().to_string();
    request.base_url = request.base_url.trim().trim_end_matches('/').to_string();
    request.api_key = request.api_key.trim().to_string();
    request.model = request
        .model
        .take()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    request.protocol = request
        .protocol
        .take()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    request.homepage = request
        .homepage
        .take()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty());
    request.source = request
        .source
        .take()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if !matches!(request.application.as_str(), "claude" | "codex" | "gemini") {
        return Err("Unsupported client application".into());
    }
    if request.name.is_empty() {
        return Err("Profile name is required".into());
    }
    if request.base_url.is_empty() {
        return Err("An endpoint is required".into());
    }
    if request.api_key.is_empty() {
        return Err("An API key is required".into());
    }
    Ok(request)
}

async fn find_import_binding(
    state: &AppState,
    request: &ConfigImportRequest,
) -> Result<Option<ImportBinding>, String> {
    let stations = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .list_stations()?;

    for station in stations {
        if !matches_station_endpoint(&request.base_url, &station.base_url) {
            continue;
        }
        let keys = state
            .store
            .lock()
            .map_err(|_| "Local database is unavailable".to_string())?
            .load_snapshot(&station.id)?
            .map(|(_, snapshot)| snapshot.api_keys)
            .unwrap_or_default();
        for key in keys {
            let Ok((_, candidate)) = read_api_key(state, &station.id, &key.id).await else {
                continue;
            };
            if candidate == request.api_key {
                return Ok(Some(ImportBinding {
                    station_id: station.id,
                    station_name: station.name,
                    key_id: key.id,
                    key_name: key.name,
                }));
            }
        }
    }
    Ok(None)
}

#[tauri::command]
pub(crate) async fn preview_config_import(
    state: State<'_, AppState>,
    request: ConfigImportRequest,
) -> Result<ConfigImportPreview, String> {
    let request = normalize_import_request(request)?;
    let binding = find_import_binding(&state, &request).await?;
    Ok(ConfigImportPreview {
        application: request.application,
        name: request.name,
        base_url: request.base_url,
        model: request.model,
        protocol: request.protocol,
        homepage: request.homepage,
        masked_api_key: mask_secret(&request.api_key),
        matched_station_id: binding.as_ref().map(|value| value.station_id.clone()),
        matched_station_name: binding.as_ref().map(|value| value.station_name.clone()),
        matched_key_id: binding.as_ref().map(|value| value.key_id.clone()),
        matched_key_name: binding.map(|value| value.key_name),
    })
}

#[tauri::command]
pub(crate) async fn import_config_profile(
    state: State<'_, AppState>,
    request: ConfigImportRequest,
) -> Result<ConfigProfile, String> {
    let request = normalize_import_request(request)?;
    let binding = find_import_binding(&state, &request).await?;
    let external_secret_ref = binding
        .is_none()
        .then(|| format!("imported-{}", Uuid::new_v4()));
    let profile = new_imported_profile(
        &request,
        binding.as_ref().map(|value| value.station_id.clone()),
        binding.as_ref().map(|value| value.key_id.clone()),
        external_secret_ref.clone(),
    )?;

    if let Some(secret_ref) = external_secret_ref.as_deref() {
        save_config_profile_secret(secret_ref, &request.api_key)?;
    }
    let save_result = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .save_config_profile(&profile);
    if let Err(error) = save_result {
        if let Some(secret_ref) = external_secret_ref.as_deref() {
            clear_config_profile_secret(secret_ref);
        }
        return Err(error);
    }
    Ok(profile)
}

#[tauri::command]
pub(crate) async fn export_config_profile_to_cc_switch(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    if current_routing_mode(&state)? != RoutingMode::CcSwitch {
        return Err("请先切换到 CC Switch 模式再导出配置".into());
    }
    let profile = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .list_config_profiles()?
        .into_iter()
        .find(|profile| profile.id == id)
        .ok_or("Config profile was not found")?;

    let (endpoint, homepage, api_key) = if let Some(secret_ref) = profile.secret_ref.as_deref() {
        let endpoint = profile
            .base_url
            .clone()
            .ok_or("Imported config profile has no endpoint")?;
        let homepage = profile.homepage.clone().unwrap_or_else(|| endpoint.clone());
        (endpoint, homepage, load_config_profile_secret(secret_ref)?)
    } else {
        let station = state
            .store
            .lock()
            .map_err(|_| "Local database is unavailable".to_string())?
            .get_station(&profile.station_id)?;
        let api_key = read_api_key(&state, &profile.station_id, &profile.key_id)
            .await?
            .1;
        let endpoint = profile
            .base_url
            .clone()
            .unwrap_or_else(|| api_base_url(&station.base_url));
        let homepage = profile.homepage.clone().unwrap_or(station.base_url);
        (endpoint, homepage, api_key)
    };

    let mut link = Url::parse("ccswitch://v1/import").map_err(|error| error.to_string())?;
    link.query_pairs_mut()
        .append_pair("resource", "provider")
        .append_pair("app", &profile.application)
        .append_pair("name", &profile.name)
        .append_pair("endpoint", &endpoint)
        .append_pair("homepage", &homepage)
        .append_pair("apiKey", &api_key);
    if let Some(model) = profile.model.as_deref() {
        link.query_pairs_mut().append_pair("model", model);
    }
    if let Some(protocol) = profile.protocol.as_deref() {
        link.query_pairs_mut().append_pair("protocol", protocol);
    }
    app.opener()
        .open_url(link.as_str(), None::<&str>)
        .map_err(|error| format!("无法启动 CC Switch：{error}"))
}
