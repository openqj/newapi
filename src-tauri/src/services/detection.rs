use std::time::{Duration, Instant};

use reqwest::Client;
use serde_json::{json, Value};

use crate::{
    models::{ModelDetectionCheck, ModelTestResult},
    services::stations::{model_response_text, response_error_message},
    station_adapter::Station,
    support::api_base_url,
};

pub(crate) async fn discover_models(
    client: &Client,
    endpoint: &str,
    api_key: &str,
) -> Result<Vec<String>, String> {
    let response = client
        .get(format!("{}/models", api_base_url(endpoint)))
        .bearer_auth(api_key)
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|error| format!("模型列表请求失败：{error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取模型列表响应失败：{error}"))?;
    if !status.is_success() {
        return Err(format!("HTTP {status}：{}", response_error_message(&body)));
    }
    let value = serde_json::from_str::<Value>(&body)
        .map_err(|_| "模型列表接口未返回 JSON 响应".to_string())?;
    let models = model_ids(&value);
    if models.is_empty() {
        return Err("模型列表接口未返回可用模型 ID".into());
    }
    Ok(models)
}

pub(crate) async fn test_model(
    client: &Client,
    station: &Station,
    key: &str,
    model: &str,
    test_mode: &str,
) -> Result<ModelTestResult, String> {
    let model = model.trim();
    if !matches!(test_mode, "chat" | "responses") {
        return Err("不支持的测试模式".into());
    }
    if test_mode == "chat" {
        return test_streaming_chat_model(client, station, key, model).await;
    }
    test_streaming_responses_model(client, station, key, model).await
}

async fn test_streaming_responses_model(
    client: &Client,
    station: &Station,
    key: &str,
    model: &str,
) -> Result<ModelTestResult, String> {
    let started = Instant::now();
    let mut response = client
        .post(format!("{}/responses", api_base_url(&station.base_url)))
        .bearer_auth(key)
        .json(&json!({
            "model": model,
            "input": "hi",
            "max_output_tokens": 32,
            "stream": true,
        }))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|error| format!("Responses streaming request failed: {error}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .map_err(|error| format!("Reading Responses error response failed: {error}"))?;
        return Err(format!(
            "Model test failed ({status}): {}",
            response_error_message(&body)
        ));
    }

    let mut pending = String::new();
    let mut output = String::new();
    let mut first_token_ms = None;
    let mut final_event = None;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("Reading Responses stream failed: {error}"))?
    {
        pending.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(newline) = pending.find('\n') {
            let line = pending[..newline].trim_end_matches('\r').trim().to_string();
            pending.drain(..=newline);
            let Some(data) = line.strip_prefix("data:").map(str::trim) else {
                continue;
            };
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            if let Some(error) = stream_error(&event) {
                return Err(format!("Responses stream returned an error: {error}"));
            }
            if let Some(text) = responses_stream_text(&event) {
                if !text.is_empty() {
                    first_token_ms.get_or_insert_with(|| started.elapsed().as_millis() as u64);
                    output.push_str(&text);
                }
            }
            final_event = Some(event);
        }
    }
    if let Some(data) = pending.trim().strip_prefix("data:").map(str::trim) {
        if let Ok(event) = serde_json::from_str::<Value>(data) {
            if let Some(error) = stream_error(&event) {
                return Err(format!("Responses stream returned an error: {error}"));
            }
            if let Some(text) = responses_stream_text(&event) {
                if !text.is_empty() {
                    first_token_ms.get_or_insert_with(|| started.elapsed().as_millis() as u64);
                    output.push_str(&text);
                }
            }
            final_event = Some(event);
        }
    }
    if output.is_empty() {
        return Err("Responses stream ended without output text".into());
    }

    let elapsed_ms = started.elapsed().as_millis() as u64;
    let final_event = final_event.unwrap_or(Value::Null);
    let (input_tokens, output_tokens, cache_read_tokens) = usage(&final_event);
    Ok(ModelTestResult {
        model: model.to_string(),
        available: true,
        protocol: "openai-responses-stream".into(),
        response: Some(output),
        error: None,
        elapsed_ms,
        first_token_ms,
        tokens_per_second: (elapsed_ms > 0 && output_tokens > 0)
            .then(|| output_tokens as f64 / (elapsed_ms as f64 / 1000.0)),
        input_tokens: (input_tokens > 0).then_some(input_tokens),
        output_tokens: (output_tokens > 0).then_some(output_tokens),
        cache_read_tokens: (cache_read_tokens > 0).then_some(cache_read_tokens),
        cost: model_response_cost(&final_event),
    })
}

