use reqwest::Method;
use serde_json::{json, Value};

use crate::{
    keyring_store::Secret,
    models::ApiKeyMutationRequest,
    services::stations::{data, load_authenticated_secret, number, station_request},
    station_adapter::{Station, StationAdapter},
    station_store::StationStore,
    support::now,
    AppState,
};

pub(crate) fn empty_mutation(station_id: &str, key_id: Option<String>) -> ApiKeyMutationRequest {
    ApiKeyMutationRequest {
        station_id: station_id.into(),
        key_id,
        name: None,
        group: None,
        custom_key: None,
        quota: None,
        expires_in_days: None,
        status: None,
        ip_whitelist: None,
        ip_blacklist: None,
        rate_limit_5h: None,
        rate_limit_1d: None,
        rate_limit_7d: None,
        reset_quota: None,
        reset_rate_limit_usage: None,
    }
}

pub(crate) async fn read_api_key(
    state: &AppState,
    station_id: &str,
    key_id: &str,
) -> Result<(Station, String), String> {
    let station = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_station(station_id)?;
    let mut secret = load_authenticated_secret(state, &station).await?;
    let (path, method) = match StationAdapter::for_station(&station)? {
        StationAdapter::Sub2Api => (format!("/api/v1/keys/{key_id}"), Method::GET),
        StationAdapter::NewApi => (format!("/api/token/{key_id}/key"), Method::POST),
    };
    let result = station_request(state, &station, &mut secret, method, &path, None).await?;
    let key = data(&result)
        .get("key")
        .or_else(|| data(&result).get("api_key"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .ok_or("站点未返回密钥明文")?;
    Ok((station, key))
}

pub(crate) fn sub2_payload(request: &ApiKeyMutationRequest, include_id: bool) -> Value {
    let mut payload = serde_json::Map::new();
    if let Some(name) = request
        .name
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        payload.insert("name".into(), Value::String(name.trim().into()));
    }
    if let Some(group) = request
        .group
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        payload.insert("group".into(), Value::String(group.trim().into()));
    }
    if let Some(value) = request
        .custom_key
        .as_ref()
        .filter(|value| !value.trim().is_empty())
    {
        payload.insert("custom_key".into(), Value::String(value.trim().into()));
    }
    if let Some(value) = request.quota {
        payload.insert("quota".into(), Value::from(value));
    }
    if let Some(value) = request.expires_in_days.filter(|value| *value > 0) {
        payload.insert("expires_in_days".into(), Value::from(value));
    }
    if let Some(value) = request
        .status
        .as_ref()
        .filter(|value| matches!(value.as_str(), "active" | "inactive"))
    {
        payload.insert("status".into(), Value::String(value.clone()));
    }
    if let Some(value) = request.ip_whitelist.as_ref() {
        payload.insert("ip_whitelist".into(), json!(value));
    }
    if let Some(value) = request.ip_blacklist.as_ref() {
        payload.insert("ip_blacklist".into(), json!(value));
    }
    if let Some(value) = request.rate_limit_5h {
        payload.insert("rate_limit_5h".into(), Value::from(value));
    }
    if let Some(value) = request.rate_limit_1d {
        payload.insert("rate_limit_1d".into(), Value::from(value));
    }
    if let Some(value) = request.rate_limit_7d {
        payload.insert("rate_limit_7d".into(), Value::from(value));
    }
    if let Some(value) = request.reset_quota {
        payload.insert("reset_quota".into(), Value::Bool(value));
    }
    if let Some(value) = request.reset_rate_limit_usage {
        payload.insert("reset_rate_limit_usage".into(), Value::Bool(value));
    }
    let mut payload = Value::Object(payload);
    if include_id {
        payload["id"] = Value::String(request.key_id.clone().unwrap_or_default());
    }
    payload
}

pub(crate) fn validate_newapi_mutation(request: &ApiKeyMutationRequest) -> Result<(), String> {
    if request
        .custom_key
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        return Err("NewAPI 不支持自定义密钥值".into());
    }
    if request
        .ip_blacklist
        .as_ref()
        .is_some_and(|values| !values.is_empty())
    {
        return Err("NewAPI 不支持 IP 黑名单；可使用 IP 白名单".into());
    }
    if request.rate_limit_5h.is_some()
        || request.rate_limit_1d.is_some()
        || request.rate_limit_7d.is_some()
    {
        return Err("NewAPI 不支持 Sub2API 的费率限额字段".into());
    }
    if request.reset_quota == Some(true) || request.reset_rate_limit_usage == Some(true) {
        return Err("NewAPI 不支持该重置操作".into());
    }
    Ok(())
}

fn newapi_allow_ips(values: &Option<Vec<String>>) -> Option<Value> {
    values.as_ref().map(|values| {
        Value::String(
            values
                .iter()
                .map(|value| value.trim())
                .filter(|value| !value.is_empty())
                .collect::<Vec<_>>()
                .join("\n"),
        )
    })
}

