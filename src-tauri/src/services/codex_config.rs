use std::{
    env, fs,
    path::{Path, PathBuf},
    time::Duration,
};

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use toml_edit::{value, DocumentMut, Item, Table};

use crate::{
    services::{
        api_keys::read_api_key,
        client_backup::{backup_directory_for, backup_existing_file},
        gateway::{current_routing_mode, RoutingMode},
        stations::{
            load_authenticated_secret, newapi_display_balance, parse_balance, station_request,
            title_from_html,
        },
    },
    settings_store::SettingsStore,
    station_adapter::{Station, StationAdapter},
    station_store::StationStore,
    support::{api_base_url, station_base},
    ActiveCodexRelayStatus, AppState, CodexIntegrationStatus,
};

const PRESERVE_OFFICIAL_AUTH_SETTING: &str = "preserveCodexOfficialAuthOnSwitch";
const LOCAL_GATEWAY_SNAPSHOT_SETTING: &str = "codexLocalGatewaySnapshot";
const CODEX_GOAL_MODE_SETTING: &str = "codexGoalModeEnabled";
const CODEX_REMOTE_COMPACTION_SETTING: &str = "codexRemoteCompactionEnabled";
const CODEX_COMMON_CONFIG_ENABLED_SETTING: &str = "codexCommonConfigEnabled";
const CODEX_COMMON_CONFIG_SETTING: &str = "codexCommonConfig";
const LOCAL_GATEWAY_PROVIDER: &str = "relayhub_local";
const DEFAULT_MODEL: &str = "gpt-5-codex";
const DIRECT_MODEL: &str = "gpt-5.5";
const DIRECT_PROVIDER_ID: &str = "custom";
const DIRECT_PROVIDER_NAME: &str = "OpenAI";

#[derive(Clone, Copy, Debug)]
struct CodexPreferences {
    goal_mode: bool,
    remote_compaction: bool,
    common_config_enabled: bool,
}

