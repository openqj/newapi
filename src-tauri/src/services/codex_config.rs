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
        client_backup::backup_existing_file,
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
const LOCAL_GATEWAY_PROVIDER: &str = "relayhub_local";
const DEFAULT_MODEL: &str = "gpt-5-codex";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalGatewaySnapshot {
    original_config: Option<String>,
    original_auth: Option<String>,
    managed_config: Option<String>,
    managed_auth: Option<String>,
}

pub(crate) fn status(state: &AppState) -> Result<CodexIntegrationStatus, String> {
    Ok(CodexIntegrationStatus {
        preserve_official_login: preserve_official_login(state)?,
        config_directory: codex_directory()?.display().to_string(),
    })
}

pub(crate) async fn active_relay_status(
    state: &AppState,
) -> Result<Option<ActiveCodexRelayStatus>, String> {
    let config = read_optional(&codex_directory()?.join("config.toml"))?;
    let Some((relay_url, relay_key)) = active_relay_credentials(&config) else {
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
            return Err(
                "检测到 Codex 配置在本地路由接管期间被手动修改，请先恢复或确认配置后再切换模式"
                    .into(),
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
    let next_config = build_local_gateway_config(source, base_url, gateway_token)?;
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
    provider_name: &str,
    endpoint: &str,
    api_key: &str,
) -> Result<(), String> {
    let directory = codex_directory()?;
    apply_to_directory_with_backup(&directory, provider_name, endpoint, api_key, false, None)?;
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
    if current_config != snapshot.managed_config || current_auth != snapshot.managed_auth {
        return Err(
                "检测到 Codex 配置在本地路由接管期间被手动修改，未覆盖用户文件；请先检查 config.toml 和 auth.json"
                .into(),
        );
    }
    write_file_state(&config_path, snapshot.original_config.as_deref())?;
    write_file_state(&auth_path, snapshot.original_auth.as_deref())?;
    clear_local_gateway_snapshot(state)
}

fn build_local_gateway_config(
    source: &str,
    base_url: &str,
    gateway_token: &str,
) -> Result<String, String> {
    let mut document = if source.trim().is_empty() {
        DocumentMut::new()
    } else {
        source
            .parse::<DocumentMut>()
            .map_err(|error| format!("Codex config.toml 格式无效: {error}"))?
    };
    document["model_provider"] = value(LOCAL_GATEWAY_PROVIDER);
    if document.get("model").is_none() {
        document["model"] = value(DEFAULT_MODEL);
    }
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
    provider["name"] = value("RelayHub Local Gateway");
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
    apply_api_key_with_options(state, station_id, key_id, None, None)
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
    let (station, api_key) = read_api_key(state, &station_id, &key_id).await?;
    let endpoint = base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| api_base_url(&station.base_url));
    apply_raw_with_options(
        state,
        &format!("{} - {}", station.name, key_id),
        &endpoint,
        &api_key,
        model,
    )
}

pub(crate) fn apply_raw_with_options(
    state: &AppState,
    provider_name: &str,
    endpoint: &str,
    api_key: &str,
    model: Option<&str>,
) -> Result<(Vec<String>, CodexIntegrationStatus), String> {
    let directory = codex_directory()?;
    let preserve_login = preserve_official_login(state)?
        || matches!(current_routing_mode(state)?, RoutingMode::LocalGateway);
    let backup_files = apply_to_directory_with_backup(
        &directory,
        provider_name,
        endpoint,
        api_key,
        preserve_login,
        model,
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
) -> Result<Vec<String>, String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let auth_path = directory.join("auth.json");
    let config_path = directory.join("config.toml");
    backup_once(&auth_path, &directory.join("auth.json.relayhub.bak"))?;
    backup_once(&config_path, &directory.join("config.toml.relayhub.bak"))?;
    let mut backup_files = Vec::new();
    if let Some(path) = backup_existing_file(&auth_path)? {
        backup_files.push(path);
    }
    if let Some(path) = backup_existing_file(&config_path)? {
        backup_files.push(path);
    }

    let current_config = read_optional(&config_path)?;
    let next_config = build_config_with_model(
        &current_config,
        provider_name,
        endpoint,
        api_key,
        preserve_login,
        model,
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

fn build_config_with_model(
    source: &str,
    provider_name: &str,
    endpoint: &str,
    api_key: &str,
    preserve_login: bool,
    model: Option<&str>,
) -> Result<String, String> {
    let mut document = if source.trim().is_empty() {
        DocumentMut::new()
    } else {
        source
            .parse::<DocumentMut>()
            .map_err(|error| format!("Invalid Codex config.toml: {error}"))?
    };
    document["model_provider"] = value("relayhub");
    match model.map(str::trim).filter(|value| !value.is_empty()) {
        Some(model) => document["model"] = value(model),
        None if document.get("model").is_none() => document["model"] = value(DEFAULT_MODEL),
        None => {}
    }
    if document.get("model_reasoning_effort").is_none() {
        document["model_reasoning_effort"] = value("high");
    }
    document["disable_response_storage"] = value(true);

    if document.get("model_providers").is_none() {
        document["model_providers"] = Item::Table(Table::new());
    }
    let providers = document["model_providers"]
        .as_table_mut()
        .ok_or("model_providers must be a TOML table")?;
    if !providers.contains_key("relayhub") {
        providers["relayhub"] = Item::Table(Table::new());
    }
    let provider = providers["relayhub"]
        .as_table_mut()
        .ok_or("model_providers.relayhub must be a TOML table")?;
    provider["name"] = value(provider_name);
    provider["base_url"] = value(endpoint.trim_end_matches('/'));
    provider["wire_api"] = value("responses");
    provider["requires_openai_auth"] = value(true);

    if preserve_login {
        document["experimental_bearer_token"] = value(api_key);
    } else {
        document.remove("experimental_bearer_token");
    }
    Ok(document.to_string())
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
        active_relay_credentials, active_relay_url, apply_to_directory,
        local_relay_credentials_from_contents,
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
        assert!(config.contains("[model_providers.relayhub]"));
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
        assert!(auth.contains("OPENAI_API_KEY"));
        assert!(auth.contains("sk-relay"));
        assert!(!config.contains("experimental_bearer_token"));
    }
}
