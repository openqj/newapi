use chrono::{Datelike, Local, TimeZone};
use serde::{Serialize};
use reqwest::{header::{self, HeaderMap}, Client, Method};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{keyring_store::Secret, models::{AccountInfo, ApiKeyInfo, GroupRate, Offer, UsageLog, UsageStats}, station_adapter::{Station, StationAdapter}, support::base};

pub(crate) fn data(value: &Value) -> &Value { value.get("data").unwrap_or(value) }

pub(crate) fn number(value: &Value, names: &[&str]) -> Option<f64> { names.iter().find_map(|name| value.get(*name).and_then(Value::as_f64)) }
pub(crate) fn string(value: &Value, names: &[&str]) -> String { names.iter().find_map(|name| value.get(*name).and_then(Value::as_str)).unwrap_or_default().to_string() }
pub(crate) fn optional_string(value: &Value, names: &[&str]) -> Option<String> { names.iter().find_map(|name| value.get(*name).and_then(Value::as_str)).map(str::trim).filter(|value| !value.is_empty()).map(str::to_string) }
pub(crate) fn scalar_string(value: &Value, names: &[&str]) -> String {
    names.iter().find_map(|name| value.get(*name)).and_then(|value| match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }).unwrap_or_default()
}
pub(crate) fn optional_scalar_string(value: &Value, names: &[&str]) -> Option<String> {
    let value = scalar_string(value, names);
    (!value.trim().is_empty()).then_some(value)
}
pub(crate) fn integer(value: &Value, names: &[&str]) -> Option<i64> {
    names.iter().find_map(|name| value.get(*name).and_then(Value::as_i64).or_else(|| value.get(*name).and_then(Value::as_u64).and_then(|n| i64::try_from(n).ok())))
}

pub(crate) fn records(value: &Value) -> Vec<&Value> {
    let root = data(value);
    root.get("items").or_else(|| root.get("records")).or_else(|| root.get("logs")).or_else(|| root.get("data"))
        .and_then(Value::as_array).map(|items| items.iter()).into_iter().flatten().collect()
}

pub(crate) fn start_of_today() -> i64 {
    let local = Local::now();
    Local.with_ymd_and_hms(local.year(), local.month(), local.day(), 0, 0, 0).earliest().unwrap_or(local).timestamp()
}

pub(crate) fn timestamp(value: &Value) -> Option<i64> {
    integer(value, &["created_at", "createdAt", "timestamp", "time"]).map(|time| if time > 10_000_000_000 { time / 1_000 } else { time })
}

pub(crate) fn sum_i64(values: impl Iterator<Item = Option<i64>>) -> Option<i64> {
    let mut found = false; let total = values.flatten().inspect(|_| found = true).sum(); found.then_some(total)
}

pub(crate) fn sum_f64(values: impl Iterator<Item = Option<f64>>) -> Option<f64> {
    let mut found = false; let total = values.flatten().inspect(|_| found = true).sum(); found.then_some(total)
}

pub(crate) fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
        Value::Array(items) => items.iter().find_map(value_text),
        Value::Object(_) => value.get("text").or_else(|| value.get("value")).and_then(value_text),
        _ => None,
    }
}

pub(crate) fn model_response_text(value: &Value) -> Option<String> {
    value.get("output_text").and_then(value_text)
        .or_else(|| value.pointer("/choices/0/message/content").and_then(value_text))
        .or_else(|| value.get("content").and_then(value_text))
        .or_else(|| value.get("output").and_then(Value::as_array).and_then(|output| output.iter().find_map(|item| item.get("content").and_then(value_text))))
}

pub(crate) fn response_error_message(body: &str) -> String {
    serde_json::from_str::<Value>(body).ok()
        .and_then(|value| value.get("error").and_then(|error| error.get("message").or(Some(error))).or_else(|| value.get("message")).and_then(value_text))
        .unwrap_or_else(|| body.chars().take(240).collect())
}

