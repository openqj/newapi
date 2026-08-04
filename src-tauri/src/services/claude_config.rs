use std::{
    env, fs,
    path::{Path, PathBuf},
};

use serde_json::{Map, Value};

use crate::{
    services::{api_keys::read_api_key, client_backup::backup_existing_file},
    support::api_base_url,
    AppState,
};

const SETTINGS_FILE: &str = "settings.json";

pub(crate) async fn apply_api_key(
    state: &AppState,
    station_id: String,
    key_id: String,
) -> Result<(), String> {
    apply_api_key_with_options(state, station_id, key_id, None, None)
        .await
        .map(|_| ())
}

pub(crate) async fn apply_api_key_with_options(
    state: &AppState,
    station_id: String,
    key_id: String,
    base_url: Option<&str>,
    model: Option<&str>,
) -> Result<Vec<String>, String> {
    let (station, api_key) = read_api_key(state, &station_id, &key_id).await?;
    let endpoint = base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| api_base_url(&station.base_url));
    apply_raw_with_options(&endpoint, &api_key, model)
}

pub(crate) fn apply_raw_with_options(
    endpoint: &str,
    api_key: &str,
    model: Option<&str>,
) -> Result<Vec<String>, String> {
    apply_to_directory_with_backup(&claude_directory()?, endpoint, api_key, model)
}

fn claude_directory() -> Result<PathBuf, String> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .map(|home| home.join(".claude"))
        .ok_or("Unable to find the Claude Code configuration directory".to_string())
}

#[cfg(test)]
fn apply_to_directory(directory: &Path, endpoint: &str, api_key: &str) -> Result<(), String> {
    apply_to_directory_with_backup(directory, endpoint, api_key, None).map(|_| ())
}

fn apply_to_directory_with_backup(
    directory: &Path,
    endpoint: &str,
    api_key: &str,
    model: Option<&str>,
) -> Result<Vec<String>, String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let settings_path = directory.join(SETTINGS_FILE);
    backup_once(
        &settings_path,
        &directory.join("settings.json.relayhub.bak"),
    )?;
    let mut backup_files = Vec::new();
    if let Some(path) = backup_existing_file(&settings_path)? {
        backup_files.push(path);
    }

    let source = read_optional(&settings_path)?;
    let next = build_settings_with_model(&source, endpoint, api_key, model)?;
    fs::write(&settings_path, next).map_err(|error| error.to_string())?;
    Ok(backup_files)
}

fn build_settings_with_model(
    source: &str,
    endpoint: &str,
    api_key: &str,
    model: Option<&str>,
) -> Result<String, String> {
    let mut settings = if source.trim().is_empty() {
        Value::Object(Map::new())
    } else {
        serde_json::from_str::<Value>(source)
            .map_err(|error| format!("Invalid Claude Code settings.json: {error}"))?
    };
    let root = settings
        .as_object_mut()
        .ok_or("Claude Code settings.json must be a JSON object")?;
    let env = root
        .entry("env".to_string())
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or("Claude Code settings.json env must be a JSON object")?;

    env.insert(
        "ANTHROPIC_BASE_URL".to_string(),
        Value::String(endpoint.trim_end_matches('/').to_string()),
    );
    env.insert(
        "ANTHROPIC_AUTH_TOKEN".to_string(),
        Value::String(api_key.to_string()),
    );
    if let Some(model) = model.map(str::trim).filter(|value| !value.is_empty()) {
        env.insert(
            "ANTHROPIC_MODEL".to_string(),
            Value::String(model.to_string()),
        );
    }

    serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())
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

#[cfg(test)]
mod tests {
    use super::apply_to_directory;

    #[test]
    fn applies_relay_credentials_without_discarding_existing_settings() {
        let directory = tempfile::tempdir().unwrap();
        let settings_path = directory.path().join("settings.json");
        std::fs::write(
            &settings_path,
            r#"{
  "permissions": { "allow": ["Bash(git status:*)"] },
  "env": {
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"
  }
}"#,
        )
        .unwrap();

        apply_to_directory(directory.path(), "https://relay.example/v1/", "relay-key").unwrap();

        let settings: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(&settings_path).unwrap()).unwrap();
        assert_eq!(settings["permissions"]["allow"][0], "Bash(git status:*)");
        assert_eq!(
            settings["env"]["ANTHROPIC_BASE_URL"],
            "https://relay.example/v1"
        );
        assert_eq!(settings["env"]["ANTHROPIC_AUTH_TOKEN"], "relay-key");
        assert_eq!(
            settings["env"]["CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC"],
            "1"
        );
        assert!(directory.path().join("settings.json.relayhub.bak").exists());
    }

    #[test]
    fn rejects_non_object_settings() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::write(directory.path().join("settings.json"), "[]").unwrap();

        let error = apply_to_directory(directory.path(), "https://relay.example/v1", "relay-key")
            .unwrap_err();

        assert_eq!(error, "Claude Code settings.json must be a JSON object");
    }
}
