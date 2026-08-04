use std::{
    env, fs,
    path::{Path, PathBuf},
    time::Duration,
};

use reqwest::Method;
use serde_json::{Map, Value};
use toml_edit::{value, DocumentMut, Item, Table};

use crate::{
    services::{
        api_keys::read_api_key,
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
const DEFAULT_MODEL: &str = "gpt-5-codex";

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
    // CC Switch's generic balance script queries `/v1/usage` and reads the
    // returned `remaining`/`balance` field. Preserve a configured `/v1` path
    // so providers that already include it do not receive `/v1/v1/usage`.
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

pub(crate) async fn apply_api_key(
    state: &AppState,
    station_id: String,
    key_id: String,
) -> Result<CodexIntegrationStatus, String> {
    let (station, api_key) = read_api_key(state, &station_id, &key_id).await?;
    let directory = codex_directory()?;
    let preserve_login = preserve_official_login(state)?
        || matches!(current_routing_mode(state)?, RoutingMode::LocalGateway);
    apply_to_directory(
        &directory,
        &format!("{} - {}", station.name, key_id),
        &api_base_url(&station.base_url),
        &api_key,
        preserve_login,
    )?;
    status(state)
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
        .filter(|value| !value.is_empty())
        .map(str::to_string);
    Some((url, key))
}

fn apply_to_directory(
    directory: &Path,
    provider_name: &str,
    endpoint: &str,
    api_key: &str,
    preserve_login: bool,
) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let auth_path = directory.join("auth.json");
    let config_path = directory.join("config.toml");
    backup_once(&auth_path, &directory.join("auth.json.relayhub.bak"))?;
    backup_once(&config_path, &directory.join("config.toml.relayhub.bak"))?;

    let current_config = read_optional(&config_path)?;
    let next_config = build_config(
        &current_config,
        provider_name,
        endpoint,
        api_key,
        preserve_login,
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
    Ok(())
}

fn build_config(
    source: &str,
    provider_name: &str,
    endpoint: &str,
    api_key: &str,
    preserve_login: bool,
) -> Result<String, String> {
    let mut document = if source.trim().is_empty() {
        DocumentMut::new()
    } else {
        source
            .parse::<DocumentMut>()
            .map_err(|error| format!("Invalid Codex config.toml: {error}"))?
    };
    document["model_provider"] = value("relayhub");
    if document.get("model").is_none() {
        document["model"] = value(DEFAULT_MODEL);
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
    use super::{active_relay_credentials, active_relay_url, apply_to_directory};

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