impl Default for CodexPreferences {
    fn default() -> Self {
        Self {
            goal_mode: true,
            remote_compaction: true,
            common_config_enabled: false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalGatewaySnapshot {
    original_config: Option<String>,
    original_auth: Option<String>,
    managed_config: Option<String>,
    managed_auth: Option<String>,
}

pub(crate) fn status(state: &AppState) -> Result<CodexIntegrationStatus, String> {
    let preferences = load_codex_preferences(state)?;
    Ok(CodexIntegrationStatus {
        preserve_official_login: preserve_official_login(state)?,
        config_directory: codex_directory()?.display().to_string(),
        goal_mode: preferences.goal_mode,
        remote_compaction: preferences.remote_compaction,
        common_config_enabled: preferences.common_config_enabled,
        common_config_snippet: load_common_config_snippet(state)?.unwrap_or_default(),
    })
}

pub(crate) fn current_relay_credentials() -> Result<Option<(String, Option<String>)>, String> {
    let directory = codex_directory()?;
    let config = read_optional(&directory.join("config.toml"))?;
    let auth = read_optional(&directory.join("auth.json"))?;
    Ok(active_relay_credentials_from_contents(&config, &auth))
}

pub(crate) async fn active_relay_status(
    state: &AppState,
) -> Result<Option<ActiveCodexRelayStatus>, String> {
    let Some((relay_url, relay_key)) = current_relay_credentials()? else {
        return Ok(None);
    };
    let relay_root = station_base(&relay_url);
    let managed_station = {
        state
            .store
            .lock()
            .map_err(|_| "Local database is unavailable".to_string())?
            .list_stations()?
            .into_iter()
            .find(|station| station_base(&station.base_url) == relay_root)
    };
    if let Some(station) = managed_station {
        let balance_result =
            match fetch_config_balance(state, &relay_url, relay_key.as_deref()).await {
                Ok(balance) => Ok(balance),
                Err(config_error) => {
                    fetch_station_balance(state, &station)
                        .await
                        .map_err(|session_error| {
                            format!("{config_error}；登录会话查询失败：{session_error}")
                        })
                }
            };
        let (balance, balance_error) = match balance_result {
            Ok(balance) => (balance, None),
            Err(error) => (None, Some(error)),
        };
        return Ok(Some(ActiveCodexRelayStatus {
            name: station.name,
            balance,
            balance_error,
        }));
    }

    let balance_result = fetch_config_balance(state, &relay_url, relay_key.as_deref()).await;
    let page = state
        .client
        .get(&relay_root)
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .ok();
    let name = match page {
        Some(response) => response
            .text()
            .await
            .ok()
            .and_then(|html| title_from_html(&html)),
        None => None,
    };
    Ok(name.map(|name| {
        let (balance, balance_error) = match balance_result {
            Ok(balance) => (balance, None),
            Err(error) => (None, Some(error)),
        };
        ActiveCodexRelayStatus {
            name,
            balance,
            balance_error,
        }
    }))
}

/// Returns the active local Codex relay credentials for an in-process transfer.
/// The secret never crosses the frontend boundary.
pub(crate) fn local_relay_credentials() -> Result<(String, String), String> {
    let directory = codex_directory()?;
    let config = read_optional(&directory.join("config.toml"))?;
    let auth = read_optional(&directory.join("auth.json"))?;
    local_relay_credentials_from_contents(&config, &auth)
}

fn local_relay_credentials_from_contents(
    config: &str,
    auth: &str,
) -> Result<(String, String), String> {
    let (relay_url, config_key) =
        active_relay_credentials(config).ok_or("本地 Codex 尚未配置可用的中转站")?;
    let auth_key = active_relay_env_key(config)
        .as_deref()
        .and_then(|env_key| auth_json_api_key(auth, env_key))
        .or_else(|| auth_json_api_key(auth, "OPENAI_API_KEY"));
    let relay_key = config_key
        .filter(|value| !value.trim_start().starts_with('$'))
        .or(auth_key)
        .filter(|value| !value.trim().is_empty())
        .ok_or("本地 Codex 中转配置没有可用的 API 密钥")?;
    Ok((relay_url, relay_key))
}

async fn fetch_config_balance(
    state: &AppState,
    base_url: &str,
    api_key: Option<&str>,
) -> Result<Option<f64>, String> {
    let base_url = base_url.trim_end_matches('/').to_string();
    let api_key = api_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or("当前 config.toml 没有 API 密钥，无法查询余额".to_string())?;
    // The generic balance probe queries `/v1/usage` and reads the returned
    // `remaining`/`balance` field. Preserve a configured `/v1` path so
    // providers that already include it do not receive `/v1/v1/usage`.
    let usage_path = if base_url.ends_with("/v1") {
        "/usage"
    } else {
        "/v1/usage"
    };
    let api_base = base_url
        .strip_suffix("/v1")
        .unwrap_or(&base_url)
        .trim_end_matches('/');
    let endpoints = [
        (format!("{base_url}{usage_path}"), "/v1/usage", false),
        (format!("{api_base}/api/user/self"), "/api/user/self", true),
        (
            format!("{api_base}/api/v1/user/profile"),
            "/api/v1/user/profile",
            false,
        ),
        (format!("{api_base}/user/balance"), "/user/balance", false),
        (
            format!("{api_base}/api/user/balance"),
            "/api/user/balance",
            false,
        ),
        (
            format!("{api_base}/api/v1/user/balance"),
            "/api/v1/user/balance",
            false,
        ),
    ];
    let mut last_error = None;
    for (url, path, newapi) in endpoints {
        let response = state
            .client
            .get(url)
            .bearer_auth(api_key)
            .header("Content-Type", "application/json")
            .timeout(Duration::from_secs(10))
            .send()
            .await
            .map_err(|error| format!("余额请求失败：{error}"))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| format!("余额响应读取失败：{error}"))?;
        let Ok(value) = serde_json::from_str::<Value>(&body) else {
            last_error = Some(format!(
                "余额接口 {path} 返回了非 JSON 数据（HTTP {status}）"
            ));
            continue;
        };
        if !status.is_success() {
            last_error = Some(format!("余额接口 {path} 返回 HTTP {status}"));
            continue;
        }
        let balance = if newapi {
            newapi_display_balance(&value, None)
        } else {
            parse_balance(&value)
        };
        if balance.is_some() {
            return Ok(balance);
        }
        last_error = Some(format!("余额接口 {path} 未返回可识别的余额字段"));
    }
    Err(last_error.unwrap_or_else(|| "余额接口不可用".into()))
}

async fn fetch_station_balance(state: &AppState, station: &Station) -> Result<Option<f64>, String> {
    let adapter = StationAdapter::for_station(station)?;
    let mut secret = load_authenticated_secret(state, station).await?;
    let profile = station_request(
        state,
        station,
        &mut secret,
        Method::GET,
        adapter.profile_path(),
        None,
    )
    .await?;
    if adapter == StationAdapter::NewApi {
        return Ok(newapi_display_balance(&profile, None));
    }
    Ok(parse_balance(&profile))
}

pub(crate) fn set_preserve_official_login(
    state: &AppState,
    preserve_official_login: bool,
) -> Result<CodexIntegrationStatus, String> {
    state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .save_setting(
            PRESERVE_OFFICIAL_AUTH_SETTING,
            &preserve_official_login.to_string(),
        )?;
    status(state)
}

pub(crate) async fn set_codex_preferences(
    state: &AppState,
    goal_mode: bool,
    remote_compaction: bool,
    common_config_enabled: bool,
) -> Result<CodexIntegrationStatus, String> {
    {
        let store = state
            .store
            .lock()
            .map_err(|_| "Local database is unavailable".to_string())?;
        store.save_setting(CODEX_GOAL_MODE_SETTING, &goal_mode.to_string())?;
        store.save_setting(
            CODEX_REMOTE_COMPACTION_SETTING,
            &remote_compaction.to_string(),
        )?;
        store.save_setting(
            CODEX_COMMON_CONFIG_ENABLED_SETTING,
            &common_config_enabled.to_string(),
        )?;
    }
    refresh_active_config_preferences(state).await?;
    status(state)
}

pub(crate) async fn set_common_config_snippet(
    state: &AppState,
    snippet: String,
) -> Result<CodexIntegrationStatus, String> {
    validate_common_config_snippet(&snippet)?;
    state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .save_setting(CODEX_COMMON_CONFIG_SETTING, &snippet)?;
    refresh_active_config_preferences(state).await?;
    status(state)
}

async fn refresh_active_config_preferences(state: &AppState) -> Result<(), String> {
    match current_routing_mode(state)? {
        RoutingMode::LocalGateway => {
            let runtime = state.gateway.runtime_snapshot().await;
            if runtime.routes.is_empty() {
                return Ok(());
            }
            activate_local_gateway(
                state,
                &format!("http://127.0.0.1:{}/v1", runtime.port),
                &runtime.token,
            )?;
        }
        RoutingMode::CcSwitch => {
            let directory = codex_directory()?;
            let config_path = directory.join("config.toml");
            let config = read_optional(&config_path)?;
            let auth = read_optional(&directory.join("auth.json"))?;
            let Some((endpoint, Some(api_key))) =
                active_relay_credentials_from_contents(&config, &auth)
            else {
                return Ok(());
            };
            let model = config.parse::<toml::Value>().ok().and_then(|value| {
                value
                    .get("model")
                    .and_then(toml::Value::as_str)
                    .map(str::to_string)
            });
            let provider_name = active_provider_display_name(&config)
                .unwrap_or_else(|| DIRECT_PROVIDER_NAME.to_string());
            let preserve_login =
                should_preserve_official_login_for_mode(state, RoutingMode::CcSwitch)?;
            apply_raw_with_preserve_login(
                state,
                &provider_name,
                &endpoint,
                &api_key,
                model.as_deref(),
                preserve_login,
            )?;
        }
    }
    Ok(())
}

fn load_codex_preferences(state: &AppState) -> Result<CodexPreferences, String> {
    Ok(CodexPreferences {
        goal_mode: stored_bool(state, CODEX_GOAL_MODE_SETTING, true)?,
        remote_compaction: stored_bool(state, CODEX_REMOTE_COMPACTION_SETTING, true)?,
        common_config_enabled: stored_bool(state, CODEX_COMMON_CONFIG_ENABLED_SETTING, false)?,
    })
}

fn stored_bool(state: &AppState, key: &str, default: bool) -> Result<bool, String> {
    Ok(state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .setting(key)?
        .map(|value| value == "true")
        .unwrap_or(default))
}

fn load_common_config_snippet(state: &AppState) -> Result<Option<String>, String> {
    Ok(state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .setting(CODEX_COMMON_CONFIG_SETTING)?
        .filter(|value| !value.trim().is_empty()))
}

fn validate_common_config_snippet(snippet: &str) -> Result<(), String> {
    if snippet.trim().is_empty() {
        return Ok(());
    }
    snippet
        .parse::<DocumentMut>()
        .map(|_| ())
        .map_err(|error| format!("Invalid Codex common config TOML: {error}"))
}

pub(crate) fn activate_local_gateway(
    state: &AppState,
    base_url: &str,
    gateway_token: &str,
) -> Result<(), String> {
    let directory = codex_directory()?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    let config_path = directory.join("config.toml");
    let auth_path = directory.join("auth.json");
    let current_config = read_file_state(&config_path)?;
    let current_auth = read_file_state(&auth_path)?;
    let existing = load_local_gateway_snapshot(state)?;

    let snapshot = if let Some(snapshot) = existing {
        if current_config != snapshot.managed_config || current_auth != snapshot.managed_auth {
            eprintln!(
                "[codex-config] accepting file changes while activating local gateway; current files may be replaced by the active route"
            );
        }
        snapshot
    } else {
        LocalGatewaySnapshot {
            original_config: current_config.clone(),
            original_auth: current_auth.clone(),
            managed_config: current_config.clone(),
            managed_auth: current_auth.clone(),
        }
    };

    let source = current_config.as_deref().unwrap_or_default();
    let preferences = load_codex_preferences(state)?;
    let common_config = load_common_config_snippet(state)?;
    let next_config = build_local_gateway_config_with_preferences(
        source,
        base_url,
        gateway_token,
        &preferences,
        common_config.as_deref(),
    )?;
    write_file_state(&config_path, Some(&next_config))?;
    let next_snapshot = LocalGatewaySnapshot {
        managed_config: Some(next_config),
        managed_auth: current_auth,
        ..snapshot
    };
    save_local_gateway_snapshot(state, &next_snapshot)
}

/// Applies a direct station route to Codex. Direct mode keeps the same
/// provider shape as local routing, but authenticates with the station key.
pub(crate) fn activate_direct_route(
    state: &AppState,
    provider_name: &str,
    endpoint: &str,
    api_key: &str,
    target_mode: RoutingMode,
) -> Result<(), String> {
    let directory = codex_directory()?;
    apply_to_directory_with_backup(
        &directory,
        provider_name,
        endpoint,
        api_key,
        should_preserve_official_login_for_mode(state, target_mode)?,
        None,
        &load_codex_preferences(state)?,
        load_common_config_snippet(state)?.as_deref(),
    )?;
    Ok(())
}

pub(crate) fn restore_local_gateway(state: &AppState) -> Result<(), String> {
    let Some(snapshot) = load_local_gateway_snapshot(state)? else {
        return Ok(());
    };
    let directory = codex_directory()?;
    let config_path = directory.join("config.toml");
    let auth_path = directory.join("auth.json");
    let current_config = read_file_state(&config_path)?;
    let current_auth = read_file_state(&auth_path)?;
    let has_manual_changes =
        current_config != snapshot.managed_config || current_auth != snapshot.managed_auth;
    if has_manual_changes {
        eprintln!(
            "[codex-config] accepting manual changes while leaving local gateway; current files are kept instead of being overwritten"
        );
    }
    let restore_config = if has_manual_changes {
        current_config
    } else {
        snapshot.original_config
    };
    let restore_auth = if has_manual_changes {
        current_auth
    } else {
        snapshot.original_auth
    };
    write_file_state(&config_path, restore_config.as_deref())?;
    write_file_state(&auth_path, restore_auth.as_deref())?;
    clear_local_gateway_snapshot(state)
}

fn fresh_codex_document(source: &DocumentMut) -> DocumentMut {
    let mut document = DocumentMut::new();
    for (key, item) in source.iter() {
        if matches!(
            key,
            "model_provider"
                | "model"
                | "review_model"
                | "model_reasoning_effort"
                | "disable_response_storage"
                | "network_access"
                | "windows_wsl_setup_acknowledged"
                | "model_providers"
                | "experimental_bearer_token"
                | "api_key"
        ) {
            continue;
        }
        document[key] = item.clone();
    }
    document
}

fn parse_existing_codex_document(source: &str) -> DocumentMut {
    if source.trim().is_empty() {
        return DocumentMut::new();
    }

    match source.parse::<DocumentMut>() {
        Ok(document) => document,
        Err(error) => {
            eprintln!(
                "[codex-config] ignoring invalid existing config.toml while regenerating: {error}"
            );
            DocumentMut::new()
        }
    }
}

fn merge_common_config(document: &mut DocumentMut, snippet: &str) -> Result<(), String> {
    if snippet.trim().is_empty() {
        return Ok(());
    }
    let source = snippet
        .parse::<DocumentMut>()
        .map_err(|error| format!("Invalid Codex common config TOML: {error}"))?;
    merge_common_table(document.as_table_mut(), source.as_table());
    Ok(())
}

fn merge_common_table(target: &mut dyn toml_edit::TableLike, source: &dyn toml_edit::TableLike) {
    for (key, source_item) in source.iter() {
        if matches!(
            key,
            "model"
                | "model_provider"
                | "model_providers"
                | "review_model"
                | "model_reasoning_effort"
                | "disable_response_storage"
                | "network_access"
                | "windows_wsl_setup_acknowledged"
                | "experimental_bearer_token"
                | "api_key"
        ) {
            continue;
        }
        match target.get_mut(key) {
            Some(target_item) => {
                if let Some(source_table) = source_item.as_table_like() {
                    if let Some(target_table) = target_item.as_table_like_mut() {
                        merge_common_table(target_table, source_table);
                        continue;
                    }
                }
                *target_item = source_item.clone();
            }
            None => {
                target.insert(key, source_item.clone());
            }
        }
    }
}

#[cfg(test)]
fn build_local_gateway_config(
    source: &str,
    base_url: &str,
    gateway_token: &str,
) -> Result<String, String> {
    build_local_gateway_config_with_preferences(
        source,
        base_url,
        gateway_token,
        &CodexPreferences::default(),
        None,
    )
}

fn build_local_gateway_config_with_preferences(
    source: &str,
    base_url: &str,
    gateway_token: &str,
    preferences: &CodexPreferences,
    common_config: Option<&str>,
) -> Result<String, String> {
    let source_document = parse_existing_codex_document(source);
    let mut document = fresh_codex_document(&source_document);
    if preferences.common_config_enabled {
        merge_common_config(&mut document, common_config.unwrap_or_default())?;
    }
    document["model_provider"] = value(LOCAL_GATEWAY_PROVIDER);
    if document.get("model").is_none() {
        document["model"] = value(DEFAULT_MODEL);
    }
    let model = document
        .get("model")
        .and_then(Item::as_str)
        .map(str::trim)
        .filter(|model| !model.is_empty())
        .unwrap_or(DEFAULT_MODEL)
        .to_string();
    apply_codex_runtime_options(&mut document, &model, preferences.goal_mode)?;
    if document.get("model_providers").is_none() {
        document["model_providers"] = Item::Table(Table::new());
    }
    let providers = document["model_providers"]
        .as_table_mut()
        .ok_or("Codex model_providers 必须是 TOML 表")?;
    if !providers.contains_key(LOCAL_GATEWAY_PROVIDER) {
        providers[LOCAL_GATEWAY_PROVIDER] = Item::Table(Table::new());
    }
    let provider = providers[LOCAL_GATEWAY_PROVIDER]
        .as_table_mut()
        .ok_or("Codex 本地 Gateway provider 必须是 TOML 表")?;
    provider["name"] = value(if preferences.remote_compaction {
        DIRECT_PROVIDER_NAME
    } else {
        "RelayHub Local Gateway"
    });
    provider["base_url"] = value(base_url.trim_end_matches('/'));
    provider["wire_api"] = value("responses");
    provider["requires_openai_auth"] = value(true);
    provider["experimental_bearer_token"] = value(gateway_token);
    provider.remove("api_key");
    provider.remove("env_key");
    document.remove("experimental_bearer_token");
    Ok(document.to_string())
}

fn load_local_gateway_snapshot(state: &AppState) -> Result<Option<LocalGatewaySnapshot>, String> {
    let raw = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .setting(LOCAL_GATEWAY_SNAPSHOT_SETTING)?;
    raw.filter(|value| !value.trim().is_empty())
        .map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
        .transpose()
}

fn save_local_gateway_snapshot(
    state: &AppState,
    snapshot: &LocalGatewaySnapshot,
) -> Result<(), String> {
    let value = serde_json::to_string(snapshot).map_err(|error| error.to_string())?;
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_setting(LOCAL_GATEWAY_SNAPSHOT_SETTING, &value)
}

fn clear_local_gateway_snapshot(state: &AppState) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_setting(LOCAL_GATEWAY_SNAPSHOT_SETTING, "")
}

pub(crate) async fn apply_api_key(
    state: &AppState,
    station_id: String,
    key_id: String,
) -> Result<CodexIntegrationStatus, String> {
    apply_api_key_with_options(state, station_id, key_id, None, Some(DIRECT_MODEL))
        .await
        .map(|(_, status)| status)
}

pub(crate) async fn apply_api_key_with_options(
    state: &AppState,
    station_id: String,
    key_id: String,
    base_url: Option<&str>,
    model: Option<&str>,
) -> Result<(Vec<String>, CodexIntegrationStatus), String> {
    let preserve_login =
        should_preserve_official_login_for_mode(state, current_routing_mode(state)?)?;
    apply_station_api_key(state, station_id, key_id, base_url, model, preserve_login).await
}

async fn apply_station_api_key(
    state: &AppState,
    station_id: String,
    key_id: String,
    base_url: Option<&str>,
    model: Option<&str>,
    preserve_login: bool,
) -> Result<(Vec<String>, CodexIntegrationStatus), String> {
    let (station, api_key) = read_api_key(state, &station_id, &key_id).await?;
    let endpoint = base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| api_base_url(&station.base_url));
    apply_raw_with_preserve_login(
        state,
        &format!("{} - {}", station.name, key_id),
        &endpoint,
        &api_key,
        model,
        preserve_login,
    )
}