/// Chat Completions has a well-defined SSE format. Measure TTFT only after a
/// parsed content delta arrives; receiving headers, a role-only delta, or an
/// arbitrary proxy byte must not be presented as a model first token.
async fn test_streaming_chat_model(
    client: &Client,
    station: &Station,
    key: &str,
    model: &str,
) -> Result<ModelTestResult, String> {
    let started = Instant::now();
    let mut response = client
        .post(format!(
            "{}/chat/completions",
            api_base_url(&station.base_url)
        ))
        .bearer_auth(key)
        .json(&json!({
            "model": model,
            "messages": [{"role": "user", "content": "hi"}],
            "max_tokens": 32,
            "temperature": 0,
            "stream": true,
            "stream_options": {"include_usage": true},
        }))
        .timeout(Duration::from_secs(20))
        .send()
        .await
        .map_err(|error| format!("模型流式测试请求失败：{error}"))?;
    let status = response.status();
    if !status.is_success() {
        let body = response
            .text()
            .await
            .map_err(|error| format!("读取模型测试响应失败：{error}"))?;
        return Err(format!(
            "模型测试失败 ({status})：{}",
            response_error_message(&body)
        ));
    }

    let mut pending = String::new();
    let mut output = String::new();
    let mut first_token_ms = None;
    let mut final_event = None;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| format!("读取模型流式响应失败：{error}"))?
    {
        pending.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(newline) = pending.find('\n') {
            let line = pending[..newline].trim_end_matches('\r').trim().to_string();
            pending.drain(..=newline);
            let Some(data) = line.strip_prefix("data:").map(str::trim) else {
                continue;
            };
            if data == "[DONE]" || data.is_empty() {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            if let Some(error) = stream_error(&event) {
                return Err(format!("Chat stream returned an error: {error}"));
            }
            if let Some(text) = stream_delta_text(&event) {
                if !text.is_empty() {
                    first_token_ms.get_or_insert_with(|| started.elapsed().as_millis() as u64);
                    output.push_str(&text);
                }
            }
            final_event = Some(event);
        }
    }
    // A final event may arrive without a trailing newline from a nonconforming
    // relay. It can provide usage, but never establishes TTFT retroactively.
    if let Some(data) = pending.trim().strip_prefix("data:").map(str::trim) {
        if let Ok(event) = serde_json::from_str::<Value>(data) {
            if let Some(error) = stream_error(&event) {
                return Err(format!("Chat stream returned an error: {error}"));
            }
            final_event = Some(event);
        }
    }
    if output.is_empty() {
        return Err("Chat stream ended without output text".into());
    }
    let elapsed_ms = started.elapsed().as_millis() as u64;
    let final_event = final_event.unwrap_or(Value::Null);
    let (input_tokens, output_tokens, cache_read_tokens) = usage(&final_event);
    Ok(ModelTestResult {
        model: model.to_string(),
        available: true,
        protocol: "openai-chat-stream".into(),
        response: Some(output),
        error: None,
        elapsed_ms,
        first_token_ms,
        tokens_per_second: (elapsed_ms > 0 && output_tokens > 0)
            .then(|| output_tokens as f64 / (elapsed_ms as f64 / 1000.0)),
        input_tokens: (input_tokens > 0).then_some(input_tokens),
        output_tokens: (output_tokens > 0).then_some(output_tokens),
        cache_read_tokens: (cache_read_tokens > 0).then_some(cache_read_tokens),
        cost: model_response_cost(&final_event),
    })
}

