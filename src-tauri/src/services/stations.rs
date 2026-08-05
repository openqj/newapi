use std::{
    collections::{BTreeSet, HashMap},
    sync::{Arc, Mutex},
    time::Duration,
};

const TOKEN_REFRESH_LEEWAY_SECONDS: i64 = 90;

use chrono::{DateTime, Datelike, Local, NaiveDateTime, TimeZone};
use cookie::Cookie;
use reqwest::{
    header::{self, HeaderMap},
    Client, Method, Response, StatusCode,
};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use url::Url;

use crate::{
    audit_store::AuditStore,
    keyring_store::{load_secret, save_secret, PersistedCookie, Secret},
    models::{
        AccountInfo, ApiKeyInfo, GroupRate, Offer, StationSnapshot, SyncComponentState, SyncResult,
        UsageLog, UsageStats,
    },
    station_adapter::{PagedResource, Station, StationAdapter},
    station_snapshot_store::StationSnapshotStore,
    station_store::StationStore,
    support::{base, now},
    AppState, AuthBackoff,
};

pub(crate) fn describe_changes(
    old: Option<&StationSnapshot>,
    new: &StationSnapshot,
) -> Vec<String> {
    let Some(old) = old else {
        return vec!["已建立首个站点快照".into()];
    };
    let mut changes = Vec::new();
    if old.rates != new.rates {
        changes.push(format!("倍率更新：{} 条记录", new.rates.len()));
    }
    if old.api_keys != new.api_keys {
        changes.push(format!("API 密钥状态更新：{} 个", new.api_keys.len()));
    }
    let old_offers = old
        .offers
        .iter()
        .map(|offer| &offer.id)
        .collect::<BTreeSet<_>>();
    let new_count = new
        .offers
        .iter()
        .filter(|offer| !old_offers.contains(&offer.id))
        .count();
    if new_count > 0 {
        changes.push(format!("发现 {new_count} 条新公告或优惠"));
    }
    changes
}

pub(crate) async fn sync_one(state: &AppState, id: &str) -> Result<SyncResult, String> {
    sync_one_authorized(state, id).await
}

pub(crate) async fn sync_one_authorized(state: &AppState, id: &str) -> Result<SyncResult, String> {
    let mut station = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_station(id)?;
    let mut secret = match load_authenticated_secret(state, &station).await {
        Ok(secret) => secret,
        Err(error) => {
            record_auth_sync_failure(state, &mut station, &error)?;
            return Err(error);
        }
    };
    let old = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .load_snapshot(id)?;
    let adapter = StationAdapter::for_station(&station)?;
    let mut snapshot = match fetch_snapshot(state, &station, &mut secret).await {
        Ok(snapshot) => snapshot,
        Err(profile_error) if adapter == StationAdapter::Sub2Api => {
            match fetch_sub2_group_rates(state, &station, &mut secret).await {
                Ok(rates) => {
                    let mut snapshot = old
                        .as_ref()
                        .map(|(_, previous)| previous.clone())
                        .unwrap_or_default();
                    snapshot.capabilities = adapter.capabilities();
                    snapshot.rates = rates;
                    snapshot
                        .unavailable
                        .push("账户信息暂未同步，但分组倍率已更新。".into());
                    snapshot.sync_statuses.insert(
                        "account".into(),
                        SyncComponentState {
                            status: "failed".into(),
                            last_synced_at: None,
                            error: Some(classify_refresh_error(&profile_error).into()),
                        },
                    );
                    snapshot.sync_statuses.insert(
                        "groups".into(),
                        SyncComponentState {
                            status: "success".into(),
                            last_synced_at: Some(now()),
                            error: None,
                        },
                    );
                    for key in ["api_keys", "announcements"] {
                        snapshot.sync_statuses.insert(
                            key.into(),
                            SyncComponentState {
                                status: "failed".into(),
                                last_synced_at: None,
                                error: Some("not_attempted".into()),
                            },
                        );
                    }
                    snapshot
                }
                Err(_) => {
                    record_auth_sync_failure(state, &mut station, &profile_error)?;
                    return Err(profile_error);
                }
            }
        }
        Err(error) => {
            record_auth_sync_failure(state, &mut station, &error)?;
            return Err(error);
        }
    };
    if let Some((_, previous)) = old.as_ref() {
        retain_group_descriptions(previous, &mut snapshot);
    }
    let fingerprint = hash(&snapshot);
    let changed = old
        .as_ref()
        .map(|(previous, _)| previous != &fingerprint)
        .unwrap_or(true);
    let change_summary = if changed {
        describe_changes(old.as_ref().map(|(_, snapshot)| snapshot), &snapshot)
    } else {
        Vec::new()
    };
    station.status = if snapshot
        .sync_statuses
        .values()
        .all(|status| status.status == "failed")
    {
        "error".into()
    } else if snapshot
        .sync_statuses
        .values()
        .any(|status| status.status == "failed")
    {
        "partial".into()
    } else {
        "online".into()
    };
    station.last_synced_at = Some(now());
    station.last_error = None;
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?;
    store.save_station(&station)?;
    if changed {
        store.save_snapshot(id, &fingerprint, &snapshot, &change_summary)?;
    }
    drop(store);
    state.emit_stations_changed();
    Ok(SyncResult {
        station,
        snapshot,
        changed,
        change_summary,
    })
}

pub(crate) fn record_station_audit(state: &AppState, station_id: &str, action: &str, detail: &str) {
    if let Ok(store) = state.store.lock() {
        let _ = store.record_audit(station_id, action, "success", detail);
    }
}

fn record_auth_sync_failure(
    state: &AppState,
    station: &mut Station,
    error: &str,
) -> Result<(), String> {
    let requires_reauth = error.to_ascii_lowercase().contains("refresh token invalid");
    station.status = if requires_reauth {
        "requires_reauth"
    } else {
        "error"
    }
    .into();
    station.last_error = Some(if requires_reauth {
        "凭据已过期，请手动重新登录".into()
    } else if error.contains("令牌刷新暂缓") {
        "令牌刷新暂缓，稍后自动重试".into()
    } else {
        "令牌刷新失败，已保留现有凭据".into()
    });
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_station(station)?;
    state.emit_stations_changed();
    Ok(())
}

pub(crate) fn data(value: &Value) -> &Value {
    value.get("data").unwrap_or(value)
}

pub(crate) fn number(value: &Value, names: &[&str]) -> Option<f64> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(Value::as_f64))
}
pub(crate) fn string(value: &Value, names: &[&str]) -> String {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(Value::as_str))
        .unwrap_or_default()
        .to_string()
}
pub(crate) fn optional_string(value: &Value, names: &[&str]) -> Option<String> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}
pub(crate) fn scalar_string(value: &Value, names: &[&str]) -> String {
    names
        .iter()
        .find_map(|name| value.get(*name))
        .and_then(|value| match value {
            Value::String(value) => Some(value.clone()),
            Value::Number(value) => Some(value.to_string()),
            Value::Bool(value) => Some(value.to_string()),
            _ => None,
        })
        .unwrap_or_default()
}
pub(crate) fn optional_scalar_string(value: &Value, names: &[&str]) -> Option<String> {
    let value = scalar_string(value, names);
    (!value.trim().is_empty()).then_some(value)
}
pub(crate) fn integer(value: &Value, names: &[&str]) -> Option<i64> {
    names.iter().find_map(|name| {
        value.get(*name).and_then(Value::as_i64).or_else(|| {
            value
                .get(*name)
                .and_then(Value::as_u64)
                .and_then(|n| i64::try_from(n).ok())
        })
    })
}

pub(crate) fn records(value: &Value) -> Vec<&Value> {
    collection_items(value)
        .map(|items| items.iter().collect())
        .unwrap_or_default()
}

fn collection_items(value: &Value) -> Option<&Vec<Value>> {
    let root = data(value);
    root.as_array().or_else(|| {
        root.as_object().and_then(|object| {
            ["items", "records", "logs", "data"]
                .iter()
                .find_map(|key| object.get(*key).and_then(Value::as_array))
        })
    })
}

fn page_items(value: &Value) -> Vec<Value> {
    collection_items(value).cloned().unwrap_or_default()
}

pub(crate) fn start_of_today() -> i64 {
    let local = Local::now();
    Local
        .with_ymd_and_hms(local.year(), local.month(), local.day(), 0, 0, 0)
        .earliest()
        .unwrap_or(local)
        .timestamp()
}

pub(crate) fn timestamp(value: &Value) -> Option<i64> {
    ["created_at", "createdAt", "timestamp", "time"]
        .iter()
        .find_map(|name| value.get(*name).and_then(timestamp_value))
}

fn timestamp_value(value: &Value) -> Option<i64> {
    let timestamp = value
        .as_i64()
        .or_else(|| value.as_u64().and_then(|value| i64::try_from(value).ok()))
        .or_else(|| value.as_f64().map(|value| value as i64))
        .or_else(|| {
            let text = value.as_str()?.trim();
            text.parse::<i64>()
                .ok()
                .or_else(|| {
                    DateTime::parse_from_rfc3339(text)
                        .ok()
                        .map(|value| value.timestamp())
                })
                .or_else(|| {
                    ["%Y-%m-%d %H:%M:%S%.f", "%Y-%m-%d %H:%M:%S"]
                        .iter()
                        .find_map(|format| {
                            NaiveDateTime::parse_from_str(text, format)
                                .ok()
                                .map(|value| value.and_utc().timestamp())
                        })
                })
        })?;
    Some(if timestamp > 10_000_000_000 {
        timestamp / 1_000
    } else {
        timestamp
    })
}

pub(crate) fn sum_i64(values: impl Iterator<Item = Option<i64>>) -> Option<i64> {
    let mut found = false;
    let total = values.flatten().inspect(|_| found = true).sum();
    found.then_some(total)
}

pub(crate) fn sum_f64(values: impl Iterator<Item = Option<f64>>) -> Option<f64> {
    let mut found = false;
    let total = values.flatten().inspect(|_| found = true).sum();
    found.then_some(total)
}

pub(crate) fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
        Value::Array(items) => items.iter().find_map(value_text),
        Value::Object(_) => value
            .get("text")
            .or_else(|| value.get("value"))
            .and_then(value_text),
        _ => None,
    }
}

pub(crate) fn model_response_text(value: &Value) -> Option<String> {
    value
        .get("output_text")
        .and_then(value_text)
        .or_else(|| {
            value
                .pointer("/choices/0/message/content")
                .and_then(value_text)
        })
        .or_else(|| value.get("content").and_then(value_text))
        .or_else(|| {
            value
                .get("output")
                .and_then(Value::as_array)
                .and_then(|output| {
                    output
                        .iter()
                        .find_map(|item| item.get("content").and_then(value_text))
                })
        })
}

pub(crate) fn response_error_message(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|value| {
            value
                .get("error")
                .and_then(|error| error.get("message").or(Some(error)))
                .or_else(|| value.get("message"))
                .and_then(value_text)
        })
        .unwrap_or_else(|| body.chars().take(240).collect())
}