pub(crate) fn apply_raw_with_options(
    state: &AppState,
    provider_name: &str,
    endpoint: &str,
    api_key: &str,
    model: Option<&str>,
) -> Result<(Vec<String>, CodexIntegrationStatus), String> {
    let preserve_login =
        should_preserve_official_login_for_mode(state, current_routing_mode(state)?)?;
    apply_raw_with_preserve_login(
        state,
        provider_name,
        endpoint,
        api_key,
        model,
        preserve_login,
    )
}

fn apply_raw_with_preserve_login(
    state: &AppState,
    provider_name: &str,
    endpoint: &str,
    api_key: &str,
    model: Option<&str>,
    preserve_login: bool,
) -> Result<(Vec<String>, CodexIntegrationStatus), String> {
    let directory = codex_directory()?;
    let preferences = load_codex_preferences(state)?;
    let common_config = load_common_config_snippet(state)?;
    let backup_files = apply_to_directory_with_backup(
        &directory,
        provider_name,
        endpoint,
        api_key,
        preserve_login,
        model,
        &preferences,
        common_config.as_deref(),
    )?;
    Ok((backup_files, status(state)?))
}

fn preserve_official_login(state: &AppState) -> Result<bool, String> {
    Ok(state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?
        .setting(PRESERVE_OFFICIAL_AUTH_SETTING)?
        .map(|value| value != "false")
        .unwrap_or(true))
}

