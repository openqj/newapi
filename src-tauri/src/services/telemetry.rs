use reqwest::Client;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::Duration;

use super::supabase::{config, public_postgrest_headers};

fn endpoint_url() -> Result<String, String> {
    if let Ok(value) = std::env::var("RELAYHUB_TELEMETRY_URL") {
        let value = value.trim().trim_end_matches('/');
        if !value.is_empty() {
            return Ok(value.to_string());
        }
    }
    let config = config()?;
    Ok(format!("{}/rest/v1/detection_events", config.url))
}

pub(crate) fn endpoint_hash(endpoint: &str) -> String {
    let canonical = endpoint.trim().to_ascii_lowercase();
    let digest = Sha256::digest(canonical.as_bytes());
    format!("sha256:{digest:x}")
}

fn validate_payload(value: &Value) -> Result<(), String> {
    const BLOCKED_FIELDS: &[&str] = &[
        "api_key",
        "apikey",
        "authorization",
        "prompt",
        "response",
        "request_id",
        "request_ids",
        "trace",
        "headers",
    ];
    match value {
        Value::Object(object) => {
            for (key, value) in object {
                if BLOCKED_FIELDS.contains(&key.to_ascii_lowercase().as_str()) {
                    return Err(format!("telemetry payload contains blocked field: {key}"));
                }
                validate_payload(value)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                validate_payload(value)?;
            }
        }
        Value::String(value)
            if value.to_ascii_lowercase().contains("bearer ") || value.starts_with("sk-") =>
        {
            return Err("telemetry payload appears to contain a credential".into());
        }
        _ => {}
    }
    Ok(())
}

pub(crate) async fn report(client: &Client, payload: Value) -> Result<(), String> {
    validate_payload(&payload)?;
    let url = endpoint_url()?;
    let config = config()?;
    let mut headers = public_postgrest_headers(&config)?;
    headers.insert(
        "prefer",
        reqwest::header::HeaderValue::from_static("return=minimal"),
    );
    let response = client
        .post(url)
        .headers(headers)
        .json(&payload)
        .timeout(Duration::from_secs(8))
        .send()
        .await
        .map_err(|error| format!("telemetry request failed: {error}"))?;
    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!("telemetry server returned {}", response.status()))
    }
}

#[cfg(test)]
mod tests {
    use super::{endpoint_hash, validate_payload};
    use serde_json::json;

    #[test]
    fn endpoint_hash_is_stable_and_does_not_contain_input() {
        let hash = endpoint_hash("https://example.com/v1");
        assert_eq!(hash, endpoint_hash("HTTPS://EXAMPLE.COM/V1"));
        assert!(!hash.contains("example.com"));
    }

    #[test]
    fn telemetry_rejects_credentials_and_raw_content() {
        assert!(validate_payload(&json!({"api_key": "secret"})).is_err());
        assert!(validate_payload(&json!({"nested": {"authorization": "Bearer secret"}})).is_err());
        assert!(validate_payload(&json!({"checks": [{"status": "pass"}]})).is_ok());
    }
}