pub(crate) fn usage_from_profile(value: &Value) -> UsageStats {
    let profile = data(value);
    UsageStats {
        today_input_tokens: integer(profile, &["today_prompt_tokens", "today_input_tokens", "prompt_tokens_today"]),
        today_output_tokens: integer(profile, &["today_completion_tokens", "today_output_tokens", "completion_tokens_today"]),
        today_requests: integer(profile, &["today_request_count", "today_requests", "request_count_today"]),
        total_requests: integer(profile, &["request_count", "total_requests", "requests"]),
        today_spent: number(profile, &["today_used_quota", "today_spent", "today_usage"]),
        today_limit: number(profile, &["daily_quota", "today_quota", "today_limit"]),
        total_spent: number(profile, &["used_quota", "total_used_quota", "total_spent", "usage"]),
        total_limit: number(profile, &["total_quota", "quota_total", "total_limit"]),
    }
}

pub(crate) fn usage_from_logs(value: &Value, since: i64) -> UsageStats {
    let logs = records(value).into_iter().filter(|item| timestamp(item).is_some_and(|time| time >= since)).collect::<Vec<_>>();
    if logs.is_empty() { return UsageStats { today_requests: Some(0), ..Default::default() }; }
    let sum_tokens = |names: &[&str]| logs.iter().filter_map(|item| integer(item, names)).sum::<i64>();
    let sum_cost = |names: &[&str]| logs.iter().filter_map(|item| number(item, names)).sum::<f64>();
    let has_cost = logs.iter().any(|item| number(item, &["quota", "cost", "used_quota", "usage"]).is_some());
    UsageStats {
        today_input_tokens: Some(sum_tokens(&["prompt_tokens", "input_tokens", "promptTokens"])),
        today_output_tokens: Some(sum_tokens(&["completion_tokens", "output_tokens", "completionTokens"])),
        today_requests: Some(logs.len() as i64),
        today_spent: has_cost.then(|| sum_cost(&["quota", "cost", "used_quota", "usage"])),
        ..Default::default()
    }
}

pub(crate) fn normalized_group(item: &Value) -> Option<String> {
    optional_scalar_string(item, &["group", "group_name"])
        .or_else(|| item.get("group").and_then(|group| optional_scalar_string(group, &["name", "group_name", "group_id", "id"])))
}

pub(crate) fn parse_usage_logs(value: &Value, station: &Station) -> Vec<UsageLog> {
    records(value).into_iter().map(|item| UsageLog {
        id: format!("{}-{}", station.id, scalar_string(item, &["id", "log_id", "request_id"])),
        station_id: station.id.clone(),
        station_name: station.name.clone(),
        station_url: station.base_url.clone(),
        api_key_name: optional_string(item, &["api_key_name", "key_name", "token_name"]),
        group_name: normalized_group(item),
        endpoint: optional_string(item, &["inbound_endpoint", "endpoint", "path", "request_path"]),
        ip_address: optional_string(item, &["ip_address", "ip", "client_ip"]),
        reasoning_effort: optional_string(item, &["reasoning_effort"]),
        billing_type: optional_string(item, &["billing_type"]),
        billing_mode: optional_string(item, &["billing_mode"]),
        model: string(item, &["model", "model_name", "requested_model"]),
        input_tokens: integer(item, &["prompt_tokens", "input_tokens", "promptTokens"]).unwrap_or(0),
        output_tokens: integer(item, &["completion_tokens", "output_tokens", "completionTokens"]).unwrap_or(0),
        cache_creation_tokens: integer(item, &["cache_creation_tokens", "cache_write_tokens"]).unwrap_or(0),
        cache_read_tokens: integer(item, &["cache_read_tokens", "cache_tokens"]).unwrap_or(0),
        actual_cost: number(item, &["actual_cost", "quota", "cost", "used_quota", "usage"]).unwrap_or(0.0),
        request_type: string(item, &["request_type", "type"]),
        duration_ms: integer(item, &["duration_ms", "duration"]),
        created_at: timestamp(item).unwrap_or_default(),
    }).collect()
}