fn should_preserve_official_login_for_mode(
    state: &AppState,
    mode: RoutingMode,
) -> Result<bool, String> {
    Ok(preserve_official_login(state)? || matches!(mode, RoutingMode::LocalGateway))
}

fn codex_directory() -> Result<PathBuf, String> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .map(|home| home.join(".codex"))
        .ok_or("Unable to find the Codex configuration directory".to_string())
}

#[cfg(test)]
fn active_relay_url(config: &str) -> Option<String> {
    active_relay_credentials(config).map(|(url, _)| url)
}

fn active_relay_credentials(config: &str) -> Option<(String, Option<String>)> {
    let document = config.parse::<toml::Value>().ok()?;
    let root = document.as_table()?;
    let provider_name = root.get("model_provider")?.as_str()?;
    let provider = root
        .get("model_providers")?
        .as_table()?
        .get(provider_name)?
        .as_table()?;
    let url = provider.get("base_url")?.as_str()?.trim().to_string();
    if url.is_empty() {
        return None;
    }
    let key = provider
        .get("experimental_bearer_token")
        .or_else(|| provider.get("api_key"))
        .or_else(|| root.get("experimental_bearer_token"))
        .or_else(|| root.get("api_key"))
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.starts_with('$'))
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Some((url, key))
}

