use std::time::Instant;

use tauri::State;
use url::Url;

use crate::services::detection::{
    check as detection_check, request as detection_request, score as detection_score, test_model,
    usage as detection_usage,
};
use crate::{
    model_discovery_store::ModelDiscoveryStore, services::api_keys::read_api_key,
    services::detection::discover_models, support::now, AppState, ModelDetectionRequest,
    ModelDetectionResult, ModelDiscoveryResult, ModelTestResult, Value,
};

const MODEL_CACHE_FRESH_FOR_SECONDS: i64 = 60 * 60;

#[tauri::command]
pub(crate) async fn test_api_models(
    state: State<'_, AppState>,
    station_id: String,
    key_id: String,
    models: Vec<String>,
    test_mode: String,
) -> Result<Vec<ModelTestResult>, String> {
    if models.is_empty() || models.len() > 50 {
        return Err("请选择 1 至 50 个要测试的模型".into());
    }
    if models.iter().any(|model| model.trim().is_empty()) {
        return Err("模型名称不能为空".into());
    }
    if !matches!(test_mode.as_str(), "chat" | "responses") {
        return Err("不支持的测试模式".into());
    }
    let (station, key) = read_api_key(&state, &station_id, &key_id).await?;
    let mut workers = tokio::task::JoinSet::new();
    for (position, model) in models.into_iter().enumerate() {
        let client = state.client.clone();
        let station = station.clone();
        let key = key.clone();
        let mode = test_mode.clone();
        workers.spawn(async move {
            let started = Instant::now();
            let result = test_model(&client, &station, &key, &model, &mode)
                .await
                .unwrap_or_else(|error| ModelTestResult {
                    model,
                    available: false,
                    protocol: format!("openai-{mode}"),
                    response: None,
                    error: Some(error),
                    elapsed_ms: started.elapsed().as_millis() as u64,
                    first_token_ms: None,
                    tokens_per_second: None,
                    input_tokens: None,
                    output_tokens: None,
                    cache_read_tokens: None,
                    cost: None,
                });
            (position, result)
        });
    }
    let mut indexed_results = Vec::with_capacity(workers.len());
    while let Some(result) = workers.join_next().await {
        match result {
            Ok(result) => indexed_results.push(result),
            Err(error) => return Err(format!("模型测试任务异常结束：{error}")),
        }
    }
    indexed_results.sort_by_key(|(position, _)| *position);
    let results = indexed_results
        .into_iter()
        .map(|(_, result)| result)
        .collect();
    Ok(results)
}

#[tauri::command]
pub(crate) async fn discover_api_models(
    state: State<'_, AppState>,
    station_id: String,
    key_id: String,
    force_refresh: Option<bool>,
) -> Result<ModelDiscoveryResult, String> {
    let started = Instant::now();
    let cached = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .load_model_discovery_cache(&station_id, &key_id)?;
    if !force_refresh.unwrap_or(false) {
        if let Some((models, fetched_at)) = cached.as_ref() {
            if now().saturating_sub(*fetched_at) <= MODEL_CACHE_FRESH_FOR_SECONDS {
                return Ok(ModelDiscoveryResult {
                    models: models.clone(),
                    elapsed_ms: started.elapsed().as_millis() as u64,
                    fetched_at: Some(*fetched_at),
                    from_cache: true,
                    error: None,
                });
            }
        }
    }
    let (station, key) = read_api_key(&state, &station_id, &key_id).await?;
    match discover_models(&state.client, &station.base_url, &key).await {
        Ok(models) => {
            let fetched_at = now();
            state
                .store
                .lock()
                .map_err(|_| "本地数据库不可用".to_string())?
                .save_model_discovery_cache(&station_id, &key_id, &models, fetched_at)?;
            Ok(ModelDiscoveryResult {
                models,
                elapsed_ms: started.elapsed().as_millis() as u64,
                fetched_at: Some(fetched_at),
                from_cache: false,
                error: None,
            })
        }
        Err(error) => {
            let (models, fetched_at) = cached.unwrap_or_default();
            Ok(ModelDiscoveryResult {
                models,
                elapsed_ms: started.elapsed().as_millis() as u64,
                fetched_at: (fetched_at > 0).then_some(fetched_at),
                from_cache: false,
                error: Some(error),
            })
        }
    }
}