pub(crate) fn merge_usage(profile: UsageStats, logs: UsageStats) -> UsageStats {
    UsageStats {
        today_input_tokens: logs.today_input_tokens.or(profile.today_input_tokens), today_output_tokens: logs.today_output_tokens.or(profile.today_output_tokens),
        today_requests: logs.today_requests.or(profile.today_requests), total_requests: profile.total_requests,
        today_spent: logs.today_spent.or(profile.today_spent), today_limit: profile.today_limit,
        total_spent: profile.total_spent, total_limit: profile.total_limit,
    }
}

pub(crate) fn map_rates(value: &Value) -> Vec<GroupRate> {
    let mut output = Vec::new();
    if let Some(map) = value.as_object() {
        for (group, item) in map {
            if let Some(multiplier) = item.as_f64() { output.push(GroupRate { group: group.clone(), model: "全部模型".into(), multiplier, input_multiplier: None, output_multiplier: None }); }
            if let Some(models) = item.as_object() { for (model, rate) in models { if let Some(multiplier) = rate.as_f64() { output.push(GroupRate { group: group.clone(), model: model.clone(), multiplier, input_multiplier: None, output_multiplier: None }); } } }
        }
    }
    output
}

pub(crate) fn normalize_key_status(adapter: StationAdapter, item: &Value) -> String {
    let raw = scalar_string(item, &["status"]).to_lowercase();
    match adapter {
        StationAdapter::NewApi => match raw.as_str() {
            "1" | "active" | "enabled" => "active".into(),
            "2" | "inactive" | "disabled" => "inactive".into(),
            "3" | "expired" => "expired".into(),
            "4" | "quota_exhausted" => "quota_exhausted".into(),
            _ => raw,
        },
        StationAdapter::Sub2Api => match raw.as_str() {
            "1" | "active" | "enabled" | "valid" | "有效" => "active".into(),
            "0" | "2" | "inactive" | "disabled" | "停用" | "无效" => "inactive".into(),
            _ => raw,
        },
    }
}

pub(crate) fn normalize_key_quota(adapter: StationAdapter, item: &Value) -> (Option<f64>, Option<f64>, Option<f64>, bool) {
    let used = number(item, &["quota_used", "used_quota", "usage", "used"]);
    match adapter {
        StationAdapter::Sub2Api => match number(item, &["quota", "total_quota"]) {
            Some(total) if total > 0.0 => (Some((total - used.unwrap_or(0.0)).max(0.0)), Some(total), used, false),
            _ => (None, None, used, true),
        },
        StationAdapter::NewApi => {
            let unlimited = item.get("unlimited_quota").and_then(Value::as_bool).unwrap_or(false);
            let remaining = (!unlimited).then(|| number(item, &["remain_quota", "remaining_quota"])).flatten();
            let total = remaining.zip(used).map(|(remaining, used)| remaining + used);
            (remaining, total, used, unlimited)
        }
    }
}

pub(crate) fn parse_keys(value: &Value, adapter: StationAdapter) -> Vec<ApiKeyInfo> {
    let items = value.get("items").or_else(|| value.get("data").and_then(|d| d.get("items"))).or_else(|| value.get("data")).and_then(Value::as_array).cloned().unwrap_or_default();
    items.into_iter().map(|item| {
        let (remaining_quota, total_quota, used_quota, unlimited_quota) = normalize_key_quota(adapter, &item);
        ApiKeyInfo {
        id: scalar_string(&item, &["id", "key_id"]), name: string(&item, &["name", "label"]), masked_key: mask_api_key(&string(&item, &["key", "masked_key", "prefix"])),
        group: normalized_group(&item), status: normalize_key_status(adapter, &item),
        remaining_quota, total_quota, unlimited_quota,
        current_concurrency: item.get("current_concurrency").or_else(|| item.get("concurrency")).or_else(|| item.get("concurrency_limit")).and_then(Value::as_i64),
        used_quota,
        today_spent: number(&item, &["today_used_quota", "today_spent", "today_usage"]),
        last_30_days_spent: number(&item, &["last_30_days_used_quota", "last_30_days_spent", "monthly_used_quota", "month_used_quota"]),
        expires_at: item.get("expired_time").or_else(|| item.get("expires_at")).and_then(Value::as_i64),
        created_at: item.get("created_time").or_else(|| item.get("created_at")).and_then(Value::as_i64),
    }}).collect()
}