fn stream_delta_text(event: &Value) -> Option<String> {
    let content = event
        .get("choices")?
        .as_array()?
        .first()?
        .get("delta")?
        .get("content")?;
    match content {
        Value::String(text) => Some(text.clone()),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .or_else(|| part.get("content"))
                    .and_then(Value::as_str)
            })
            .map(str::to_owned)
            .reduce(|mut text, part| {
                text.push_str(&part);
                text
            }),
        _ => None,
    }
}

/// The documented Responses events carry text in `delta`. A few compatible
/// relays emit only `response.output_text.done`, where `text` is still useful
/// evidence of a completed model response.
fn responses_stream_text(event: &Value) -> Option<String> {
    let event_type = event.get("type").and_then(Value::as_str)?;
    if matches!(
        event_type,
        "response.output_text.delta" | "response.output_text.done"
    ) {
        return event
            .get("delta")
            .or_else(|| event.get("text"))
            .and_then(Value::as_str)
            .map(str::to_owned);
    }
    None
}

fn stream_error(event: &Value) -> Option<String> {
    let error = event.get("error").or_else(|| {
        (event.get("type").and_then(Value::as_str) == Some("error")).then_some(event)
    })?;
    match error {
        Value::String(message) => Some(message.clone()),
        Value::Object(_) => error
            .get("message")
            .or_else(|| error.get("error"))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| Some("station returned an SSE error event".into())),
        _ => Some("station returned an SSE error event".into()),
    }
}

pub(crate) fn model_response_cost(value: &Value) -> Option<f64> {
    [
        value.get("cost"),
        value.get("total_cost"),
        value.get("usage").and_then(|usage| usage.get("cost")),
        value.get("usage").and_then(|usage| usage.get("total_cost")),
    ]
    .into_iter()
    .flatten()
    .find_map(Value::as_f64)
}

pub(crate) fn model_ids(value: &Value) -> Vec<String> {
    let items = value
        .get("data")
        .or_else(|| value.get("models"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten();
    let mut models = items
        .filter_map(|item| match item {
            Value::String(id) => Some(id.as_str()),
            Value::Object(_) => item
                .get("id")
                .or_else(|| item.get("model"))
                .and_then(Value::as_str),
            _ => None,
        })
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    models.sort_unstable();
    models.dedup();
    models
}

pub(crate) async fn request(
    client: &Client,
    endpoint: &str,
    api_key: &str,
    model: &str,
    protocol: &str,
    prompt: &str,
) -> Result<(Value, String), String> {
    let base_url = api_base_url(endpoint);
    let request = if protocol == "anthropic" {
        client
            .post(format!("{base_url}/messages"))
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&json!({"model": model, "max_tokens": 96, "temperature": 0, "messages": [{"role": "user", "content": prompt}]}))
    } else {
        client
            .post(format!("{base_url}/chat/completions"))
            .bearer_auth(api_key)
            .json(&json!({"model": model, "max_tokens": 96, "temperature": 0, "messages": [{"role": "user", "content": prompt}]}))
    };
    let response = request
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|error| format!("读取响应失败：{error}"))?;
    if !status.is_success() {
        return Err(format!("HTTP {status}：{}", response_error_message(&body)));
    }
    let value =
        serde_json::from_str::<Value>(&body).map_err(|_| "接口返回的不是 JSON 响应".to_string())?;
    let text =
        model_response_text(&value).ok_or("接口成功响应，但未找到模型输出文本".to_string())?;
    Ok((value, text))
}

pub(crate) fn check(
    name: &str,
    status: &str,
    detail: impl Into<String>,
    trace: Option<String>,
) -> ModelDetectionCheck {
    ModelDetectionCheck {
        name: name.into(),
        status: status.into(),
        detail: detail.into(),
        trace,
    }
}