pub(crate) fn newapi_create_payload(request: &ApiKeyMutationRequest) -> Result<Value, String> {
    validate_newapi_mutation(request)?;
    let name = request
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or("请输入密钥名称")?;
    let quota = request.quota.unwrap_or(0.0);
    let mut payload = json!({
        "name": name,
        "remain_quota": quota.max(0.0),
        "unlimited_quota": quota <= 0.0,
        "expired_time": request.expires_in_days.filter(|days| *days > 0).map(|days| now() + days * 86_400).unwrap_or(0),
        "status": if request.status.as_deref() == Some("inactive") { 2 } else { 1 },
        "model_limits_enabled": false,
        "model_limits": "",
        "cross_group_retry": false,
        "allow_ips": "",
    });
    if let Some(group) = request
        .group
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        payload["group"] = Value::String(group.into());
    }
    if let Some(allow_ips) = newapi_allow_ips(&request.ip_whitelist) {
        payload["allow_ips"] = allow_ips;
    }
    Ok(payload)
}

pub(crate) async fn read_newapi_token(
    state: &AppState,
    station: &Station,
    secret: &mut Secret,
    key_id: &str,
) -> Result<Value, String> {
    let value = station_request(
        state,
        station,
        secret,
        Method::GET,
        &format!("/api/token/{key_id}"),
        None,
    )
    .await?;
    data(&value)
        .as_object()
        .cloned()
        .map(Value::Object)
        .ok_or("NewAPI 未返回完整密钥配置".into())
}

pub(crate) fn newapi_has_content_changes(request: &ApiKeyMutationRequest) -> bool {
    request.name.is_some()
        || request.group.is_some()
        || request.quota.is_some()
        || request.expires_in_days.is_some()
        || request.ip_whitelist.is_some()
}

pub(crate) fn newapi_update_payload(
    current: &Value,
    request: &ApiKeyMutationRequest,
) -> Result<Value, String> {
    validate_newapi_mutation(request)?;
    let mut payload = current
        .as_object()
        .cloned()
        .map(Value::Object)
        .ok_or("NewAPI 密钥配置格式无效")?;
    if let Some(name) = request
        .name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        payload["name"] = Value::String(name.into());
    }
    if let Some(group) = request.group.as_deref() {
        payload["group"] = Value::String(group.trim().into());
    }
    if let Some(quota) = request.quota {
        payload["unlimited_quota"] = Value::Bool(quota <= 0.0);
        if quota > 0.0 {
            let used = number(current, &["used_quota"]).unwrap_or(0.0);
            payload["remain_quota"] = Value::from((quota - used).max(0.0));
        }
    }
    if let Some(days) = request.expires_in_days.filter(|days| *days > 0) {
        payload["expired_time"] = Value::from(now() + days * 86_400);
    }
    if let Some(allow_ips) = newapi_allow_ips(&request.ip_whitelist) {
        payload["allow_ips"] = allow_ips;
    }
    Ok(payload)
}

pub(crate) async fn update_newapi_token(
    state: &AppState,
    station: &Station,
    secret: &mut Secret,
    current: &Value,
    request: &ApiKeyMutationRequest,
) -> Result<(), String> {
    if newapi_has_content_changes(request) {
        station_request(
            state,
            station,
            secret,
            Method::PUT,
            "/api/token/",
            Some(newapi_update_payload(current, request)?),
        )
        .await?;
    } else {
        validate_newapi_mutation(request)?;
    }
    if let Some(status) = request.status.as_deref() {
        let status = match status {
            "active" => 1,
            "inactive" => 2,
            _ => return Err("密钥状态仅支持 active 或 inactive".into()),
        };
        let id = current
            .get("id")
            .cloned()
            .unwrap_or_else(|| Value::String(request.key_id.clone().unwrap_or_default()));
        station_request(
            state,
            station,
            secret,
            Method::PUT,
            "/api/token/?status_only=true",
            Some(json!({"id": id, "status": status})),
        )
        .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{empty_mutation, newapi_update_payload, validate_newapi_mutation};

    #[test]
    fn newapi_update_keeps_unedited_token_fields() {
        let current = json!({"id": 7, "name": "old", "group": "default", "status": 1, "remain_quota": 50.0, "used_quota": 10.0, "model_limits_enabled": true, "model_limits": "gpt-4", "allow_ips": "127.0.0.1", "cross_group_retry": true});
        let mut request = empty_mutation("station", Some("7".into()));
        request.name = Some("renamed".into());
        let payload = newapi_update_payload(&current, &request).unwrap();
        assert_eq!(payload["name"], "renamed");
        assert_eq!(payload["model_limits"], "gpt-4");
        assert_eq!(payload["cross_group_retry"], true);
        assert_eq!(payload["remain_quota"], 50.0);
    }

    #[test]
    fn rejects_newapi_fields_without_a_real_mapping() {
        let mut request = empty_mutation("station", None);
        request.ip_blacklist = Some(vec!["10.0.0.1".into()]);
        assert!(validate_newapi_mutation(&request).is_err());
    }
}