fn active_relay_credentials_from_contents(
    config: &str,
    auth: &str,
) -> Option<(String, Option<String>)> {
    let (relay_url, config_key) = active_relay_credentials(config)?;
    let auth_key = active_relay_env_key(config)
        .as_deref()
        .and_then(|env_key| auth_json_api_key(auth, env_key))
        .or_else(|| auth_json_api_key(auth, "OPENAI_API_KEY"));
    Some((relay_url, config_key.or(auth_key)))
}

fn active_relay_env_key(config: &str) -> Option<String> {
    let document = config.parse::<toml::Value>().ok()?;
    let root = document.as_table()?;
    let provider_name = root.get("model_provider")?.as_str()?;
    root.get("model_providers")?
        .as_table()?
        .get(provider_name)?
        .get("env_key")?
        .as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn active_provider_display_name(config: &str) -> Option<String> {
    let document = config.parse::<toml::Value>().ok()?;
    let root = document.as_table()?;
    let provider_name = root.get("model_provider")?.as_str()?;
    root.get("model_providers")?
        .as_table()?
        .get(provider_name)?
        .get("name")
        .and_then(toml::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn auth_json_api_key(auth: &str, env_key: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(auth).ok()?;
    let key = value
        .get(env_key)
        .and_then(Value::as_str)
        .or_else(|| {
            value
                .get("env")
                .and_then(|env| env.get(env_key))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            (env_key == "OPENAI_API_KEY")
                .then(|| value.get("api_key"))
                .flatten()
                .and_then(Value::as_str)
        })
        .map(str::trim)
        .filter(|key| !key.is_empty() && !key.starts_with('$'))?;
    Some(key.to_string())
}

#[cfg(test)]
fn apply_to_directory(
    directory: &Path,
    provider_name: &str,
    endpoint: &str,
    api_key: &str,
    preserve_login: bool,
) -> Result<(), String> {
    apply_to_directory_with_backup(
        directory,
        provider_name,
        endpoint,
        api_key,
        preserve_login,
        None,
        &CodexPreferences::default(),
        None,
    )
    .map(|_| ())
}

fn apply_to_directory_with_backup(
    directory: &Path,
    provider_name: &str,
    endpoint: &str,
    api_key: &str,
    preserve_login: bool,
    model: Option<&str>,
    preferences: &CodexPreferences,
    common_config: Option<&str>,
) -> Result<Vec<String>, String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let auth_path = directory.join("auth.json");
    let config_path = directory.join("config.toml");
    let backup_directory = backup_directory_for(directory);
    fs::create_dir_all(&backup_directory).map_err(|error| error.to_string())?;
    backup_once(&auth_path, &backup_directory.join("auth.json.relayhub.bak"))?;
    backup_once(
        &config_path,
        &backup_directory.join("config.toml.relayhub.bak"),
    )?;
    let mut backup_files = Vec::new();
    if let Some(path) = backup_existing_file(&auth_path)? {
        backup_files.push(path);
    }
    if let Some(path) = backup_existing_file(&config_path)? {
        backup_files.push(path);
    }

    let current_config = read_optional(&config_path)?;
    let next_config = build_config_with_preferences(
        &current_config,
        provider_name,
        endpoint,
        api_key,
        preserve_login,
        model,
        preferences,
        common_config,
    )?;
    let previous_auth = auth_path
        .exists()
        .then(|| read_optional(&auth_path))
        .transpose()?;

    if !preserve_login {
        write_text(
            &auth_path,
            &update_auth(previous_auth.as_deref().unwrap_or(""), api_key)?,
        )?;
    }
    if let Err(error) = write_text(&config_path, &next_config) {
        if !preserve_login {
            restore(&auth_path, previous_auth.as_deref())?;
        }
        return Err(error);
    }
    Ok(backup_files)
}

#[cfg(test)]
fn build_config_with_model(
    source: &str,
    provider_name: &str,
    endpoint: &str,
    api_key: &str,
    preserve_login: bool,
    model: Option<&str>,
) -> Result<String, String> {
    build_config_with_preferences(
        source,
        provider_name,
        endpoint,
        api_key,
        preserve_login,
        model,
        &CodexPreferences::default(),
        None,
    )
}

fn build_config_with_preferences(
    source: &str,
    provider_name: &str,
    endpoint: &str,
    api_key: &str,
    preserve_login: bool,
    model: Option<&str>,
    preferences: &CodexPreferences,
    common_config: Option<&str>,
) -> Result<String, String> {
    let document = parse_existing_codex_document(source);
    let mut document = fresh_codex_document(&document);
    if preferences.common_config_enabled {
        merge_common_config(&mut document, common_config.unwrap_or_default())?;
    }
    let model = model
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DIRECT_MODEL);
    document["model_provider"] = value(DIRECT_PROVIDER_ID);
    apply_codex_runtime_options(&mut document, model, preferences.goal_mode)?;

    if document.get("model_providers").is_none() {
        document["model_providers"] = Item::Table(Table::new());
    }
    let providers = document["model_providers"]
        .as_table_mut()
        .ok_or("model_providers must be a TOML table")?;
    if !providers.contains_key(DIRECT_PROVIDER_ID) {
        providers[DIRECT_PROVIDER_ID] = Item::Table(Table::new());
    }
    let provider = providers[DIRECT_PROVIDER_ID]
        .as_table_mut()
        .ok_or("model_providers.custom must be a TOML table")?;
    let fallback_name = provider_name.trim();
    provider["name"] = value(if preferences.remote_compaction {
        DIRECT_PROVIDER_NAME
    } else if fallback_name.is_empty() || fallback_name == DIRECT_PROVIDER_NAME {
        "RelayHub"
    } else {
        fallback_name
    });
    provider["base_url"] = value(endpoint.trim_end_matches('/'));
    provider["wire_api"] = value("responses");
    provider["requires_openai_auth"] = value(true);

    if preserve_login {
        provider["experimental_bearer_token"] = value(api_key);
    } else {
        provider.remove("experimental_bearer_token");
    }
    document.remove("experimental_bearer_token");
    Ok(document.to_string())
}

fn apply_codex_runtime_options(
    document: &mut DocumentMut,
    model: &str,
    goal_mode: bool,
) -> Result<(), String> {
    document["model"] = value(model);
    document["review_model"] = value(model);
    document["model_reasoning_effort"] = value("xhigh");
    document["disable_response_storage"] = value(true);
    document["network_access"] = value("enabled");
    document["windows_wsl_setup_acknowledged"] = value(true);

    if goal_mode {
        if document.get("features").and_then(Item::as_table).is_none() {
            document["features"] = Item::Table(Table::new());
        }
        let features = document["features"]
            .as_table_mut()
            .ok_or("Codex features must be a TOML table")?;
        features["goals"] = value(true);
    } else {
        let remove_features = match document.get_mut("features") {
            Some(features) => match features.as_table_mut() {
                Some(features) => {
                    features.remove("goals");
                    features.is_empty()
                }
                None => true,
            },
            None => false,
        };
        if remove_features {
            document.remove("features");
        }
    }
    Ok(())
}

fn update_auth(source: &str, api_key: &str) -> Result<String, String> {
    let mut auth = if source.trim().is_empty() {
        Map::new()
    } else {
        serde_json::from_str::<Value>(source)
            .map_err(|error| format!("Invalid Codex auth.json: {error}"))?
            .as_object()
            .cloned()
            .ok_or("Codex auth.json must be a JSON object")?
    };
    auth.insert("OPENAI_API_KEY".into(), Value::String(api_key.into()));
    serde_json::to_string_pretty(&Value::Object(auth)).map_err(|error| error.to_string())
}

fn read_optional(path: &Path) -> Result<String, String> {
    if path.exists() {
        fs::read_to_string(path).map_err(|error| error.to_string())
    } else {
        Ok(String::new())
    }
}

fn read_file_state(path: &Path) -> Result<Option<String>, String> {
    if path.exists() {
        fs::read_to_string(path)
            .map(Some)
            .map_err(|error| error.to_string())
    } else {
        Ok(None)
    }
}

fn write_file_state(path: &Path, contents: Option<&str>) -> Result<(), String> {
    match contents {
        Some(contents) => fs::write(path, contents).map_err(|error| error.to_string()),
        None if path.exists() => fs::remove_file(path).map_err(|error| error.to_string()),
        None => Ok(()),
    }
}

fn backup_once(source: &Path, backup: &Path) -> Result<(), String> {
    if source.exists() && !backup.exists() {
        fs::copy(source, backup).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn write_text(path: &Path, contents: &str) -> Result<(), String> {
    fs::write(path, contents).map_err(|error| error.to_string())
}

fn restore(path: &Path, source: Option<&str>) -> Result<(), String> {
    match source {
        Some(contents) => write_text(path, contents),
        None if path.exists() => fs::remove_file(path).map_err(|error| error.to_string()),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        active_relay_credentials, active_relay_credentials_from_contents, active_relay_url,
        apply_to_directory, build_config_with_model, build_config_with_preferences,
        build_local_gateway_config, local_relay_credentials_from_contents, CodexPreferences,
        LocalGatewaySnapshot,
    };

    #[test]
    fn reads_the_active_provider_url_from_codex_config() {
        let config = r#"
model_provider = "custom"

[model_providers.unused]
base_url = "https://unused.example/v1"

[model_providers.custom]
base_url = "https://relay.example/v1"
"#;

        assert_eq!(
            active_relay_url(config).as_deref(),
            Some("https://relay.example/v1")
        );
    }

    #[test]
    fn ignores_config_without_an_active_relay_url() {
        assert_eq!(
            active_relay_url("model_provider = \"openai\"\n[model_providers.custom]\nbase_url = \"https://relay.example/v1\""),
            None
        );
        assert_eq!(active_relay_url("not valid toml = ["), None);
    }

    #[test]
    fn reads_the_active_provider_api_key_for_balance_queries() {
        let config = r#"
model_provider = "custom"
experimental_bearer_token = "sk-root"

[model_providers.custom]
base_url = "https://relay.example/v1"
experimental_bearer_token = "sk-provider"
"#;

        assert_eq!(
            active_relay_credentials(config),
            Some((
                "https://relay.example/v1".into(),
                Some("sk-provider".into())
            ))
        );
    }

    #[test]
    fn resolves_the_active_provider_api_key_from_auth_json() {
        let config = r#"
model_provider = "custom"

[model_providers.custom]
base_url = "https://relay.example/v1"
env_key = "CUSTOM_API_KEY"
"#;
        let auth = r#"{"env":{"CUSTOM_API_KEY":"sk-from-auth"}}"#;

        assert_eq!(
            active_relay_credentials_from_contents(config, auth),
            Some((
                "https://relay.example/v1".into(),
                Some("sk-from-auth".into())
            ))
        );
    }

    #[test]
    fn reads_the_local_api_key_from_the_active_provider_environment_name() {
        let config = r#"
model_provider = "custom"

[model_providers.custom]
base_url = "https://relay.example/v1"
env_key = "CUSTOM_API_KEY"
"#;
        let auth = r#"{"env":{"CUSTOM_API_KEY":"sk-from-auth"}}"#;

        assert_eq!(
            local_relay_credentials_from_contents(config, auth).unwrap(),
            ("https://relay.example/v1".into(), "sk-from-auth".into())
        );
    }

    #[test]
    fn falls_back_from_an_environment_placeholder_to_auth_json() {
        let config = r#"
model_provider = "custom"
experimental_bearer_token = "$OPENAI_API_KEY"

[model_providers.custom]
base_url = "https://relay.example/v1"
"#;
        let auth = r#"{"OPENAI_API_KEY":"sk-from-auth"}"#;

        assert_eq!(
            local_relay_credentials_from_contents(config, auth).unwrap(),
            ("https://relay.example/v1".into(), "sk-from-auth".into())
        );
    }

    #[test]
    fn preserves_official_auth_and_uses_a_config_scoped_token() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(
            directory.path().join("auth.json"),
            r#"{"tokens":{"access_token":"official"}}"#,
        )
        .unwrap();
        std::fs::write(
            directory.path().join("config.toml"),
            "[mcp_servers.files]\ncommand = \"node\"\n",
        )
        .unwrap();

        apply_to_directory(
            directory.path(),
            "Relay",
            "https://relay.test/v1",
            "sk-relay",
            true,
        )
        .unwrap();

        let auth = std::fs::read_to_string(directory.path().join("auth.json")).unwrap();
        let config = std::fs::read_to_string(directory.path().join("config.toml")).unwrap();
        assert!(auth.contains("official"));
        assert!(config.contains("experimental_bearer_token = \"sk-relay\""));
        assert!(config.contains("[mcp_servers.files]"));
        assert!(config.contains("[model_providers.custom]"));
    }

    #[test]
    fn writes_the_key_to_auth_when_login_preservation_is_disabled() {
        let directory = tempfile::tempdir().unwrap();

        apply_to_directory(
            directory.path(),
            "Relay",
            "https://relay.test/v1",
            "sk-relay",
            false,
        )
        .unwrap();

        let auth = std::fs::read_to_string(directory.path().join("auth.json")).unwrap();
        let config = std::fs::read_to_string(directory.path().join("config.toml")).unwrap();
        let auth: serde_json::Value = serde_json::from_str(&auth).unwrap();
        let config = config.parse::<toml::Value>().unwrap();
        let provider = config["model_providers"]["custom"].as_table().unwrap();

        assert_eq!(auth["OPENAI_API_KEY"], "sk-relay");
        assert_eq!(config["model_provider"].as_str(), Some("custom"));
        assert_eq!(config["model"].as_str(), Some("gpt-5.5"));
        assert_eq!(config["review_model"].as_str(), Some("gpt-5.5"));
        assert_eq!(config["model_reasoning_effort"].as_str(), Some("xhigh"));
        assert_eq!(config["disable_response_storage"].as_bool(), Some(true));
        assert_eq!(config["network_access"].as_str(), Some("enabled"));
        assert_eq!(
            config["windows_wsl_setup_acknowledged"].as_bool(),
            Some(true)
        );
        assert_eq!(config["features"]["goals"].as_bool(), Some(true));
        assert_eq!(provider["name"].as_str(), Some("OpenAI"));
        assert_eq!(provider["base_url"].as_str(), Some("https://relay.test/v1"));
        assert_eq!(provider["wire_api"].as_str(), Some("responses"));
        assert_eq!(provider["requires_openai_auth"].as_bool(), Some(true));
        assert!(config.get("experimental_bearer_token").is_none());
    }

    #[test]
    fn builds_a_fresh_provider_config_when_switching_modes() {
        let initial = r#"
model_provider = "custom"
notify = ["turn-ended"]

[mcp_servers.shared]
command = "shared-command"

[model_providers.custom]
name = "Existing relay"
base_url = "https://existing.example/v1"
experimental_bearer_token = "sk-old"

[model_providers.OpenAI]
name = "OpenAI"
base_url = "https://direct.example/v1"
wire_api = "responses"
requires_openai_auth = true

[model_providers.relayhub]
name = "Legacy RelayHub"
base_url = "https://legacy.example/v1"

[model_providers.relayhub_local]
name = "RelayHub Local Gateway"
base_url = "http://127.0.0.1:18765/v1"
wire_api = "responses"
requires_openai_auth = true
"#;

        let direct = build_config_with_model(
            initial,
            "ignored",
            "https://direct.example/v1",
            "sk-direct",
            false,
            Some("gpt-5.5"),
        )
        .unwrap();
        let direct_value = direct.parse::<toml::Value>().unwrap();
        let direct_providers = direct_value["model_providers"].as_table().unwrap();
        assert_eq!(direct_value["model_provider"].as_str(), Some("custom"));
        assert!(direct_value.get("notify").is_some());
        assert!(direct_providers.contains_key("custom"));
        assert_eq!(direct_providers.len(), 1);

        let local =
            build_local_gateway_config(&direct, "http://127.0.0.1:18765/v1", "rh-test-token")
                .unwrap();
        let local_value = local.parse::<toml::Value>().unwrap();
        let local_providers = local_value["model_providers"].as_table().unwrap();
        assert_eq!(
            local_value["model_provider"].as_str(),
            Some("relayhub_local")
        );
        assert!(!local_providers.contains_key("custom"));
        assert!(local_providers.contains_key("relayhub_local"));
        assert_eq!(local_providers.len(), 1);
        assert_eq!(local_value["features"]["goals"].as_bool(), Some(true));
        assert_eq!(
            local_providers["relayhub_local"]["name"].as_str(),
            Some("OpenAI")
        );
        assert_eq!(
            local_value["mcp_servers"]["shared"]["command"].as_str(),
            Some("shared-command")
        );

        let direct_again = build_config_with_model(
            &local,
            "ignored",
            "https://direct.example/v1",
            "sk-direct-again",
            false,
            Some("gpt-5.5"),
        )
        .unwrap();
        let direct_again_value = direct_again.parse::<toml::Value>().unwrap();
        let direct_again_providers = direct_again_value["model_providers"].as_table().unwrap();
        assert_eq!(
            direct_again_value["model_provider"].as_str(),
            Some("custom")
        );
        assert!(direct_again_providers.contains_key("custom"));
        assert_eq!(direct_again_providers.len(), 1);
    }

    #[test]
    fn applies_common_config_and_optional_codex_features_without_reintroducing_routes() {
        let preferences = CodexPreferences {
            goal_mode: false,
            remote_compaction: false,
            common_config_enabled: true,
        };
        let config = build_config_with_preferences(
            "model_provider = \"custom\"\n\n[model_providers.old]\nname = \"old\"\n",
            "Station Alpha",
            "https://relay.example/v1",
            "sk-relay",
            true,
            Some("gpt-5.5"),
            &preferences,
            Some("[tui]\nnotifications = true\n\n[features]\nother = true\n"),
        )
        .unwrap();
        let value = config.parse::<toml::Value>().unwrap();

        assert_eq!(value["tui"]["notifications"].as_bool(), Some(true));
        assert_eq!(value["features"]["other"].as_bool(), Some(true));
        assert!(value["features"].get("goals").is_none());
        assert_eq!(
            value["model_providers"]["custom"]["name"].as_str(),
            Some("Station Alpha")
        );
        assert!(!value["model_providers"]
            .as_table()
            .unwrap()
            .contains_key("old"));
    }

    #[test]
    fn regenerates_standard_config_when_existing_config_is_invalid_or_conflicting() {
        let direct = build_config_with_model(
            "model_provider = \"old\"\n[broken",
            "Station Alpha",
            "https://relay.example/v1",
            "sk-relay",
            true,
            Some("gpt-5.5"),
        )
        .unwrap();
        let direct_value = direct.parse::<toml::Value>().unwrap();
        assert_eq!(direct_value["model_provider"].as_str(), Some("custom"));
        assert_eq!(direct_value["features"]["goals"].as_bool(), Some(true));
        assert_eq!(direct_value["model_providers"].as_table().unwrap().len(), 1);

        let local = build_local_gateway_config(
            "features = 3\n\n[model_providers.old]\nbase_url = \"https://old.example/v1\"",
            "http://127.0.0.1:18765/v1",
            "rh-token",
        )
        .unwrap();
        let local_value = local.parse::<toml::Value>().unwrap();
        assert_eq!(local_value["features"]["goals"].as_bool(), Some(true));
        assert!(!local_value["model_providers"]
            .as_table()
            .unwrap()
            .contains_key("old"));
    }

    #[test]
    fn keeps_the_original_restore_baseline_when_managed_files_change() {
        let snapshot = LocalGatewaySnapshot {
            original_config: Some("original config".into()),
            original_auth: Some("original auth".into()),
            managed_config: Some("managed config".into()),
            managed_auth: Some("managed auth".into()),
        };
        let current_config = Some("manual config".into());
        let current_auth = Some("manual auth".into());

        assert_ne!(current_config, snapshot.managed_config);
        assert_ne!(current_auth, snapshot.managed_auth);
        assert_eq!(snapshot.original_config.as_deref(), Some("original config"));
        assert_eq!(snapshot.original_auth.as_deref(), Some("original auth"));
    }
}
