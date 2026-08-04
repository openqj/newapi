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
const ENV_FILE: &str = ".env";

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
    apply_to_directory(&gemini_directory()?, endpoint, api_key, model)
}

fn gemini_directory() -> Result<PathBuf, String> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .map(|home| home.join(".gemini"))
        .ok_or("Unable to find the Gemini CLI configuration directory".to_string())
}

fn apply_to_directory(
    directory: &Path,
    endpoint: &str,
    api_key: &str,
    model: Option<&str>,
) -> Result<Vec<String>, String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let settings_path = directory.join(SETTINGS_FILE);
    let env_path = directory.join(ENV_FILE);
    let mut backup_files = Vec::new();
    if let Some(path) = backup_existing_file(&settings_path)? {
        backup_files.push(path);
    }
    if let Some(path) = backup_existing_file(&env_path)? {
        backup_files.push(path);
    }

    let source = read_optional(&settings_path)?;
    fs::write(&settings_path, build_settings(&source, model)?)
        .map_err(|error| error.to_string())?;
    let env_source = read_optional(&env_path)?;
    fs::write(&env_path, build_env(&env_source, endpoint, api_key, model)?)
        .map_err(|error| error.to_string())?;
    Ok(backup_files)
}

fn build_settings(source: &str, model: Option<&str>) -> Result<String, String> {
    let mut settings = if source.trim().is_empty() {
        Value::Object(Map::new())
    } else {
        serde_json::from_str::<Value>(source)
            .map_err(|error| format!("Invalid Gemini CLI settings.json: {error}"))?
    };
    let root = settings
        .as_object_mut()
        .ok_or("Gemini CLI settings.json must be a JSON object")?;
    if let Some(model) = model.map(str::trim).filter(|value| !value.is_empty()) {
        let model_config = root
            .entry("model")
            .or_insert_with(|| Value::Object(Map::new()));
        if !model_config.is_object() {
            *model_config = Value::Object(Map::new());
        }
        model_config
            .as_object_mut()
            .expect("model config is an object")
            .insert("name".into(), Value::String(model.into()));
    }
    serde_json::to_string_pretty(&settings).map_err(|error| error.to_string())
}

fn build_env(
    source: &str,
    endpoint: &str,
    api_key: &str,
    model: Option<&str>,
) -> Result<String, String> {
    let mut lines = source.lines().map(str::to_string).collect::<Vec<_>>();
    upsert_env(&mut lines, "GEMINI_API_KEY", api_key)?;
    upsert_env(
        &mut lines,
        "GOOGLE_GEMINI_BASE_URL",
        endpoint.trim_end_matches('/'),
    )?;
    if let Some(model) = model.map(str::trim).filter(|value| !value.is_empty()) {
        upsert_env(&mut lines, "GEMINI_MODEL", model)?;
    }
    let mut output = lines.join("\n");
    if !output.is_empty() {
        output.push('\n');
    }
    Ok(output)
}

fn upsert_env(lines: &mut Vec<String>, name: &str, value: &str) -> Result<(), String> {
    let line = format!(
        "{name}={}",
        serde_json::to_string(value).map_err(|error| error.to_string())?
    );
    if let Some(existing) = lines.iter_mut().find(|line| env_name(line) == Some(name)) {
        *existing = line;
    } else {
        lines.push(line);
    }
    Ok(())
}

fn env_name(line: &str) -> Option<&str> {
    let line = line.trim_start();
    if line.starts_with('#') || line.is_empty() {
        return None;
    }
    line.split_once('=').map(|(name, _)| name.trim())
}

fn read_optional(path: &Path) -> Result<String, String> {
    if path.exists() {
        fs::read_to_string(path).map_err(|error| error.to_string())
    } else {
        Ok(String::new())
    }
}

#[cfg(test)]
mod tests {
    use super::{build_env, build_settings};

    #[test]
    fn preserves_gemini_settings_and_updates_model() {
        let settings = build_settings(
            r#"{"security":{"folderTrust":{"enabled":true}}}"#,
            Some("gemini-2.5-pro"),
        )
        .unwrap();
        let settings: serde_json::Value = serde_json::from_str(&settings).unwrap();

        assert_eq!(settings["security"]["folderTrust"]["enabled"], true);
        assert_eq!(settings["model"]["name"], "gemini-2.5-pro");
    }

    #[test]
    fn preserves_custom_environment_variables() {
        let env = build_env(
            "OTHER=value\nGEMINI_API_KEY=old\n",
            "https://relay.example/v1/",
            "new-key",
            Some("gemini-2.5-pro"),
        )
        .unwrap();

        assert!(env.contains("OTHER=value"));
        assert!(env.contains("GEMINI_API_KEY=\"new-key\""));
        assert!(env.contains("GOOGLE_GEMINI_BASE_URL=\"https://relay.example/v1\""));
        assert!(env.contains("GEMINI_MODEL=\"gemini-2.5-pro\""));
    }
}