pub(crate) fn usage(value: &Value) -> (i64, i64, i64) {
    let usage = value
        .get("usage")
        .or_else(|| {
            value
                .get("response")
                .and_then(|response| response.get("usage"))
        })
        .unwrap_or(value);
    let count = |names: &[&str]| {
        names
            .iter()
            .find_map(|name| usage.get(*name).and_then(Value::as_i64))
            .unwrap_or(0)
    };
    let cache_read = usage
        .get("prompt_tokens_details")
        .and_then(|details| details.get("cached_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or_else(|| count(&["cache_read_input_tokens", "cache_read_tokens"]));
    (
        count(&["input_tokens", "prompt_tokens"]),
        count(&["output_tokens", "completion_tokens"]),
        cache_read,
    )
}

pub(crate) fn score(checks: &[ModelDetectionCheck]) -> u8 {
    checks
        .iter()
        .map(|check| match check.status.as_str() {
            "pass" => 25,
            "warning" => 13,
            _ => 0,
        })
        .sum()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        check, model_ids, responses_stream_text, score, stream_delta_text, stream_error, usage,
    };
    use crate::models::ModelDetectionRequest;

    #[test]
    fn discovers_openai_style_model_ids_and_deduplicates_them() {
        let payload = json!({
            "data": [
                { "id": "gpt-4o" },
                { "id": " claude-sonnet " },
                { "id": "gpt-4o" },
                { "object": "model" },
                "custom-model"
            ]
        });

        assert_eq!(
            model_ids(&payload),
            vec!["claude-sonnet", "custom-model", "gpt-4o"]
        );
    }

    #[test]
    fn accepts_common_models_array_fallback() {
        assert_eq!(
            model_ids(&json!({ "models": [{ "model": "gpt-4.1" }] })),
            vec!["gpt-4.1"]
        );
    }

    #[test]
    fn extracts_only_actual_content_deltas_for_ttft() {
        assert_eq!(
            stream_delta_text(&json!({"choices": [{"delta": {"role": "assistant"}}]})),
            None
        );
        assert_eq!(
            stream_delta_text(&json!({"choices": [{"delta": {"content": "hello"}}]})),
            Some("hello".into())
        );
    }

    #[test]
    fn extracts_responses_sse_text_and_rejects_sse_errors() {
        assert_eq!(
            responses_stream_text(&json!({
                "type": "response.output_text.delta",
                "delta": "hello"
            })),
            Some("hello".into())
        );
        assert_eq!(
            responses_stream_text(&json!({
                "type": "response.created",
                "response": { "id": "resp_123" }
            })),
            None
        );
        assert_eq!(
            stream_error(&json!({ "type": "error", "message": "invalid model" })),
            Some("invalid model".into())
        );
    }

    #[test]
    fn reads_usage_from_responses_completed_event() {
        assert_eq!(
            usage(&json!({
                "type": "response.completed",
                "response": { "usage": { "input_tokens": 5, "output_tokens": 3 } }
            })),
            (5, 3, 0)
        );
    }

    #[test]
    fn scores_detection_checks_consistently() {
        let checks = vec![
            check("one", "pass", "", None),
            check("two", "warning", "", None),
            check("three", "fail", "", None),
        ];
        assert_eq!(score(&checks), 38);
    }

    #[test]
    fn accepts_saved_key_detection_without_manual_secret_fields() {
        let request = serde_json::from_value::<ModelDetectionRequest>(json!({
            "model": "gpt-4o",
            "protocol": "openai",
            "stationId": "station-1",
            "keyId": "key-1"
        }))
        .expect("saved key request should deserialize");
        assert!(request.endpoint.is_empty());
        assert!(request.api_key.is_empty());
        assert_eq!(request.station_id.as_deref(), Some("station-1"));
        assert_eq!(request.key_id.as_deref(), Some("key-1"));
    }
}