pub(crate) fn usage_from_profile(value: &Value) -> UsageStats {
    let profile = data(value);
    UsageStats {
        today_input_tokens: integer(
            profile,
            &[
                "today_prompt_tokens",
                "today_input_tokens",
                "prompt_tokens_today",
            ],
        ),
        today_output_tokens: integer(
            profile,
            &[
                "today_completion_tokens",
                "today_output_tokens",
                "completion_tokens_today",
            ],
        ),
        today_requests: integer(
            profile,
            &[
                "today_request_count",
                "today_requests",
                "request_count_today",
            ],
        ),
        total_requests: integer(profile, &["request_count", "total_requests", "requests"]),
        today_spent: number(profile, &["today_used_quota", "today_spent", "today_usage"]),
        today_limit: number(profile, &["daily_quota", "today_quota", "today_limit"]),
        total_spent: number(
            profile,
            &["used_quota", "total_used_quota", "total_spent", "usage"],
        ),
        total_limit: number(profile, &["total_quota", "quota_total", "total_limit"]),
    }
}

pub(crate) fn usage_from_logs(value: &Value, since: i64) -> UsageStats {
    let logs = records(value)
        .into_iter()
        .filter(|item| timestamp(item).is_some_and(|time| time >= since))
        .collect::<Vec<_>>();
    if logs.is_empty() {
        return UsageStats {
            today_requests: Some(0),
            ..Default::default()
        };
    }
    let sum_tokens = |names: &[&str]| {
        logs.iter()
            .filter_map(|item| integer(item, names))
            .sum::<i64>()
    };
    let sum_cost = |names: &[&str]| {
        logs.iter()
            .filter_map(|item| number(item, names))
            .sum::<f64>()
    };
    let has_cost = logs
        .iter()
        .any(|item| number(item, &["quota", "cost", "used_quota", "usage"]).is_some());
    UsageStats {
        today_input_tokens: Some(sum_tokens(&[
            "prompt_tokens",
            "input_tokens",
            "promptTokens",
        ])),
        today_output_tokens: Some(sum_tokens(&[
            "completion_tokens",
            "output_tokens",
            "completionTokens",
        ])),
        today_requests: Some(logs.len() as i64),
        today_spent: has_cost.then(|| sum_cost(&["quota", "cost", "used_quota", "usage"])),
        ..Default::default()
    }
}

pub(crate) fn normalized_group(item: &Value) -> Option<String> {
    item.as_str()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| optional_scalar_string(item, &["group", "group_name", "groupName", "name"]))
        .or_else(|| {
            item.get("group").and_then(|group| {
                optional_scalar_string(
                    group,
                    &["name", "group_name", "groupName", "group_id", "id"],
                )
            })
        })
        .or_else(|| {
            item.get("groups")
                .and_then(Value::as_array)
                .and_then(|groups| {
                    groups.first().and_then(|group| {
                        optional_scalar_string(group, &["name", "group_name", "groupName", "id"])
                    })
                })
        })
}

pub(crate) fn parse_usage_logs(value: &Value, station: &Station) -> Vec<UsageLog> {
    records(value)
        .into_iter()
        .map(|item| {
            let actual_cost = number(
                item,
                &["actual_cost", "quota", "cost", "used_quota", "usage"],
            );
            UsageLog {
                id: format!(
                    "{}-{}",
                    station.id,
                    scalar_string(item, &["id", "log_id", "request_id"])
                ),
                station_id: station.id.clone(),
                station_name: station.name.clone(),
                station_url: station.base_url.clone(),
                api_key_name: optional_string(item, &["api_key_name", "key_name", "token_name"])
                    .or_else(|| {
                        item.get("api_key")
                            .and_then(|api_key| optional_string(api_key, &["name", "label"]))
                    }),
                group_name: normalized_group(item),
                endpoint: optional_string(
                    item,
                    &["inbound_endpoint", "endpoint", "path", "request_path"],
                ),
                ip_address: optional_string(item, &["ip_address", "ip", "client_ip"]),
                reasoning_effort: optional_string(item, &["reasoning_effort"]),
                billing_type: optional_scalar_string(item, &["billing_type"]),
                billing_mode: optional_string(item, &["billing_mode"]),
                model: string(item, &["model", "model_name", "requested_model"]),
                input_tokens: integer(item, &["prompt_tokens", "input_tokens", "promptTokens"])
                    .unwrap_or(0),
                output_tokens: integer(
                    item,
                    &["completion_tokens", "output_tokens", "completionTokens"],
                )
                .unwrap_or(0),
                cache_creation_tokens: integer(
                    item,
                    &["cache_creation_tokens", "cache_write_tokens"],
                )
                .unwrap_or(0),
                cache_read_tokens: integer(item, &["cache_read_tokens", "cache_tokens"])
                    .unwrap_or(0),
                actual_cost: actual_cost.unwrap_or(0.0),
                input_cost: number(item, &["input_cost", "prompt_cost"]),
                output_cost: number(item, &["output_cost", "completion_cost"]),
                cache_creation_cost: number(item, &["cache_creation_cost", "cache_write_cost"]),
                cache_read_cost: number(item, &["cache_read_cost"]),
                total_cost: number(item, &["total_cost", "cost"]).or(actual_cost),
                rate_multiplier: number(item, &["rate_multiplier", "rateMultiplier", "multiplier"]),
                service_tier: optional_string(item, &["service_tier", "serviceTier"]),
                request_type: optional_string(item, &["request_type"])
                    .or_else(|| {
                        item.get("is_stream")
                            .and_then(Value::as_bool)
                            .map(|stream| if stream { "stream" } else { "sync" }.into())
                    })
                    .unwrap_or_default(),
                duration_ms: integer(item, &["duration_ms", "duration"]).or_else(|| {
                    integer(item, &["use_time"]).map(|seconds| seconds.saturating_mul(1_000))
                }),
                created_at: timestamp(item).unwrap_or_default(),
            }
        })
        .collect()
}

pub(crate) fn merge_usage(profile: UsageStats, logs: UsageStats) -> UsageStats {
    UsageStats {
        today_input_tokens: logs.today_input_tokens.or(profile.today_input_tokens),
        today_output_tokens: logs.today_output_tokens.or(profile.today_output_tokens),
        today_requests: logs.today_requests.or(profile.today_requests),
        total_requests: profile.total_requests,
        today_spent: logs.today_spent.or(profile.today_spent),
        today_limit: profile.today_limit,
        total_spent: profile.total_spent,
        total_limit: profile.total_limit,
    }
}

fn group_description(value: &Value) -> Option<String> {
    let names = [
        "description",
        "desc",
        "remark",
        "group_description",
        "groupDescription",
        "subtitle",
        "sub_title",
        "note",
    ];
    optional_scalar_string(value, &names)
        .or_else(|| {
            value
                .get("group")
                .and_then(|group| optional_scalar_string(group, &names))
        })
        .or_else(|| {
            value
                .get("meta")
                .and_then(|meta| optional_scalar_string(meta, &names))
        })
}

fn retain_group_descriptions(previous: &StationSnapshot, current: &mut StationSnapshot) {
    let descriptions = previous
        .rates
        .iter()
        .filter_map(|rate| {
            rate.group_description
                .as_ref()
                .map(|description| (rate.group.as_str(), description))
        })
        .collect::<HashMap<_, _>>();
    for rate in &mut current.rates {
        if rate.group_description.is_none() {
            rate.group_description = descriptions
                .get(rate.group.as_str())
                .map(|value| (*value).clone());
        }
    }
}

fn has_direct_multiplier(value: &Value) -> bool {
    ["rate_multiplier", "rateMultiplier", "multiplier"]
        .iter()
        .any(|name| value.get(*name).is_some())
}

pub(crate) fn map_rates(value: &Value) -> Vec<GroupRate> {
    let mut output = Vec::new();
    if let Some(map) = value.as_object() {
        for (group, item) in map {
            if let Some(multiplier) = item.as_f64() {
                output.push(GroupRate {
                    group: group.clone(),
                    group_description: None,
                    model: "全部模型".into(),
                    multiplier,
                    input_multiplier: None,
                    output_multiplier: None,
                });
            } else if has_direct_multiplier(item) {
                if let Some(multiplier) = rate_multiplier(item) {
                    output.push(GroupRate {
                        group: group.clone(),
                        group_description: group_description(item),
                        model: "全部模型".into(),
                        multiplier,
                        input_multiplier: None,
                        output_multiplier: None,
                    });
                }
            } else if let Some(models) = item.as_object() {
                for (model, rate) in models {
                    if let Some(multiplier) = rate.as_f64().or_else(|| rate_multiplier(rate)) {
                        output.push(GroupRate {
                            group: group.clone(),
                            group_description: group_description(item)
                                .or_else(|| group_description(rate)),
                            model: model.clone(),
                            multiplier,
                            input_multiplier: None,
                            output_multiplier: None,
                        });
                    }
                }
            }
        }
    }
    output
}

pub(crate) fn pricing_group_ratio(value: &Value) -> Option<&Value> {
    value
        .get("group_ratio")
        .or_else(|| data(value).get("group_ratio"))
}