#[tauri::command]
pub(crate) async fn detect_model_authenticity(
    state: State<'_, AppState>,
    request: ModelDetectionRequest,
) -> Result<ModelDetectionResult, String> {
    let (endpoint, api_key) = match (request.station_id.as_deref(), request.key_id.as_deref()) {
        (Some(station_id), Some(key_id)) => {
            let (station, key) = read_api_key(&state, station_id, key_id).await?;
            (station.base_url, key)
        }
        (None, None) => (request.endpoint, request.api_key),
        _ => return Err("已保存的 API Key 需要同时提供站点和密钥标识".into()),
    };
    let endpoint = endpoint.trim();
    let api_key = api_key.trim();
    let model = request.model.trim();
    if endpoint.is_empty() || api_key.is_empty() || model.is_empty() {
        return Err("请填写接口地址、API Key 和目标模型".into());
    }
    if endpoint.len() > 2048 || api_key.len() > 4096 || model.len() > 256 {
        return Err("检测参数长度不正确".into());
    }
    let parsed =
        Url::parse(endpoint).map_err(|_| "接口地址必须是完整的 http(s) URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("接口地址仅支持 http 或 https".into());
    }
    if !matches!(request.protocol.as_str(), "openai" | "anthropic") {
        return Err("不支持的接口协议".into());
    }

    let started = Instant::now();
    let mut checks = Vec::with_capacity(4);
    let mut input_tokens = 0;
    let mut output_tokens = 0;
    let mut cache_read_tokens = 0;
    let protocol_prompt = "Reply with exactly this text and nothing else: relayhub-probe-ok";
    let first = detection_request(
        &state.client,
        endpoint,
        api_key,
        model,
        &request.protocol,
        protocol_prompt,
    )
    .await;
    let first_text = match first {
        Ok((response, text)) => {
            let (input, output, cache_read) = detection_usage(&response);
            input_tokens += input;
            output_tokens += output;
            cache_read_tokens += cache_read;
            let status = if text.trim().eq_ignore_ascii_case("relayhub-probe-ok") {
                "pass"
            } else {
                "warning"
            };
            checks.push(detection_check(
                "协议响应",
                status,
                if status == "pass" {
                    "请求格式与受支持协议一致"
                } else {
                    "接口可响应，但未严格遵循探针格式"
                },
                Some(text.chars().take(300).collect()),
            ));
            text
        }
        Err(error) => {
            checks.push(detection_check(
                "协议响应",
                "fail",
                "接口请求未完成",
                Some(error),
            ));
            return Ok(ModelDetectionResult {
                score: 0,
                checks,
                elapsed_ms: started.elapsed().as_millis() as u64,
                tokens_per_second: 0.0,
                input_tokens,
                output_tokens,
                cache_read_tokens,
            });
        }
    };

    let structure_prompt = "Return exactly one JSON object with these values: {\"service\":\"relayhub\",\"value\":17}. Do not use markdown.";
    match detection_request(
        &state.client,
        endpoint,
        api_key,
        model,
        &request.protocol,
        structure_prompt,
    )
    .await
    {
        Ok((response, text)) => {
            let (input, output, cache_read) = detection_usage(&response);
            input_tokens += input;
            output_tokens += output;
            cache_read_tokens += cache_read;
            let valid = serde_json::from_str::<Value>(text.trim())
                .ok()
                .is_some_and(|value| {
                    value.get("service").and_then(Value::as_str) == Some("relayhub")
                        && value.get("value").and_then(Value::as_i64) == Some(17)
                });
            checks.push(detection_check(
                "结构一致性",
                if valid { "pass" } else { "warning" },
                if valid {
                    "受控 JSON 响应符合预期"
                } else {
                    "响应有效，但未严格匹配受控结构"
                },
                Some(text.chars().take(300).collect()),
            ));
        }
        Err(error) => checks.push(detection_check(
            "结构一致性",
            "fail",
            "结构探针失败",
            Some(error),
        )),
    }

    let identity_prompt = "State the model family you are serving in one short phrase. Do not make up a provider name.";
    match detection_request(
        &state.client,
        endpoint,
        api_key,
        model,
        &request.protocol,
        identity_prompt,
    )
    .await
    {
        Ok((response, text)) => {
            let (input, output, cache_read) = detection_usage(&response);
            input_tokens += input;
            output_tokens += output;
            cache_read_tokens += cache_read;
            let expected = model.to_ascii_lowercase();
            let family = ["claude", "gpt", "gemini", "deepseek", "qwen", "llama"]
                .iter()
                .find(|name| expected.contains(**name));
            let matches = family.is_some_and(|name| text.to_ascii_lowercase().contains(name));
            checks.push(detection_check(
                "身份信号",
                if matches { "pass" } else { "warning" },
                if matches {
                    "模型自述与目标模型家族一致"
                } else {
                    "模型自述无法确认目标家族"
                },
                Some(text.chars().take(300).collect()),
            ));
        }
        Err(error) => checks.push(detection_check(
            "身份信号",
            "fail",
            "身份探针失败",
            Some(error),
        )),
    }

    let stability_prompt = "Reply with exactly this text and nothing else: relayhub-stable-42";
    match detection_request(
        &state.client,
        endpoint,
        api_key,
        model,
        &request.protocol,
        stability_prompt,
    )
    .await
    {
        Ok((response, text)) => {
            let (input, output, cache_read) = detection_usage(&response);
            input_tokens += input;
            output_tokens += output;
            cache_read_tokens += cache_read;
            let stable = first_text.trim().eq_ignore_ascii_case("relayhub-probe-ok")
                && text.trim().eq_ignore_ascii_case("relayhub-stable-42");
            checks.push(detection_check(
                "受控输出",
                if stable { "pass" } else { "warning" },
                if stable {
                    "两次确定性探针均符合预期"
                } else {
                    "模型可用，但受控输出不稳定"
                },
                Some(text.chars().take(300).collect()),
            ));
        }
        Err(error) => checks.push(detection_check(
            "受控输出",
            "fail",
            "稳定性探针失败",
            Some(error),
        )),
    }

    let score = detection_score(&checks);
    let elapsed_ms = started.elapsed().as_millis() as u64;
    let tokens_per_second = if elapsed_ms == 0 {
        0.0
    } else {
        output_tokens as f64 / (elapsed_ms as f64 / 1000.0)
    };
    Ok(ModelDetectionResult {
        score,
        checks,
        elapsed_ms,
        tokens_per_second,
        input_tokens,
        output_tokens,
        cache_read_tokens,
    })
}