pub(crate) fn mask_api_key(value: &str) -> String {
    if value.is_empty() { return String::new(); }
    if value.contains("...") { return value.to_string(); }
    if value.len() > 10 { return format!("{}...{}", &value[..5], &value[value.len() - 4..]); }
    "已隐藏".into()
}

pub(crate) fn parse_balance(value: &Value) -> Option<f64> { number(data(value), &["quota", "balance", "remain_quota", "remaining_quota"]) }

pub(crate) fn parse_account(value: &Value) -> AccountInfo {
    let profile = data(value);
    AccountInfo {
        id: scalar_string(profile, &["id", "user_id", "userId"]),
        username: scalar_string(profile, &["username", "user_name"]),
        display_name: scalar_string(profile, &["display_name", "displayName", "nickname", "name"]),
        email: optional_string(profile, &["email"]),
        group: optional_string(profile, &["group", "group_name", "groupName"]),
        role: scalar_string(profile, &["role", "role_name", "roleName"]),
        status: scalar_string(profile, &["status"]),
        balance: parse_balance(value),
    }
}

pub(crate) fn parse_offers(value: &Value, station: &Station) -> Vec<Offer> {
    let list = data(value).as_array().cloned().unwrap_or_else(|| vec![data(value).clone()]);
    list.into_iter().filter_map(|item| {
        let title = string(&item, &["title", "name"]);
        let summary = string(&item, &["content", "description", "notice"]);
        if title.is_empty() && summary.is_empty() { return None; }
        Some(Offer { id: if string(&item, &["id"]).is_empty() { hash(&(title.clone() + &summary)) } else { string(&item, &["id"]) }, title: if title.is_empty() { "站点公告".into() } else { title }, summary, source_url: station.base_url.clone(), published_at: item.get("created_at").or_else(|| item.get("published_at")).and_then(Value::as_i64) })
    }).collect()
}

pub(crate) fn hash<T: Serialize>(value: &T) -> String { let bytes = serde_json::to_vec(value).unwrap_or_default(); format!("{:x}", Sha256::digest(bytes)) }

pub(crate) fn title_from_html(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title")?;
    let content_start = lower[start..].find('>')? + start + 1;
    let end = lower[content_start..].find("</title>")? + content_start;
    let title = html[content_start..end].split_whitespace().collect::<Vec<_>>().join(" ");
    (!title.is_empty()).then_some(title)
}

pub(crate) fn endpoint(station: &Station, path: &str) -> String { format!("{}{}", base(&station.base_url), path) }

pub(crate) async fn request(client: &Client, station: &Station, token: Option<&str>, newapi_user_id: Option<&str>, newapi_session: Option<&str>, method: Method, path: &str, body: Option<Value>) -> Result<Value, String> {
    let mut call = client.request(method, endpoint(station, path)).timeout(std::time::Duration::from_secs(15));
    if station.kind == "newapi" {
        if let Some(user_id) = newapi_user_id { call = call.header("New-Api-User", user_id); }
        if let Some(session) = newapi_session { call = call.header(header::COOKIE, session); }
    } else if let Some(token) = token { call = call.bearer_auth(token); }
    if let Some(body) = body { call = call.json(&body); }
    let response = call.send().await.map_err(|e| format!("请求失败：{e}"))?;
    let status = response.status();
    let value = response.json::<Value>().await.map_err(|_| format!("HTTP {status}: 站点返回了无法识别的数据"))?;
    if !status.is_success() || value.get("success") == Some(&Value::Bool(false)) || value.get("code") == Some(&json!(-1)) {
        return Err(format!("HTTP {status}: {}", value.get("message").and_then(Value::as_str).unwrap_or("站点拒绝了请求")));
    }
    Ok(value)
}

