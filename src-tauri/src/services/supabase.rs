use reqwest::header::{self, HeaderMap, HeaderValue};
use serde::de::DeserializeOwned;

use crate::keyring_store::CloudSession;

pub(crate) struct SupabaseConfig {
    pub(crate) url: String,
    pub(crate) anon_key: String,
}

fn parse_environment_value(content: &str, key: &str) -> Option<String> {
    content
        .lines()
        .find_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                return None;
            }
            let (name, value) = line.split_once('=')?;
            (name.trim() == key).then(|| value.trim().trim_matches('"').to_string())
        })
        .filter(|value| !value.is_empty())
}

fn local_environment_value(key: &str) -> Option<String> {
    let content = std::fs::read_to_string(".env.local")
        .ok()
        .or_else(|| std::fs::read_to_string("../.env.local").ok())?;
    parse_environment_value(&content, key)
}

fn bundled_environment_value(key: &str) -> Option<String> {
    parse_environment_value(include_str!("../../supabase.env"), key)
}

pub(crate) fn config() -> Result<SupabaseConfig, String> {
    let url = std::env::var("SUPABASE_URL")
        .ok()
        .or_else(|| local_environment_value("SUPABASE_URL"))
        .or_else(|| bundled_environment_value("SUPABASE_URL"))
        .unwrap_or_default();
    let anon_key = std::env::var("SUPABASE_ANON_KEY")
        .ok()
        .or_else(|| local_environment_value("SUPABASE_ANON_KEY"))
        .or_else(|| bundled_environment_value("SUPABASE_ANON_KEY"))
        .unwrap_or_default();
    if url.trim().is_empty() || anon_key.trim().is_empty() {
        return Err("Supabase is not configured. Set SUPABASE_URL and SUPABASE_ANON_KEY.".into());
    }
    Ok(SupabaseConfig {
        url: url.trim_end_matches('/').to_string(),
        anon_key,
    })
}

fn header_value(value: &str) -> Result<HeaderValue, String> {
    value.parse::<HeaderValue>().map_err(|error| error.to_string())
}

pub(crate) fn auth_headers(config: &SupabaseConfig) -> Result<HeaderMap, String> {
    let mut headers = HeaderMap::new();
    headers.insert(
        header::HeaderName::from_static("apikey"),
        header_value(&config.anon_key)?,
    );
    Ok(headers)
}

pub(crate) fn session_headers(
    config: &SupabaseConfig,
    session: &CloudSession,
) -> Result<HeaderMap, String> {
    let mut headers = auth_headers(config)?;
    headers.insert(
        header::AUTHORIZATION,
        header_value(&format!("Bearer {}", session.access_token))?,
    );
    Ok(headers)
}

pub(crate) fn postgrest_headers(
    config: &SupabaseConfig,
    session: &CloudSession,
) -> Result<HeaderMap, String> {
    let mut headers = session_headers(config, session)?;
    headers.insert(
        header::ACCEPT,
        HeaderValue::from_static("application/json"),
    );
    Ok(headers)
}

pub(crate) fn public_postgrest_headers(config: &SupabaseConfig) -> Result<HeaderMap, String> {
    let mut headers = auth_headers(config)?;
    headers.insert(
        header::AUTHORIZATION,
        header_value(&format!("Bearer {}", config.anon_key))?,
    );
    headers.insert(
        header::ACCEPT,
        HeaderValue::from_static("application/json"),
    );
    Ok(headers)
}

pub(crate) fn storage_headers(
    config: &SupabaseConfig,
    session: &CloudSession,
) -> Result<HeaderMap, String> {
    session_headers(config, session)
}

pub(crate) async fn response_json<T: DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T, String> {
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        return Err(format!("Supabase request failed ({status}): {body}"));
    }
    serde_json::from_str(&body).map_err(|error| error.to_string())
}

pub(crate) async fn ensure_success(response: reqwest::Response) -> Result<(), String> {
    if response.status().is_success() {
        return Ok(());
    }
    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    Err(format!("Supabase request failed ({status}): {body}"))
}

#[cfg(test)]
mod tests {
    use super::parse_environment_value;

    #[test]
    fn parses_environment_values_and_ignores_comments() {
        let content = r#"
            # ignored
            SUPABASE_URL = "https://example.test/"
            EMPTY=
        "#;

        assert_eq!(
            parse_environment_value(content, "SUPABASE_URL"),
            Some("https://example.test/".into())
        );
        assert_eq!(parse_environment_value(content, "EMPTY"), None);
    }
}