pub(crate) fn map_sub2_group_rates(groups: &Value, overrides: &Value) -> Vec<GroupRate> {
    let override_root = data(overrides);
    let override_rates = override_root
        .get("rates")
        .or_else(|| override_root.get("group_rates"))
        .and_then(Value::as_object)
        .or_else(|| override_root.as_object());
    let group_root = data(groups);
    group_root
        .as_array()
        .or_else(|| {
            group_root
                .get("items")
                .or_else(|| group_root.get("groups"))
                .or_else(|| group_root.get("records"))
                .and_then(Value::as_array)
        })
        .map(|items| {
            items
                .iter()
                .filter_map(|item| {
                    let id = scalar_string(item, &["id"]);
                    let group = normalized_group(item).unwrap_or_default();
                    if group.is_empty() {
                        return None;
                    }
                    let multiplier = override_rates
                        .and_then(|rates| rates.get(&id).or_else(|| rates.get(&group)))
                        .and_then(rate_multiplier)
                        .or_else(|| rate_multiplier(item))
                        .unwrap_or(1.0);
                    let group_description = group_description(item);
                    Some(GroupRate {
                        group,
                        group_description,
                        model: "全部模型".into(),
                        multiplier,
                        input_multiplier: None,
                        output_multiplier: None,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn rate_multiplier(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        .or_else(|| {
            value
                .get("rate_multiplier")
                .or_else(|| value.get("rateMultiplier"))
                .or_else(|| value.get("multiplier"))
                .and_then(rate_multiplier)
        })
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

pub(crate) fn normalize_key_quota(
    adapter: StationAdapter,
    item: &Value,
) -> (Option<f64>, Option<f64>, Option<f64>, bool) {
    let used = number(item, &["quota_used", "used_quota", "usage", "used"]);
    match adapter {
        StationAdapter::Sub2Api => match number(item, &["quota", "total_quota"]) {
            Some(total) if total > 0.0 => (
                Some((total - used.unwrap_or(0.0)).max(0.0)),
                Some(total),
                used,
                false,
            ),
            _ => (None, None, used, true),
        },
        StationAdapter::NewApi => {
            let unlimited = item
                .get("unlimited_quota")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let remaining = (!unlimited)
                .then(|| number(item, &["remain_quota", "remaining_quota"]))
                .flatten();
            let total = remaining
                .zip(used)
                .map(|(remaining, used)| remaining + used);
            (remaining, total, used, unlimited)
        }
    }
}

pub(crate) fn parse_keys(value: &Value, adapter: StationAdapter) -> Vec<ApiKeyInfo> {
    let items = value
        .get("items")
        .or_else(|| value.get("data").and_then(|d| d.get("items")))
        .or_else(|| value.get("data"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    items
        .into_iter()
        .map(|item| {
            let (remaining_quota, total_quota, used_quota, unlimited_quota) =
                normalize_key_quota(adapter, &item);
            ApiKeyInfo {
                id: scalar_string(&item, &["id", "key_id"]),
                name: string(&item, &["name", "label"]),
                masked_key: mask_api_key(&string(&item, &["key", "masked_key", "prefix"])),
                group: normalized_group(&item),
                status: normalize_key_status(adapter, &item),
                remaining_quota,
                total_quota,
                unlimited_quota,
                current_concurrency: item
                    .get("current_concurrency")
                    .or_else(|| item.get("concurrency"))
                    .or_else(|| item.get("concurrency_limit"))
                    .and_then(Value::as_i64),
                used_quota,
                today_spent: number(&item, &["today_used_quota", "today_spent", "today_usage"]),
                last_30_days_spent: number(
                    &item,
                    &[
                        "last_30_days_used_quota",
                        "last_30_days_spent",
                        "monthly_used_quota",
                        "month_used_quota",
                    ],
                ),
                quota_reset_at: item
                    .get("quota_reset_at")
                    .or_else(|| item.get("reset_at"))
                    .or_else(|| item.get("reset_time"))
                    .and_then(Value::as_i64)
                    .map(|timestamp| {
                        if timestamp > 10_000_000_000 {
                            timestamp / 1000
                        } else {
                            timestamp
                        }
                    }),
                expires_at: key_timestamp(
                    &item,
                    &[
                        "expired_time",
                        "expires_at",
                        "expired_at",
                        "expiresAt",
                        "expiredAt",
                        "expire_time",
                        "expire_at",
                    ],
                ),
                created_at: key_timestamp(
                    &item,
                    &[
                        "created_time",
                        "created_at",
                        "createdAt",
                        "create_time",
                        "createTime",
                    ],
                ),
            }
        })
        .collect()
}

async fn fetch_sub2_group_rates(
    state: &AppState,
    station: &Station,
    secret: &mut Secret,
) -> Result<Vec<GroupRate>, String> {
    let available_groups = station_request(
        state,
        station,
        secret,
        Method::GET,
        "/api/v1/groups/available",
        None,
    )
    .await;
    let group_overrides = station_request(
        state,
        station,
        secret,
        Method::GET,
        "/api/v1/groups/rates",
        None,
    )
    .await;
    match (available_groups, group_overrides) {
        (Ok(groups), Ok(overrides)) => {
            let rates = map_sub2_group_rates(&groups, &overrides);
            Ok(if rates.is_empty() {
                map_rates(data(&overrides))
            } else {
                rates
            })
        }
        (Ok(groups), Err(_)) => Ok(map_sub2_group_rates(&groups, &Value::Null)),
        (Err(_), Ok(overrides)) => Ok(map_rates(data(&overrides))),
        (Err(groups_error), Err(overrides_error)) => Err(format!(
            "分组列表与倍率均无法获取：{groups_error}；{overrides_error}"
        )),
    }
}

fn key_timestamp(item: &Value, names: &[&str]) -> Option<i64> {
    names
        .iter()
        .find_map(|name| item.get(*name))
        .and_then(|value| value.as_i64().or_else(|| value.as_str()?.parse().ok()))
        .map(|timestamp| {
            if timestamp > 10_000_000_000 {
                timestamp / 1000
            } else {
                timestamp
            }
        })
}

pub(crate) fn mask_api_key(value: &str) -> String {
    if value.is_empty() {
        return String::new();
    }
    if value.contains("...") {
        return value.to_string();
    }
    if value.len() > 10 {
        return format!("{}...{}", &value[..5], &value[value.len() - 4..]);
    }
    "已隐藏".into()
}

pub(crate) fn parse_balance(value: &Value) -> Option<f64> {
    number(
        data(value),
        &[
            "quota",
            "balance",
            "remaining",
            "remain_quota",
            "remaining_quota",
        ],
    )
}

pub(crate) fn newapi_display_balance(profile: &Value, status: Option<&Value>) -> Option<f64> {
    let quota = parse_balance(profile)?;
    let Some(status) = status else {
        return Some(quota / 500_000.0);
    };
    let settings = data(status);
    if settings.get("display_in_currency").and_then(Value::as_bool) == Some(false) {
        return Some(quota);
    }
    let quota_per_unit = number(settings, &["quota_per_unit", "quotaPerUnit"])
        .filter(|value| *value > 0.0)
        .unwrap_or(500_000.0);
    let exchange_rate = match string(settings, &["quota_display_type", "quotaDisplayType"])
        .to_uppercase()
        .as_str()
    {
        "CNY" => number(settings, &["usd_exchange_rate", "usdExchangeRate"]).unwrap_or(7.0),
        "CUSTOM" => number(
            settings,
            &[
                "custom_currency_exchange_rate",
                "customCurrencyExchangeRate",
            ],
        )
        .unwrap_or(1.0),
        _ => 1.0,
    };
    Some(quota / quota_per_unit * exchange_rate)
}

pub(crate) fn parse_account(value: &Value) -> AccountInfo {
    let profile = data(value);
    AccountInfo {
        id: scalar_string(profile, &["id", "user_id", "userId"]),
        username: scalar_string(profile, &["username", "user_name"]),
        display_name: scalar_string(
            profile,
            &["display_name", "displayName", "nickname", "name"],
        ),
        email: optional_string(profile, &["email"]),
        group: optional_string(profile, &["group", "group_name", "groupName"]),
        role: scalar_string(profile, &["role", "role_name", "roleName"]),
        status: scalar_string(profile, &["status"]),
        balance: parse_balance(value),
    }
}

pub(crate) fn parse_offers(value: &Value, station: &Station) -> Vec<Offer> {
    let list = data(value)
        .as_array()
        .cloned()
        .unwrap_or_else(|| vec![data(value).clone()]);
    list.into_iter()
        .filter_map(|item| {
            let title = string(&item, &["title", "name"]);
            let summary = string(&item, &["content", "description", "notice"]);
            if title.is_empty() && summary.is_empty() {
                return None;
            }
            Some(Offer {
                id: if string(&item, &["id"]).is_empty() {
                    hash(&(title.clone() + &summary))
                } else {
                    string(&item, &["id"])
                },
                title: if title.is_empty() {
                    "站点公告".into()
                } else {
                    title
                },
                summary,
                source_url: station.base_url.clone(),
                published_at: item
                    .get("created_at")
                    .or_else(|| item.get("published_at"))
                    .and_then(Value::as_i64),
            })
        })
        .collect()
}

pub(crate) fn hash<T: Serialize>(value: &T) -> String {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    format!("{:x}", Sha256::digest(bytes))
}

pub(crate) fn title_from_html(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title")?;
    let content_start = lower[start..].find('>')? + start + 1;
    let end = lower[content_start..].find("</title>")? + content_start;
    let title = html[content_start..end]
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    (!title.is_empty()).then_some(title)
}

pub(crate) fn endpoint(station: &Station, path: &str) -> String {
    format!("{}{}", base(&station.base_url), path)
}

const CLOUDFLARE_BLOCK_MESSAGE: &str = "站点的 Cloudflare/WAF 拒绝了 API 请求。RelayHub 不会尝试绕过人机验证或访问控制；请由站点管理员为 API 路径配置受控访问策略、服务令牌或允许规则，然后重试。";

fn header_contains(headers: &HeaderMap, name: &str, needle: &str) -> bool {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().contains(needle))
}

fn is_cloudflare_block(status: StatusCode, headers: &HeaderMap, body: &str) -> bool {
    if header_contains(headers, "cf-mitigated", "challenge") {
        return true;
    }
    if !matches!(
        status,
        StatusCode::FORBIDDEN | StatusCode::SERVICE_UNAVAILABLE
    ) {
        return false;
    }
    let lower = body.to_ascii_lowercase();
    let has_cloudflare_header = headers.contains_key("cf-ray")
        || header_contains(headers, header::SERVER.as_str(), "cloudflare");
    let has_challenge_marker = [
        "cdn-cgi/challenge-platform",
        "cf-chl-",
        "cf-turnstile",
        "just a moment",
        "attention required",
        "error code: 1020",
        "cloudflare ray id",
    ]
    .iter()
    .any(|marker| lower.contains(marker));
    has_cloudflare_header && has_challenge_marker
}

fn rate_limit_hint(headers: &HeaderMap) -> &'static str {
    if headers.contains_key(header::RETRY_AFTER) {
        " 请按站点返回的 Retry-After 等待后再重试。"
    } else {
        " 请降低同步频率后再重试。"
    }
}

async fn decode_json_response(response: Response, fallback: &str) -> Result<Value, String> {
    let status = response.status();
    let headers = response.headers().clone();
    let body = response
        .text()
        .await
        .map_err(|error| format!("HTTP {status}: 读取站点响应失败：{error}"))?;

    if is_cloudflare_block(status, &headers, &body) {
        return Err(format!("HTTP {status}: {CLOUDFLARE_BLOCK_MESSAGE}"));
    }

    let value = serde_json::from_str::<Value>(&body).map_err(|_| {
        if status == StatusCode::TOO_MANY_REQUESTS {
            format!(
                "HTTP {status}: 请求过于频繁。{}",
                rate_limit_hint(&headers).trim()
            )
        } else {
            format!("HTTP {status}: 站点返回了无法识别的数据")
        }
    })?;
    if !status.is_success()
        || value.get("success") == Some(&Value::Bool(false))
        || value.get("code") == Some(&json!(-1))
    {
        let message = value
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or(fallback);
        let rate_limit = if status == StatusCode::TOO_MANY_REQUESTS {
            rate_limit_hint(&headers)
        } else {
            ""
        };
        return Err(format!("HTTP {status}: {message}{rate_limit}"));
    }
    Ok(value)
}

#[derive(Clone, Copy, Default)]
struct RequestAuth<'a> {
    token: Option<&'a str>,
    newapi_user_id: Option<&'a str>,
    newapi_session: Option<&'a str>,
    cookies: Option<&'a [PersistedCookie]>,
}

impl<'a> From<&'a Secret> for RequestAuth<'a> {
    fn from(secret: &'a Secret) -> Self {
        Self {
            token: secret.access_token.as_deref(),
            newapi_user_id: secret.newapi_user_id.as_deref(),
            newapi_session: secret.newapi_session.as_deref(),
            cookies: Some(&secret.newapi_cookies),
        }
    }
}

async fn request(
    client: &Client,
    station: &Station,
    auth: RequestAuth<'_>,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    request_with_cookie_updates(client, station, auth, method, path, body)
        .await
        .map(|(value, _)| value)
}

async fn request_with_cookie_updates(
    client: &Client,
    station: &Station,
    auth: RequestAuth<'_>,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<(Value, Vec<PersistedCookie>), String> {
    let request_url = endpoint(station, path);
    let mut call = client
        .request(method, &request_url)
        .timeout(std::time::Duration::from_secs(15));
    if station.kind == "newapi" {
        if let Some(user_id) = auth.newapi_user_id {
            call = call.header("New-Api-User", user_id);
        }
    }
    if let Ok(url) = Url::parse(&request_url) {
        let cookie_header = compose_cookie_header(auth.newapi_session, auth.cookies, &url);
        if let Some(cookie_header) = cookie_header {
            call = call.header(header::COOKIE, cookie_header);
        }
    }
    if station.kind != "newapi" {
        if let Some(token) = auth.token {
            call = call.bearer_auth(token);
        }
    }
    if let Some(body) = body {
        call = call.json(&body);
    }
    let response = call.send().await.map_err(|e| format!("请求失败：{e}"))?;
    let cookies = auth_cookies_for_station(response.headers(), station);
    let value = decode_json_response(response, "站点拒绝了请求").await?;
    Ok((value, cookies))
}

pub(crate) async fn detect_kind(client: &Client, url: &str) -> Result<String, String> {
    let temp = Station {
        id: String::new(),
        name: String::new(),
        base_url: base(url),
        kind: "auto".into(),
        status: String::new(),
        last_synced_at: None,
        last_error: None,
    };
    if let Ok(response) = client
        .get(endpoint(&temp, "/api/status"))
        .timeout(Duration::from_secs(15))
        .send()
        .await
    {
        if response.headers().contains_key("x-new-api-version") {
            return Ok("newapi".into());
        }
    }
    if request(
        client,
        &temp,
        RequestAuth::default(),
        Method::GET,
        "/api/v1/settings/public",
        None,
    )
    .await
    .is_ok()
    {
        return Ok("sub2api".into());
    }
    if request(
        client,
        &temp,
        RequestAuth::default(),
        Method::GET,
        "/api/status",
        None,
    )
    .await
    .is_ok()
    {
        return Ok("newapi".into());
    }
    Err("未识别为 New API 或 Sub2API，请确认网址和站点可访问性".into())
}

pub(crate) async fn registration_requires_email_verification(
    client: &Client,
    url: &str,
    kind: &str,
) -> Option<bool> {
    let path = match kind {
        "newapi" => "/api/status",
        "sub2api" => return Some(true),
        _ => return None,
    };
    let response = client
        .get(format!("{}{}", base(url), path))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .ok()?;
    let value = decode_json_response(response, "站点拒绝了请求")
        .await
        .ok()?;
    let payload = value.get("data").unwrap_or(&value);
    [
        "email_verification",
        "email_verification_enabled",
        "email_verify_enabled",
        "emailVerification",
        "emailVerificationEnabled",
        "emailVerifyEnabled",
    ]
    .iter()
    .find_map(|key| payload.get(*key).and_then(Value::as_bool))
}

pub(crate) fn session_cookie(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::SET_COOKIE)
        .iter()
        .find_map(|value| {
            let cookie = value.to_str().ok()?.split(';').next()?.trim();
            cookie.starts_with("session=").then(|| cookie.to_string())
        })
}

const PERSISTED_AUTH_COOKIE_NAMES: &[&str] = &[
    "session",
    "sessionid",
    "session_id",
    "sid",
    "auth_session",
    "auth_session_id",
];

fn is_persisted_auth_cookie_name(name: &str) -> bool {
    PERSISTED_AUTH_COOKIE_NAMES
        .iter()
        .any(|allowed| name.eq_ignore_ascii_case(allowed))
}

fn domain_matches(host: &str, domain: &str) -> bool {
    host == domain
        || host
            .strip_suffix(domain)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

fn parse_persisted_cookie(raw: &str, station: &Station) -> Option<PersistedCookie> {
    let host = Url::parse(&station.base_url)
        .ok()?
        .host_str()?
        .to_ascii_lowercase();
    let cookie = Cookie::parse(raw).ok()?.into_owned();
    if !is_persisted_auth_cookie_name(cookie.name()) {
        return None;
    }
    let domain = cookie
        .domain()
        .unwrap_or(&host)
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if !domain_matches(&host, &domain) {
        return None;
    }
    let expires_at = cookie
        .max_age()
        .and_then(|age| now().checked_add(age.whole_seconds()))
        .or_else(|| {
            cookie
                .expires_datetime()
                .map(|value| value.unix_timestamp())
        });
    Some(PersistedCookie {
        name: cookie.name().to_string(),
        value: cookie.value().to_string(),
        domain,
        path: cookie.path().unwrap_or("/").to_string(),
        expires_at,
        secure: cookie.secure().unwrap_or(false),
        http_only: cookie.http_only().unwrap_or(false),
    })
}

fn auth_cookies_for_station(headers: &HeaderMap, station: &Station) -> Vec<PersistedCookie> {
    headers
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .filter_map(|value| parse_persisted_cookie(value, station))
        .collect()
}

fn cookie_key(cookie: &PersistedCookie) -> (&str, &str, &str) {
    (&cookie.name, &cookie.domain, &cookie.path)
}

fn merge_persisted_auth_cookies(
    existing: &[PersistedCookie],
    incoming: &[PersistedCookie],
) -> Vec<PersistedCookie> {
    let current = now();
    let mut merged = existing
        .iter()
        .filter(|cookie| {
            !cookie.value.is_empty()
                && cookie
                    .expires_at
                    .is_none_or(|expires_at| expires_at > current)
        })
        .cloned()
        .collect::<Vec<_>>();
    for next in incoming {
        merged.retain(|cookie| cookie_key(cookie) != cookie_key(next));
        if !next.value.is_empty()
            && next
                .expires_at
                .is_none_or(|expires_at| expires_at > current)
        {
            merged.push(next.clone());
        }
    }
    merged
}

fn path_matches(cookie_path: &str, request_path: &str) -> bool {
    cookie_path == "/"
        || request_path == cookie_path
        || request_path.starts_with(&format!("{}/", cookie_path.trim_end_matches('/')))
}

fn compose_cookie_header(
    legacy_session: Option<&str>,
    cookies: Option<&[PersistedCookie]>,
    url: &Url,
) -> Option<String> {
    let host = url.host_str()?.to_ascii_lowercase();
    let path = url.path();
    let current = now();
    let mut parts = Vec::new();
    if let Some(legacy) = legacy_session {
        parts.extend(
            legacy
                .split(';')
                .map(str::trim)
                .filter(|part| {
                    part.split_once('=')
                        .is_some_and(|(name, value)| !name.is_empty() && !value.is_empty())
                })
                .map(str::to_string),
        );
    }
    if let Some(cookies) = cookies {
        for cookie in cookies {
            if cookie.value.is_empty()
                || cookie
                    .expires_at
                    .is_some_and(|expires_at| expires_at <= current)
                || !domain_matches(&host, &cookie.domain)
                || !path_matches(&cookie.path, path)
                || (cookie.secure && url.scheme() != "https")
            {
                continue;
            }
            let cookie_prefix = format!("{}=", cookie.name);
            parts.retain(|part| !part.starts_with(&cookie_prefix));
            parts.push(format!("{}={}", cookie.name, cookie.value));
        }
    }
    (!parts.is_empty()).then(|| parts.join("; "))
}

pub(crate) async fn login_request(
    client: &Client,
    station: &Station,
    path: &str,
    body: Value,
) -> Result<(Value, Option<String>, Vec<PersistedCookie>), String> {
    let response = client
        .post(endpoint(station, path))
        .timeout(std::time::Duration::from_secs(15))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败：{e}"))?;
    let session = session_cookie(response.headers());
    let cookies = auth_cookies_for_station(response.headers(), station);
    let value = decode_json_response(response, "站点拒绝了请求").await?;
    Ok((value, session, cookies))
}

pub(crate) async fn register(
    client: &Client,
    station: &Station,
    email: &str,
    username: &str,
    password: &str,
    verification_code: &str,
) -> Result<(), String> {
    let adapter = StationAdapter::for_station(station)?;
    login_request(
        client,
        station,
        adapter.register_path(),
        adapter.register_body(email, username, password, verification_code),
    )
    .await
    .map(|_| ())
}

pub(crate) async fn send_registration_verification_code(
    client: &Client,
    station: &Station,
    email: &str,
) -> Result<String, String> {
    let adapter = StationAdapter::for_station(station)?;
    let request = if let Some(body) = adapter.register_verification_body(email) {
        client
            .post(endpoint(station, adapter.register_verification_path()))
            .json(&body)
    } else {
        client
            .get(endpoint(station, adapter.register_verification_path()))
            .query(&[("email", email)])
    };
    let response = request
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    let value = decode_json_response(response, "邮箱验证码发送失败").await?;
    Ok(value
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("邮箱验证码已发送。")
        .to_string())
}

pub(crate) async fn authenticate(
    client: &Client,
    station: &Station,
    secret: &mut Secret,
    totp: Option<&str>,
) -> Result<(), String> {
    let adapter = StationAdapter::for_station(station)?;
    let (login, login_session, login_cookies) = login_request(
        client,
        station,
        adapter.login_path(),
        adapter.login_body(&secret.username, &secret.password),
    )
    .await?;
    let (authentication, session, cookies) = if data(&login)
        .get("require_2fa")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let code = totp.ok_or("该站点需要 TOTP 验证码")?;
        let (verify, verify_session, verify_cookies) = login_request(
            client,
            station,
            adapter.login_2fa_path(),
            json!({"flow_token": data(&login)["flow_token"], "code": code, "totp": code}),
        )
        .await?;
        (
            verify,
            verify_session.or(login_session),
            merge_persisted_auth_cookies(&login_cookies, &verify_cookies),
        )
    } else {
        (login, login_session, login_cookies)
    };
    let authentication_data = data(&authentication);
    copy_tokens(secret, authentication_data);
    secret.requires_reauth = false;
    secret.last_refresh_at = Some(now());
    secret.last_refresh_error = None;
    secret.next_refresh_retry_at = None;
    if station.kind == "newapi" {
        secret.newapi_user_id = authentication_data.get("id").and_then(|id| {
            id.as_str()
                .map(str::to_string)
                .or_else(|| id.as_i64().map(|id| id.to_string()))
        });
        secret.newapi_session = session;
        secret.newapi_cookies = cookies;
        if secret.newapi_user_id.is_none() {
            return Err("登录成功，但站点未返回用户标识".into());
        }
        if secret.newapi_session.is_none() && secret.newapi_cookies.is_empty() {
            return Err("登录成功，但站点未返回可保存的会话".into());
        }
    } else if secret.access_token.is_none() {
        return Err("登录成功，但站点未返回可保存的登录令牌".into());
    }
    Ok(())
}

pub(crate) fn copy_tokens(secret: &mut Secret, value: &Value) {
    if let Some(token) = value
        .get("access_token")
        .or_else(|| value.get("accessToken"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        secret.access_token = Some(token.to_string());
    }
    if let Some(expires_in) = integer(value, &["expires_in", "expiresIn"]) {
        secret.access_token_expires_at = Some(now() + expires_in.max(0));
    }
    if let Some(token) = value
        .get("refresh_token")
        .or_else(|| value.get("refreshToken"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|token| !token.is_empty())
    {
        secret.refresh_token = Some(token.to_string());
    }
    secret.version = 3;
    secret.last_refresh_error = None;
    secret.next_refresh_retry_at = None;
}

pub(crate) async fn load_authenticated_secret(
    state: &AppState,
    station: &Station,
) -> Result<Secret, String> {
    let mut secret = load_secret(&station.id)?;
    if secret.requires_reauth {
        return Err("refresh token invalid: 请重新登录该站点".into());
    }
    if (station.kind == "newapi" && !has_newapi_login_session(&secret))
        || (station.kind != "newapi"
            && (secret.access_token.is_none()
                || secret
                    .access_token_expires_at
                    .is_some_and(|expires_at| expires_at <= now() + TOKEN_REFRESH_LEEWAY_SECONDS)))
    {
        refresh_session(state, station, &mut secret, None, false).await?;
    }
    Ok(secret)
}

fn has_newapi_login_session(secret: &Secret) -> bool {
    secret.newapi_user_id.is_some()
        && (secret.newapi_session.is_some()
            || secret.newapi_cookies.iter().any(|cookie| {
                !cookie.value.is_empty()
                    && cookie
                        .expires_at
                        .is_none_or(|expires_at| expires_at > now())
            }))
}

pub(crate) fn is_unauthorized(error: &str) -> bool {
    error.starts_with("HTTP 401 ") || error.starts_with("HTTP 401:")
}

pub(crate) async fn refresh_session(
    state: &AppState,
    station: &Station,
    secret: &mut Secret,
    totp: Option<&str>,
    bypass_backoff: bool,
) -> Result<(), String> {
    let refresh_lock = refresh_lock_for_station(&state.refresh_locks, &station.id)?;
    let _refresh_guard = refresh_lock.lock().await;
    if let Ok(latest) = load_secret(&station.id) {
        *secret = latest;
    }
    if secret.requires_reauth && !bypass_backoff {
        return Err("refresh token invalid: 请重新登录该站点".into());
    }
    if !bypass_backoff
        && secret.access_token.is_some()
        && secret
            .access_token_expires_at
            .is_some_and(|expires_at| expires_at > now() + TOKEN_REFRESH_LEEWAY_SECONDS)
    {
        return Ok(());
    }
    if !bypass_backoff {
        if let Some(backoff) = state
            .auth_backoff
            .lock()
            .map_err(|_| "认证状态不可用".to_string())?
            .get(&station.id)
        {
            if backoff.retry_after > now() {
                return Err(format!("自动登录暂缓 {} 秒", backoff.retry_after - now()));
            }
        }
        if let Some(retry_at) = secret.next_refresh_retry_at {
            if retry_at > now() {
                return Err(format!("令牌刷新暂缓 {} 秒", retry_at - now()));
            }
        }
    }
    if station.kind == "sub2api" && secret.refresh_token.is_some() {
        match refresh_access_token(state, station, secret).await {
            Ok(()) => {
                secret.requires_reauth = false;
                secret.last_refresh_at = Some(now());
                secret.last_refresh_error = None;
                secret.next_refresh_retry_at = None;
                state
                    .auth_backoff
                    .lock()
                    .map_err(|_| "认证状态不可用".to_string())?
                    .remove(&station.id);
                return save_secret(&station.id, secret);
            }
            Err(error) if !bypass_backoff => {
                record_refresh_failure(secret, &error, now());
                let _ = save_secret(&station.id, secret);
                return Err(error);
            }
            Err(_) => {}
        }
    }
    match authenticate(&state.client, station, secret, totp).await {
        Ok(()) => {
            state
                .auth_backoff
                .lock()
                .map_err(|_| "认证状态不可用".to_string())?
                .remove(&station.id);
            save_secret(&station.id, secret)
        }
        Err(error) => {
            let mut backoff = state
                .auth_backoff
                .lock()
                .map_err(|_| "认证状态不可用".to_string())?;
            let attempts = backoff
                .get(&station.id)
                .map(|value| value.attempts.saturating_add(1))
                .unwrap_or(1)
                .min(6);
            let delay = 30_i64 * (1_i64 << (attempts - 1));
            backoff.insert(
                station.id.clone(),
                AuthBackoff {
                    attempts,
                    retry_after: now() + delay,
                },
            );
            Err(error)
        }
    }
}

fn record_refresh_failure(secret: &mut Secret, error: &str, current_time: i64) {
    secret.last_refresh_error = Some(classify_refresh_error(error).into());
    if is_refresh_token_invalid(error) {
        secret.access_token = None;
        secret.access_token_expires_at = None;
        secret.refresh_token = None;
        secret.requires_reauth = true;
        secret.next_refresh_retry_at = None;
    } else {
        secret.next_refresh_retry_at = Some(current_time + 60);
    }
}

fn refresh_lock_for_station(
    locks: &Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    station_id: &str,
) -> Result<Arc<tokio::sync::Mutex<()>>, String> {
    let mut locks = locks.lock().map_err(|_| "认证状态不可用".to_string())?;
    Ok(locks
        .entry(station_id.to_string())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone())
}

async fn refresh_access_token(
    state: &AppState,
    station: &Station,
    secret: &mut Secret,
) -> Result<(), String> {
    let refresh_token = secret
        .refresh_token
        .as_deref()
        .ok_or("站点没有可用的刷新令牌")?;
    let value = request(
        &state.client,
        station,
        RequestAuth::default(),
        Method::POST,
        "/api/v1/auth/refresh",
        Some(json!({"refresh_token": refresh_token})),
    )
    .await
    .map_err(|error| {
        if is_refresh_token_invalid(&error) {
            format!("refresh token invalid: {error}")
        } else {
            error
        }
    })?;
    copy_tokens(secret, data(&value));
    secret
        .access_token
        .as_ref()
        .filter(|token| !token.trim().is_empty())
        .map(|_| ())
        .ok_or("刷新令牌响应中没有访问令牌".into())
}

fn is_refresh_token_invalid(error: &str) -> bool {
    let lower = error.to_ascii_lowercase();
    lower.contains("http 401")
        || lower.contains("invalid refresh")
        || lower.contains("refresh token expired")
        || lower.contains("refresh token revoked")
}

fn classify_refresh_error(error: &str) -> &'static str {
    let lower = error.to_ascii_lowercase();
    if is_refresh_token_invalid(error) {
        "invalid_refresh_token"
    } else if lower.contains("http 429") || lower.contains("rate") {
        "rate_limited"
    } else if lower.contains("cloudflare") || lower.contains("turnstile") {
        "turnstile_or_cloudflare"
    } else if lower.contains("http 5")
        || lower.contains("timeout")
        || lower.contains("request failed")
        || lower.contains("error sending request")
        || lower.contains("connection")
        || lower.contains("network")
        || lower.contains("dns")
        || lower.contains("请求失败")
        || lower.contains("网络")
        || lower.contains("超时")
    {
        "temporary_network_error"
    } else {
        "refresh_failed"
    }
}

pub(crate) async fn station_request(
    state: &AppState,
    station: &Station,
    secret: &mut Secret,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let response = request_with_cookie_updates(
        &state.client,
        station,
        RequestAuth::from(&*secret),
        method.clone(),
        path,
        body.clone(),
    )
    .await;
    match response {
        Ok((value, cookies)) => {
            persist_response_cookies(station, secret, &cookies)?;
            Ok(value)
        }
        Err(error) if is_unauthorized(&error) => {
            refresh_session(state, station, secret, None, false).await?;
            let (value, cookies) = request_with_cookie_updates(
                &state.client,
                station,
                RequestAuth::from(&*secret),
                method,
                path,
                body,
            )
            .await?;
            persist_response_cookies(station, secret, &cookies)?;
            Ok(value)
        }
        Err(error) => Err(error),
    }
}

fn persist_response_cookies(
    station: &Station,
    secret: &mut Secret,
    incoming: &[PersistedCookie],
) -> Result<(), String> {
    if station.kind != "newapi" || incoming.is_empty() {
        return Ok(());
    }
    let merged = merge_persisted_auth_cookies(&secret.newapi_cookies, incoming);
    if merged == secret.newapi_cookies {
        return Ok(());
    }
    secret.newapi_cookies = merged;
    secret.newapi_session = secret
        .newapi_cookies
        .iter()
        .find(|cookie| cookie.name.eq_ignore_ascii_case("session"))
        .map(|cookie| format!("session={}", cookie.value));
    save_secret(&station.id, secret)
}

pub(crate) async fn fetch_all_pages(
    state: &AppState,
    station: &Station,
    secret: &mut Secret,
    adapter: StationAdapter,
    resource: PagedResource,
) -> Result<Value, String> {
    let page_size = 100_i64;
    let mut page = adapter.first_page();
    let mut items = Vec::new();
    loop {
        let path = adapter.paged_path(resource, page, page_size);
        let value = station_request(state, station, secret, Method::GET, &path, None).await?;
        let root = data(&value);
        let items_for_page = page_items(&value);
        let count = items_for_page.len();
        items.extend(items_for_page);
        let total = integer(root, &["total"]).or_else(|| integer(&value, &["total"]));
        if count == 0
            || count < page_size as usize
            || total.is_some_and(|total| items.len() as i64 >= total)
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
        page += 1;
    }
    Ok(json!({"data": {"items": items}}))
}

pub(crate) async fn fetch_snapshot(
    state: &AppState,
    station: &Station,
    secret: &mut Secret,
) -> Result<StationSnapshot, String> {
    let mut snapshot = StationSnapshot::default();
    let adapter = StationAdapter::for_station(station)?;
    snapshot.capabilities = adapter.capabilities();
    if adapter == StationAdapter::Sub2Api {
        let value = station_request(
            state,
            station,
            secret,
            Method::GET,
            adapter.profile_path(),
            None,
        )
        .await;
        if let Ok(value) = value {
            snapshot.station_balance = parse_balance(&value);
            snapshot.account = parse_account(&value);
            snapshot.usage = usage_from_profile(&value);
            if let Ok(value) =
                fetch_all_pages(state, station, secret, adapter, PagedResource::Usage).await
            {
                snapshot.usage =
                    merge_usage(snapshot.usage, usage_from_logs(&value, start_of_today()));
            }
        } else {
            snapshot.unavailable.push("账户信息不可获取".into());
        }
        match fetch_sub2_group_rates(state, station, secret).await {
            Ok(rates) => snapshot.rates = rates,
            Err(_) => snapshot
                .unavailable
                .push("分组倍率未公开或当前账户无权限".into()),
        }
        match fetch_all_pages(state, station, secret, adapter, PagedResource::Keys).await {
            Ok(value) => snapshot.api_keys = parse_keys(&value, adapter),
            Err(_) => snapshot.unavailable.push("API 密钥列表不可获取".into()),
        }
        match station_request(
            state,
            station,
            secret,
            Method::GET,
            "/api/v1/announcements",
            None,
        )
        .await
        {
            Ok(value) => snapshot.offers = parse_offers(&value, station),
            Err(_) => snapshot.unavailable.push("优惠公告不可获取".into()),
        }
    } else {
        let value = station_request(
            state,
            station,
            secret,
            Method::GET,
            adapter.profile_path(),
            None,
        )
        .await;
        if let Ok(value) = value {
            let status =
                station_request(state, station, secret, Method::GET, "/api/status", None).await;
            snapshot.station_balance = newapi_display_balance(&value, status.as_ref().ok());
            snapshot.account = parse_account(&value);
            snapshot.account.balance = snapshot.station_balance;
            snapshot.usage = usage_from_profile(&value);
            if let Ok(value) =
                fetch_all_pages(state, station, secret, adapter, PagedResource::Usage).await
            {
                snapshot.usage =
                    merge_usage(snapshot.usage, usage_from_logs(&value, start_of_today()));
            }
        } else {
            snapshot.unavailable.push("账户信息不可获取".into());
        }
        let pricing =
            station_request(state, station, secret, Method::GET, "/api/pricing", None).await;
        match pricing {
            Ok(value) => {
                snapshot.rates = pricing_group_ratio(&value)
                    .map(map_rates)
                    .unwrap_or_default()
            }
            Err(_) => snapshot
                .unavailable
                .push("分组倍率未公开或当前账户无权限".into()),
        }
        match fetch_all_pages(state, station, secret, adapter, PagedResource::Keys).await {
            Ok(value) => snapshot.api_keys = parse_keys(&value, adapter),
            Err(_) => snapshot.unavailable.push("API 密钥列表不可获取".into()),
        }
        let notice =
            station_request(state, station, secret, Method::GET, "/api/notice", None).await;
        if let Ok(value) = notice {
            snapshot.offers = parse_offers(&value, station);
        } else {
            snapshot.unavailable.push("优惠公告不可获取".into());
        }
    }
    finalize_sync_statuses(&mut snapshot);
    Ok(snapshot)
}

fn finalize_sync_statuses(snapshot: &mut StationSnapshot) {
    let now = now();
    let components = [
        ("account", "账户信息不可获取"),
        ("api_keys", "API 密钥列表不可获取"),
        ("groups", "分组倍率未公开或当前账户无权限"),
        ("announcements", "优惠公告不可获取"),
    ];
    for (key, error) in components {
        if snapshot.sync_statuses.contains_key(key) {
            continue;
        }
        let failed = snapshot.unavailable.iter().any(|item| item == error);
        snapshot.sync_statuses.insert(
            key.into(),
            SyncComponentState {
                status: if failed {
                    "failed".into()
                } else {
                    "success".into()
                },
                last_synced_at: (!failed).then_some(now),
                error: failed.then(|| "unavailable".into()),
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc, Mutex,
        },
        time::Duration,
    };

    use axum::{
        http::{header, HeaderMap, StatusCode, Uri},
        routing::{get, post},
        Json, Router,
    };
    use chrono::DateTime;
    use reqwest::Client;
    use serde_json::{json, Value};
    use tokio::sync::oneshot;

    use super::{
        auth_cookies_for_station, classify_refresh_error, compose_cookie_header, copy_tokens,
        describe_changes, finalize_sync_statuses, has_newapi_login_session, is_cloudflare_block,
        is_refresh_token_invalid, is_unauthorized, map_rates, map_sub2_group_rates, mask_api_key,
        merge_persisted_auth_cookies, model_response_text, newapi_display_balance, parse_balance,
        parse_keys, parse_usage_logs, pricing_group_ratio, rate_limit_hint, record_refresh_failure,
        refresh_lock_for_station, request_with_cookie_updates, retain_group_descriptions,
        session_cookie, usage_from_logs, RequestAuth,
    };
    use crate::support::now;
    use crate::{
        keyring_store::{PersistedCookie, Secret},
        models::{Offer, StationSnapshot},
        station_adapter::{Station, StationAdapter},
    };
    use url::Url;

    fn test_secret() -> Secret {
        Secret {
            version: 3,
            username: "user@example.com".into(),
            password: "not-used-by-restored-session-tests".into(),
            access_token: Some("restored-access-token".into()),
            access_token_expires_at: Some(now() + 3_600),
            refresh_token: Some("restored-refresh-token".into()),
            requires_reauth: false,
            last_refresh_at: None,
            last_refresh_error: None,
            next_refresh_retry_at: None,
            newapi_user_id: None,
            newapi_session: None,
            newapi_cookies: Vec::new(),
        }
    }

    fn test_station(base_url: String, kind: &str) -> Station {
        Station {
            id: format!("{kind}-station"),
            name: "Test station".into(),
            base_url,
            kind: kind.into(),
            status: "online".into(),
            last_synced_at: None,
            last_error: None,
        }
    }

    async fn start_test_server(app: Router) -> (String, oneshot::Sender<()>) {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind test server");
        let address = listener.local_addr().expect("read test server address");
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await
                .expect("serve test server");
        });
        (format!("http://{address}"), shutdown_tx)
    }

    async fn restored_auth_handler(headers: HeaderMap, uri: Uri) -> (StatusCode, Json<Value>) {
        let authorized = match uri.path() {
            "/token" => {
                headers
                    .get(header::AUTHORIZATION)
                    .and_then(|value| value.to_str().ok())
                    == Some("Bearer restored-access-token")
            }
            "/cookie" => {
                headers
                    .get(header::COOKIE)
                    .and_then(|value| value.to_str().ok())
                    .is_some_and(|value| value.contains("sid=restored-cookie"))
                    && headers
                        .get("new-api-user")
                        .and_then(|value| value.to_str().ok())
                        == Some("42")
            }
            _ => false,
        };
        if authorized {
            (StatusCode::OK, Json(json!({"success": true, "data": {}})))
        } else {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"success": false, "message": "missing restored credentials"})),
            )
        }
    }

    async fn refresh_401() -> (StatusCode, Json<Value>) {
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({"success": false, "message": "invalid refresh token"})),
        )
    }

    async fn refresh_429() -> (StatusCode, Json<Value>) {
        (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"success": false, "message": "rate limited"})),
        )
    }

    async fn refresh_502() -> (StatusCode, Json<Value>) {
        (
            StatusCode::BAD_GATEWAY,
            Json(json!({"success": false, "message": "upstream unavailable"})),
        )
    }

    #[tokio::test]
    async fn restored_tokens_and_cookies_are_used_without_login() {
        let app = Router::new()
            .route("/token", get(restored_auth_handler))
            .route("/cookie", get(restored_auth_handler));
        let (base_url, shutdown) = start_test_server(app).await;
        let client = Client::new();

        let restored_token_secret: Secret = serde_json::from_str(
            &serde_json::to_string(&test_secret()).expect("serialize persisted token secret"),
        )
        .expect("deserialize persisted token secret");
        let token_station = test_station(base_url.clone(), "sub2api");
        request_with_cookie_updates(
            &client,
            &token_station,
            RequestAuth::from(&restored_token_secret),
            reqwest::Method::GET,
            "/token",
            None,
        )
        .await
        .expect("restored access token should authorize without login");

        let mut cookie_secret = test_secret();
        cookie_secret.access_token = None;
        cookie_secret.refresh_token = None;
        cookie_secret.newapi_user_id = Some("42".into());
        cookie_secret.newapi_cookies = vec![PersistedCookie {
            name: "sid".into(),
            value: "restored-cookie".into(),
            domain: "127.0.0.1".into(),
            path: "/".into(),
            expires_at: Some(now() + 3_600),
            secure: false,
            http_only: true,
        }];
        let restored_cookie_secret: Secret = serde_json::from_str(
            &serde_json::to_string(&cookie_secret).expect("serialize persisted cookie secret"),
        )
        .expect("deserialize persisted cookie secret");
        let cookie_station = test_station(base_url, "newapi");
        request_with_cookie_updates(
            &client,
            &cookie_station,
            RequestAuth::from(&restored_cookie_secret),
            reqwest::Method::GET,
            "/cookie",
            None,
        )
        .await
        .expect("restored auth cookie should authorize without login");

        let _ = shutdown.send(());
    }

    #[tokio::test]
    async fn serializes_same_station_refreshes() {
        let locks = Arc::new(Mutex::new(HashMap::new()));
        let active = Arc::new(AtomicUsize::new(0));
        let max_active = Arc::new(AtomicUsize::new(0));

        let refresh = |locks: Arc<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>>,
                       active: Arc<AtomicUsize>,
                       max_active: Arc<AtomicUsize>| async move {
            let lock = refresh_lock_for_station(&locks, "station-a").expect("get refresh lock");
            let _guard = lock.lock().await;
            let current = active.fetch_add(1, Ordering::SeqCst) + 1;
            max_active.fetch_max(current, Ordering::SeqCst);
            tokio::time::sleep(Duration::from_millis(30)).await;
            active.fetch_sub(1, Ordering::SeqCst);
        };

        tokio::join!(
            refresh(locks.clone(), active.clone(), max_active.clone()),
            refresh(locks.clone(), active.clone(), max_active.clone()),
        );

        assert_eq!(max_active.load(Ordering::SeqCst), 1);
        let first = refresh_lock_for_station(&locks, "station-a").expect("same station lock");
        let second = refresh_lock_for_station(&locks, "station-a").expect("same station lock");
        let other = refresh_lock_for_station(&locks, "station-b").expect("other station lock");
        assert!(Arc::ptr_eq(&first, &second));
        assert!(!Arc::ptr_eq(&first, &other));
    }

    #[tokio::test]
    async fn refresh_http_failures_and_network_errors_are_classified() {
        let app = Router::new()
            .route("/refresh-401", post(refresh_401))
            .route("/refresh-429", post(refresh_429))
            .route("/refresh-502", post(refresh_502));
        let (base_url, shutdown) = start_test_server(app).await;
        let client = Client::new();
        let station = test_station(base_url, "sub2api");

        for (path, expected) in [
            ("/refresh-401", "invalid_refresh_token"),
            ("/refresh-429", "rate_limited"),
            ("/refresh-502", "temporary_network_error"),
        ] {
            let error = match request_with_cookie_updates(
                &client,
                &station,
                RequestAuth::default(),
                reqwest::Method::POST,
                path,
                None,
            )
            .await
            {
                Ok(_) => panic!("refresh endpoint should reject the request"),
                Err(error) => error,
            };
            assert_eq!(
                classify_refresh_error(&error),
                expected,
                "unexpected refresh error: {error}"
            );
        }

        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("reserve unavailable port");
        let unavailable_base_url = format!("http://{}", listener.local_addr().expect("read port"));
        drop(listener);
        let network_station = test_station(unavailable_base_url, "sub2api");
        let network_error = match request_with_cookie_updates(
            &client,
            &network_station,
            RequestAuth::default(),
            reqwest::Method::POST,
            "/refresh",
            None,
        )
        .await
        {
            Ok(_) => panic!("closed local port should fail the request"),
            Err(error) => error,
        };
        assert_eq!(
            classify_refresh_error(&network_error),
            "temporary_network_error"
        );

        let _ = shutdown.send(());
    }

    #[test]
    fn invalid_refresh_clears_credentials_but_retryable_failures_preserve_them() {
        let current_time = 1_800_000_000;
        let mut invalid_secret = test_secret();
        record_refresh_failure(
            &mut invalid_secret,
            "HTTP 401 Unauthorized: invalid refresh token",
            current_time,
        );
        assert!(invalid_secret.access_token.is_none());
        assert!(invalid_secret.refresh_token.is_none());
        assert!(invalid_secret.requires_reauth);
        assert!(invalid_secret.next_refresh_retry_at.is_none());
        assert_eq!(
            invalid_secret.last_refresh_error.as_deref(),
            Some("invalid_refresh_token")
        );

        for (error, category) in [
            ("HTTP 429 Too Many Requests: rate limited", "rate_limited"),
            (
                "HTTP 502 Bad Gateway: upstream unavailable",
                "temporary_network_error",
            ),
            (
                "request failed: error sending request",
                "temporary_network_error",
            ),
        ] {
            let mut secret = test_secret();
            record_refresh_failure(&mut secret, error, current_time);
            assert_eq!(
                secret.access_token.as_deref(),
                Some("restored-access-token")
            );
            assert_eq!(
                secret.refresh_token.as_deref(),
                Some("restored-refresh-token")
            );
            assert!(!secret.requires_reauth);
            assert_eq!(secret.next_refresh_retry_at, Some(current_time + 60));
            assert_eq!(secret.last_refresh_error.as_deref(), Some(category));
            assert!(!is_refresh_token_invalid(error));
        }
    }

    #[test]
    fn normalizes_newapi_numeric_key_status_and_quota() {
        let value = json!({"data": [{"id": 12, "name": "newapi", "status": 1, "remain_quota": 80.0, "used_quota": 20.0, "group": "default"}]});
        let key = parse_keys(&value, StationAdapter::NewApi).pop().unwrap();
        assert_eq!(key.id, "12");
        assert_eq!(key.status, "active");
        assert_eq!(key.remaining_quota, Some(80.0));
        assert_eq!(key.total_quota, Some(100.0));
        assert!(!key.unlimited_quota);
    }

    #[test]
    fn persists_only_first_party_auth_cookies() {
        let station = Station {
            id: "station".into(),
            name: "Station".into(),
            base_url: "https://api.example.com".into(),
            kind: "newapi".into(),
            status: "online".into(),
            last_synced_at: None,
            last_error: None,
        };
        let mut headers = HeaderMap::new();
        headers.append(
            header::SET_COOKIE,
            "session=abc; Path=/; HttpOnly; Secure".parse().unwrap(),
        );
        headers.append(
            header::SET_COOKIE,
            "sid=xyz; Domain=.example.com; Path=/api".parse().unwrap(),
        );
        headers.append(
            header::SET_COOKIE,
            "tracking=ignored; Domain=tracker.example".parse().unwrap(),
        );

        let cookies = auth_cookies_for_station(&headers, &station);

        assert_eq!(cookies.len(), 2);
        assert_eq!(cookies[0].domain, "api.example.com");
        assert!(cookies[0].secure);
        assert_eq!(cookies[1].domain, "example.com");
        assert_eq!(cookies[1].path, "/api");
    }

    #[test]
    fn restores_only_matching_unexpired_cookies_and_keeps_legacy_session() {
        let cookies = vec![
            PersistedCookie {
                name: "sid".into(),
                value: "xyz".into(),
                domain: "example.com".into(),
                path: "/api".into(),
                expires_at: None,
                secure: true,
                http_only: true,
            },
            PersistedCookie {
                name: "sessionid".into(),
                value: "expired".into(),
                domain: "example.com".into(),
                path: "/".into(),
                expires_at: Some(now() - 1),
                secure: true,
                http_only: true,
            },
        ];
        let url = Url::parse("https://api.example.com/api/v1/profile").unwrap();

        let header = compose_cookie_header(Some("session=legacy"), Some(&cookies), &url).unwrap();

        assert_eq!(header, "session=legacy; sid=xyz");
        assert_eq!(merge_persisted_auth_cookies(&cookies, &[]).len(), 1);
    }

    #[test]
    fn accepts_a_persisted_auth_cookie_as_a_newapi_login_session() {
        let secret = Secret {
            version: 3,
            username: "user".into(),
            password: "secret".into(),
            access_token: None,
            access_token_expires_at: None,
            refresh_token: None,
            requires_reauth: false,
            last_refresh_at: None,
            last_refresh_error: None,
            next_refresh_retry_at: None,
            newapi_user_id: Some("42".into()),
            newapi_session: None,
            newapi_cookies: vec![PersistedCookie {
                name: "sessionid".into(),
                value: "saved".into(),
                domain: "example.com".into(),
                path: "/".into(),
                expires_at: None,
                secure: true,
                http_only: true,
            }],
        };

        assert!(has_newapi_login_session(&secret));
    }

    #[test]
    fn converts_newapi_balance_using_public_currency_settings() {
        let profile = json!({"data": {"quota": 14_533.0}});
        let status = json!({"data": {
            "quota_per_unit": 500_000.0,
            "display_in_currency": true,
            "quota_display_type": "CNY",
            "usd_exchange_rate": 7.0
        }});

        let balance = newapi_display_balance(&profile, Some(&status)).unwrap();

        assert!((balance - 0.203462).abs() < f64::EPSILON);
    }

    #[test]
    fn parses_cc_switch_usage_remaining_balance() {
        assert_eq!(parse_balance(&json!({"remaining": 4.72})), Some(4.72));
    }

    #[test]
    fn converts_newapi_quota_to_usd_without_currency_overrides() {
        let profile = json!({"data": {"quota": 495_000.0}});

        assert_eq!(newapi_display_balance(&profile, None), Some(0.99));
    }

    #[test]
    fn preserves_newapi_quota_when_currency_display_is_disabled() {
        let profile = json!({"data": {"quota": 14_533.0}});
        let status = json!({"data": {"display_in_currency": false}});

        assert_eq!(
            newapi_display_balance(&profile, Some(&status)),
            Some(14_533.0)
        );
    }

    #[test]
    fn merges_sub2_available_groups_with_user_rate_overrides() {
        let groups = json!({"data": [
            {"id": 1, "name": "standard", "description": "标准通道", "rate_multiplier": 1.0},
            {"id": 2, "name": "vip", "rate_multiplier": 0.8}
        ]});
        let overrides = json!({"data": {"2": 0.5}});

        let rates = map_sub2_group_rates(&groups, &overrides);

        assert_eq!(rates.len(), 2);
        assert_eq!(rates[0].group, "standard");
        assert_eq!(rates[0].group_description.as_deref(), Some("标准通道"));
        assert_eq!(rates[0].multiplier, 1.0);
        assert_eq!(rates[1].group, "vip");
        assert_eq!(rates[1].multiplier, 0.5);
    }

    #[test]
    fn accepts_wrapped_sub2_groups_and_string_multipliers() {
        let groups = json!({"data": {"groups": [
            {"id": "standard", "name": "standard", "description": "高速通道", "rateMultiplier": "1.25"},
            "vip"
        ]}});
        let overrides = json!({"data": {"rates": {"vip": {"multiplier": "0.5"}}}});

        let rates = map_sub2_group_rates(&groups, &overrides);

        assert_eq!(rates.len(), 2);
        assert_eq!(rates[0].multiplier, 1.25);
        assert_eq!(rates[0].group_description.as_deref(), Some("高速通道"));
        assert_eq!(rates[1].group, "vip");
        assert_eq!(rates[1].multiplier, 0.5);
    }

    #[test]
    fn reads_newapi_group_ratios_from_root_or_data() {
        let root = json!({"data": [], "group_ratio": {"default": 1.0, "pro": 0.7}});
        let nested = json!({"data": {"group_ratio": {"standard": 1.2}}});

        let root_rates = map_rates(pricing_group_ratio(&root).unwrap());
        let nested_rates = map_rates(pricing_group_ratio(&nested).unwrap());

        assert_eq!(root_rates.len(), 2);
        assert_eq!(root_rates[1].group, "pro");
        assert_eq!(root_rates[1].multiplier, 0.7);
        assert_eq!(nested_rates.len(), 1);
        assert_eq!(nested_rates[0].group, "standard");
        assert_eq!(nested_rates[0].multiplier, 1.2);
    }

    #[test]
    fn normalizes_sub2api_group_object_and_quota() {
        let value = json!({"items": [{"id": "k1", "status": "active", "quota": 100.0, "quota_used": 25.0, "group": {"name": "vip", "group_id": "g2"}}]});
        let key = parse_keys(&value, StationAdapter::Sub2Api).pop().unwrap();
        assert_eq!(key.group.as_deref(), Some("vip"));
        assert_eq!(key.remaining_quota, Some(75.0));
        assert_eq!(key.total_quota, Some(100.0));
        assert_eq!(key.used_quota, Some(25.0));
    }

    #[test]
    fn parses_compatible_key_group_and_timestamps() {
        let value = json!({"data": [{
            "id": "k1",
            "groupName": "premium",
            "expiredAt": "1800000000000",
            "createdAt": 1_700_000_000_000_i64
        }]});
        let key = parse_keys(&value, StationAdapter::Sub2Api).pop().unwrap();
        assert_eq!(key.group.as_deref(), Some("premium"));
        assert_eq!(key.expires_at, Some(1_800_000_000));
        assert_eq!(key.created_at, Some(1_700_000_000));
    }

    #[test]
    fn parses_today_usage_from_millisecond_logs() {
        let logs = json!({"data": {"items": [
            {"created_at": 1_720_000_000_000_i64, "prompt_tokens": 1300, "completion_tokens": 540, "quota": 1.1064},
            {"created_at": 1_719_000_000_000_i64, "prompt_tokens": 900, "completion_tokens": 100, "quota": 0.4}
        ]}});
        let usage = usage_from_logs(&logs, 1_719_500_000);
        assert_eq!(usage.today_requests, Some(1));
        assert_eq!(usage.today_input_tokens, Some(1300));
        assert_eq!(usage.today_output_tokens, Some(540));
        assert_eq!(usage.today_spent, Some(1.1064));
    }

    #[test]
    fn parses_usage_records_with_source_metadata_and_iso_timestamps() {
        let station = test_station("https://relay.example.com".into(), "sub2api");
        let value = json!({
            "data": {
                "items": [{
                    "id": 7,
                    "created_at": "2026-08-05T08:00:00Z",
                    "model": "gpt-4o",
                    "api_key": {"name": "team-key"},
                    "input_tokens": 120,
                    "output_tokens": 40,
                    "input_cost": 0.030675,
                    "output_cost": 0.006975,
                    "cache_creation_cost": 0.016075,
                    "cache_read_cost": 0.003891,
                    "total_cost": 0.057616,
                    "actual_cost": 0.003716,
                    "rate_multiplier": 0.04,
                    "service_tier": "standard",
                    "billing_type": 1,
                    "request_type": "stream",
                    "duration_ms": 2000
                }]
            }
        });

        let logs = parse_usage_logs(&value, &station);

        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].station_id, station.id);
        assert_eq!(logs[0].station_name, station.name);
        assert_eq!(logs[0].station_url, station.base_url);
        assert_eq!(logs[0].api_key_name.as_deref(), Some("team-key"));
        assert_eq!(
            logs[0].created_at,
            DateTime::parse_from_rfc3339("2026-08-05T08:00:00Z")
                .unwrap()
                .timestamp()
        );
        assert_eq!(logs[0].billing_type.as_deref(), Some("1"));
        assert_eq!(logs[0].input_cost, Some(0.030675));
        assert_eq!(logs[0].output_cost, Some(0.006975));
        assert_eq!(logs[0].cache_creation_cost, Some(0.016075));
        assert_eq!(logs[0].cache_read_cost, Some(0.003891));
        assert_eq!(logs[0].total_cost, Some(0.057616));
        assert_eq!(logs[0].actual_cost, 0.003716);
        assert_eq!(logs[0].rate_multiplier, Some(0.04));
        assert_eq!(logs[0].service_tier.as_deref(), Some("standard"));
        assert_eq!(logs[0].request_type, "stream");
        assert_eq!(logs[0].duration_ms, Some(2_000));
    }

    #[test]
    fn adapts_newapi_usage_fields_without_changing_source_metadata() {
        let station = test_station("https://newapi.example.com".into(), "newapi");
        let value = json!({
            "data": {
                "items": [{
                    "id": 8,
                    "created_at": 1_720_000_000_000_i64,
                    "model_name": "gpt-4o-mini",
                    "token_name": "legacy-key",
                    "prompt_tokens": 12,
                    "completion_tokens": 5,
                    "is_stream": false,
                    "use_time": 3
                }]
            }
        });

        let logs = parse_usage_logs(&value, &station);

        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].model, "gpt-4o-mini");
        assert_eq!(logs[0].api_key_name.as_deref(), Some("legacy-key"));
        assert_eq!(logs[0].request_type, "sync");
        assert_eq!(logs[0].duration_ms, Some(3_000));
        assert_eq!(logs[0].station_name, station.name);
        assert_eq!(logs[0].station_url, station.base_url);
    }

    #[test]
    fn detects_new_offer() {
        let old = StationSnapshot {
            offers: vec![Offer {
                id: "one".into(),
                title: String::new(),
                summary: String::new(),
                source_url: String::new(),
                published_at: None,
            }],
            ..Default::default()
        };
        let new = StationSnapshot {
            offers: vec![
                Offer {
                    id: "one".into(),
                    title: String::new(),
                    summary: String::new(),
                    source_url: String::new(),
                    published_at: None,
                },
                Offer {
                    id: "two".into(),
                    title: String::new(),
                    summary: String::new(),
                    source_url: String::new(),
                    published_at: None,
                },
            ],
            ..Default::default()
        };
        assert!(describe_changes(Some(&old), &new)
            .iter()
            .any(|entry| entry.contains("新公告")));
    }

    #[test]
    fn extracts_chat_and_responses_text() {
        assert_eq!(
            model_response_text(&json!({"choices": [{"message": {"content": "hello"}}]})),
            Some("hello".into())
        );
        assert_eq!(
            model_response_text(
                &json!({"output": [{"content": [{"type": "output_text", "text": "hello"}]}]})
            ),
            Some("hello".into())
        );
        assert_eq!(
            model_response_text(&json!({"content": [{"type": "text", "text": "hello"}]})),
            Some("hello".into())
        );
    }

    #[test]
    fn extracts_only_the_session_cookie() {
        let mut headers = HeaderMap::new();
        headers.append(header::SET_COOKIE, "csrf=ignore; Path=/".parse().unwrap());
        headers.append(
            header::SET_COOKIE,
            "session=authenticated; Path=/; HttpOnly; Secure"
                .parse()
                .unwrap(),
        );
        assert_eq!(
            session_cookie(&headers).as_deref(),
            Some("session=authenticated")
        );
    }

    #[test]
    fn redacts_unmasked_api_keys_and_detects_expired_sessions() {
        assert_eq!(mask_api_key("sk-1234567890abcdef"), "sk-12...cdef");
        assert_eq!(mask_api_key("sk-12...cdef"), "sk-12...cdef");
        assert!(is_unauthorized("HTTP 401: Unauthorized"));
        assert!(is_unauthorized("HTTP 401 Unauthorized: Token has expired"));
        assert!(!is_unauthorized("HTTP 403: Forbidden"));
    }

    #[test]
    fn identifies_cloudflare_challenges_without_treating_every_503_as_one() {
        let mut headers = HeaderMap::new();
        headers.insert("cf-ray", "test-ray".parse().unwrap());
        headers.insert(header::SERVER, "cloudflare".parse().unwrap());
        assert!(is_cloudflare_block(
            StatusCode::SERVICE_UNAVAILABLE,
            &headers,
            "<title>Just a moment...</title><script src='/cdn-cgi/challenge-platform/test'></script>",
        ));
        assert!(!is_cloudflare_block(
            StatusCode::FORBIDDEN,
            &headers,
            r#"{"message":"permission denied"}"#,
        ));
        assert!(!is_cloudflare_block(
            StatusCode::SERVICE_UNAVAILABLE,
            &HeaderMap::new(),
            r#"{"message":"maintenance"}"#,
        ));
    }

    #[test]
    fn notices_retry_after_rate_limits() {
        let mut headers = HeaderMap::new();
        headers.insert(header::RETRY_AFTER, "120".parse().unwrap());
        assert!(rate_limit_hint(&headers).contains("Retry-After"));
        assert!(rate_limit_hint(&HeaderMap::new()).contains("降低同步频率"));
    }

    #[test]
    fn reads_group_description_aliases_and_nested_metadata() {
        let groups = json!({"data": {"groups": [
            {"id": "kiro", "group": {"name": "kiro", "subtitle": "稳定缓存"}, "rate_multiplier": 1.0},
            {"id": "grok", "name": "grok", "meta": {"desc": "仅限 Codex"}, "rate_multiplier": 0.9}
        ]}});

        let rates = map_sub2_group_rates(&groups, &Value::Null);

        assert_eq!(rates[0].group_description.as_deref(), Some("稳定缓存"));
        assert_eq!(rates[1].group_description.as_deref(), Some("仅限 Codex"));
    }

    #[test]
    fn keeps_previous_group_descriptions_when_a_sync_omits_them() {
        let previous = StationSnapshot {
            rates: vec![crate::models::GroupRate {
                group: "kiro".into(),
                group_description: Some("稳定缓存".into()),
                model: "全部模型".into(),
                multiplier: 1.0,
                input_multiplier: None,
                output_multiplier: None,
            }],
            ..Default::default()
        };
        let mut current = StationSnapshot {
            rates: vec![crate::models::GroupRate {
                group: "kiro".into(),
                group_description: None,
                model: "全部模型".into(),
                multiplier: 1.0,
                input_multiplier: None,
                output_multiplier: None,
            }],
            ..Default::default()
        };

        retain_group_descriptions(&previous, &mut current);

        assert_eq!(
            current.rates[0].group_description.as_deref(),
            Some("稳定缓存")
        );
    }

    #[test]
    fn preserves_existing_refresh_token_when_refresh_response_only_rotates_access_token() {
        let mut secret = crate::keyring_store::Secret {
            version: 3,
            username: "user@example.com".into(),
            password: "secret".into(),
            access_token: Some("old-access".into()),
            access_token_expires_at: None,
            refresh_token: Some("long-lived-refresh".into()),
            requires_reauth: false,
            last_refresh_at: None,
            last_refresh_error: None,
            next_refresh_retry_at: None,
            newapi_user_id: None,
            newapi_session: None,
            newapi_cookies: Vec::new(),
        };

        copy_tokens(&mut secret, &json!({"access_token": "new-access"}));

        assert_eq!(secret.access_token.as_deref(), Some("new-access"));
        assert_eq!(secret.refresh_token.as_deref(), Some("long-lived-refresh"));
    }

    #[test]
    fn records_expiry_from_refresh_response_and_classifies_failures() {
        let mut secret = crate::keyring_store::Secret {
            version: 3,
            username: "user@example.com".into(),
            password: "secret".into(),
            access_token: None,
            access_token_expires_at: None,
            refresh_token: Some("refresh".into()),
            requires_reauth: false,
            last_refresh_at: None,
            last_refresh_error: None,
            next_refresh_retry_at: None,
            newapi_user_id: None,
            newapi_session: None,
            newapi_cookies: Vec::new(),
        };
        copy_tokens(
            &mut secret,
            &json!({"access_token": "access", "expires_in": 3600}),
        );
        assert!(secret.access_token_expires_at.is_some());
        assert_eq!(
            classify_refresh_error("HTTP 401: invalid refresh token"),
            "invalid_refresh_token"
        );
        assert_eq!(
            classify_refresh_error("HTTP 429: rate limited"),
            "rate_limited"
        );
        assert_eq!(
            classify_refresh_error("Cloudflare turnstile verification failed"),
            "turnstile_or_cloudflare"
        );
        assert_eq!(
            classify_refresh_error("request timeout"),
            "temporary_network_error"
        );
    }

    #[test]
    fn records_component_sync_outcomes_without_exposing_request_details() {
        let mut snapshot = StationSnapshot {
            unavailable: vec!["账户信息不可获取".into(), "API 密钥列表不可获取".into()],
            ..Default::default()
        };

        finalize_sync_statuses(&mut snapshot);

        assert_eq!(snapshot.sync_statuses["account"].status, "failed");
        assert_eq!(snapshot.sync_statuses["api_keys"].status, "failed");
        assert_eq!(snapshot.sync_statuses["groups"].status, "success");
        assert_eq!(snapshot.sync_statuses["announcements"].status, "success");
        assert_eq!(
            snapshot.sync_statuses["account"].error.as_deref(),
            Some("unavailable")
        );
    }
}