pub(crate) async fn detect_kind(client: &Client, url: &str) -> Result<String, String> {
    let temp = Station { id: String::new(), name: String::new(), base_url: base(url), kind: "auto".into(), status: String::new(), last_synced_at: None, last_error: None };
    if request(client, &temp, None, None, None, Method::GET, "/api/v1/settings/public", None).await.is_ok() { return Ok("sub2api".into()); }
    if request(client, &temp, None, None, None, Method::GET, "/api/status", None).await.is_ok() { return Ok("newapi".into()); }
    Err("未识别为 New API 或 Sub2API，请确认网址和站点可访问性".into())
}

pub(crate) fn session_cookie(headers: &HeaderMap) -> Option<String> {
    headers.get_all(header::SET_COOKIE).iter().find_map(|value| {
        let cookie = value.to_str().ok()?.split(';').next()?.trim();
        cookie.starts_with("session=").then(|| cookie.to_string())
    })
}

pub(crate) async fn login_request(client: &Client, station: &Station, path: &str, body: Value) -> Result<(Value, Option<String>), String> {
    let response = client.post(endpoint(station, path)).timeout(std::time::Duration::from_secs(15)).json(&body).send().await.map_err(|e| format!("请求失败：{e}"))?;
    let status = response.status();
    let session = session_cookie(response.headers());
    let value = response.json::<Value>().await.map_err(|_| format!("站点返回了无法识别的数据 ({status})"))?;
    if !status.is_success() || value.get("success") == Some(&Value::Bool(false)) || value.get("code") == Some(&json!(-1)) {
        return Err(value.get("message").and_then(Value::as_str).unwrap_or("站点拒绝了请求").to_string());
    }
    Ok((value, session))
}

pub(crate) async fn authenticate(client: &Client, station: &Station, secret: &mut Secret, totp: Option<&str>) -> Result<(), String> {
    let adapter = StationAdapter::for_station(station)?;
    let (login, login_session) = login_request(client, station, adapter.login_path(), adapter.login_body(&secret.username, &secret.password)).await?;
    let (authentication, session) = if data(&login).get("require_2fa").and_then(Value::as_bool).unwrap_or(false) {
        let code = totp.ok_or("该站点需要 TOTP 验证码")?;
        let (verify, verify_session) = login_request(client, station, adapter.login_2fa_path(), json!({"flow_token": data(&login)["flow_token"], "code": code, "totp": code})).await?;
        (verify, verify_session.or(login_session))
    } else { (login, login_session) };
    let authentication_data = data(&authentication);
    copy_tokens(secret, authentication_data);
    if station.kind == "newapi" {
        secret.newapi_user_id = authentication_data.get("id").and_then(|id| id.as_str().map(str::to_string).or_else(|| id.as_i64().map(|id| id.to_string())));
        secret.newapi_session = session;
        if secret.newapi_user_id.is_none() { return Err("登录成功，但站点未返回用户标识".into()); }
        if secret.newapi_session.is_none() { return Err("登录成功，但站点未返回可保存的会话".into()); }
    } else if secret.access_token.is_none() { return Err("登录成功，但站点未返回可保存的登录令牌".into()); }
    Ok(())
}

pub(crate) fn copy_tokens(secret: &mut Secret, value: &Value) {
    secret.access_token = value.get("access_token").or_else(|| value.get("accessToken")).and_then(Value::as_str).map(str::to_string);
    secret.refresh_token = value.get("refresh_token").or_else(|| value.get("refreshToken")).and_then(Value::as_str).map(str::to_string);
}
