use std::{collections::BTreeSet, time::Duration};

use chrono::{Datelike, Local, TimeZone};
use reqwest::{
    header::{self, HeaderMap},
    Client, Method,
};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::{
    audit_store::AuditStore,
    keyring_store::{load_secret, save_secret, Secret},
    models::{
        AccountInfo, ApiKeyInfo, GroupRate, Offer, StationSnapshot, SyncResult, UsageLog,
        UsageStats,
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
    let mut secret = load_authenticated_secret(state, &station).await?;
    let snapshot = fetch_snapshot(state, &station, &mut secret).await?;
    let fingerprint = hash(&snapshot);
    let old = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .load_snapshot(id)?;
    let changed = old
        .as_ref()
        .map(|(previous, _)| previous != &fingerprint)
        .unwrap_or(true);
    let change_summary = if changed {
        describe_changes(old.as_ref().map(|(_, snapshot)| snapshot), &snapshot)
    } else {
        Vec::new()
    };
    station.status = if snapshot.unavailable.len() == 3 {
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
    let root = data(value);
    root.get("items")
        .or_else(|| root.get("records"))
        .or_else(|| root.get("logs"))
        .or_else(|| root.get("data"))
        .and_then(Value::as_array)
        .map(|items| items.iter())
        .into_iter()
        .flatten()
        .collect()
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
    integer(value, &["created_at", "createdAt", "timestamp", "time"]).map(|time| {
        if time > 10_000_000_000 {
            time / 1_000
        } else {
            time
        }
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
    optional_scalar_string(item, &["group", "group_name", "groupName"])
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
        .map(|item| UsageLog {
            id: format!(
                "{}-{}",
                station.id,
                scalar_string(item, &["id", "log_id", "request_id"])
            ),
            station_id: station.id.clone(),
            station_name: station.name.clone(),
            station_url: station.base_url.clone(),
            api_key_name: optional_string(item, &["api_key_name", "key_name", "token_name"]),
            group_name: normalized_group(item),
            endpoint: optional_string(
                item,
                &["inbound_endpoint", "endpoint", "path", "request_path"],
            ),
            ip_address: optional_string(item, &["ip_address", "ip", "client_ip"]),
            reasoning_effort: optional_string(item, &["reasoning_effort"]),
            billing_type: optional_string(item, &["billing_type"]),
            billing_mode: optional_string(item, &["billing_mode"]),
            model: string(item, &["model", "model_name", "requested_model"]),
            input_tokens: integer(item, &["prompt_tokens", "input_tokens", "promptTokens"])
                .unwrap_or(0),
            output_tokens: integer(
                item,
                &["completion_tokens", "output_tokens", "completionTokens"],
            )
            .unwrap_or(0),
            cache_creation_tokens: integer(item, &["cache_creation_tokens", "cache_write_tokens"])
                .unwrap_or(0),
            cache_read_tokens: integer(item, &["cache_read_tokens", "cache_tokens"]).unwrap_or(0),
            actual_cost: number(
                item,
                &["actual_cost", "quota", "cost", "used_quota", "usage"],
            )
            .unwrap_or(0.0),
            request_type: string(item, &["request_type", "type"]),
            duration_ms: integer(item, &["duration_ms", "duration"]),
            created_at: timestamp(item).unwrap_or_default(),
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

pub(crate) fn map_rates(value: &Value) -> Vec<GroupRate> {
    let mut output = Vec::new();
    if let Some(map) = value.as_object() {
        for (group, item) in map {
            if let Some(multiplier) = item.as_f64() {
                output.push(GroupRate {
                    group: group.clone(),
                    model: "全部模型".into(),
                    multiplier,
                    input_multiplier: None,
                    output_multiplier: None,
                });
            }
            if let Some(models) = item.as_object() {
                for (model, rate) in models {
                    if let Some(multiplier) = rate.as_f64() {
                        output.push(GroupRate {
                            group: group.clone(),
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
                    let group = item.as_str().map(str::to_string).unwrap_or_else(|| {
                        scalar_string(item, &["name", "group_name", "groupName"])
                    });
                    if group.is_empty() {
                        return None;
                    }
                    let multiplier = override_rates
                        .and_then(|rates| rates.get(&id).or_else(|| rates.get(&group)))
                        .and_then(rate_multiplier)
                        .or_else(|| rate_multiplier(item))
                        .unwrap_or(1.0);
                    Some(GroupRate {
                        group,
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
        &["quota", "balance", "remain_quota", "remaining_quota"],
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

pub(crate) async fn request(
    client: &Client,
    station: &Station,
    token: Option<&str>,
    newapi_user_id: Option<&str>,
    newapi_session: Option<&str>,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let mut call = client
        .request(method, endpoint(station, path))
        .timeout(std::time::Duration::from_secs(15));
    if station.kind == "newapi" {
        if let Some(user_id) = newapi_user_id {
            call = call.header("New-Api-User", user_id);
        }
        if let Some(session) = newapi_session {
            call = call.header(header::COOKIE, session);
        }
    } else if let Some(token) = token {
        call = call.bearer_auth(token);
    }
    if let Some(body) = body {
        call = call.json(&body);
    }
    let response = call.send().await.map_err(|e| format!("请求失败：{e}"))?;
    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|_| format!("HTTP {status}: 站点返回了无法识别的数据"))?;
    if !status.is_success()
        || value.get("success") == Some(&Value::Bool(false))
        || value.get("code") == Some(&json!(-1))
    {
        return Err(format!(
            "HTTP {status}: {}",
            value
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("站点拒绝了请求")
        ));
    }
    Ok(value)
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
    if request(
        client,
        &temp,
        None,
        None,
        None,
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
        None,
        None,
        None,
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

pub(crate) fn session_cookie(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::SET_COOKIE)
        .iter()
        .find_map(|value| {
            let cookie = value.to_str().ok()?.split(';').next()?.trim();
            cookie.starts_with("session=").then(|| cookie.to_string())
        })
}

pub(crate) async fn login_request(
    client: &Client,
    station: &Station,
    path: &str,
    body: Value,
) -> Result<(Value, Option<String>), String> {
    let response = client
        .post(endpoint(station, path))
        .timeout(std::time::Duration::from_secs(15))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("请求失败：{e}"))?;
    let status = response.status();
    let session = session_cookie(response.headers());
    let value = response
        .json::<Value>()
        .await
        .map_err(|_| format!("站点返回了无法识别的数据 ({status})"))?;
    if !status.is_success()
        || value.get("success") == Some(&Value::Bool(false))
        || value.get("code") == Some(&json!(-1))
    {
        return Err(value
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("站点拒绝了请求")
            .to_string());
    }
    Ok((value, session))
}

pub(crate) async fn register(
    client: &Client,
    station: &Station,
    email: &str,
    password: &str,
    verification_code: &str,
) -> Result<(), String> {
    let adapter = StationAdapter::for_station(station)?;
    login_request(
        client,
        station,
        adapter.register_path(),
        adapter.register_body(email, password, verification_code),
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
        client.post(endpoint(station, adapter.register_verification_path())).json(&body)
    } else {
        client.get(endpoint(station, adapter.register_verification_path())).query(&[("email", email)])
    };
    let response = request
        .timeout(std::time::Duration::from_secs(15))
        .send()
        .await
        .map_err(|error| format!("请求失败：{error}"))?;
    let status = response.status();
    let value = response
        .json::<Value>()
        .await
        .map_err(|_| format!("站点返回了无法识别的数据 ({status})"))?;
    if !status.is_success()
        || value.get("success") == Some(&Value::Bool(false))
        || value.get("code") == Some(&json!(-1))
    {
        return Err(value
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("邮箱验证码发送失败")
            .to_string());
    }
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
    let (login, login_session) = login_request(
        client,
        station,
        adapter.login_path(),
        adapter.login_body(&secret.username, &secret.password),
    )
    .await?;
    let (authentication, session) = if data(&login)
        .get("require_2fa")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        let code = totp.ok_or("该站点需要 TOTP 验证码")?;
        let (verify, verify_session) = login_request(
            client,
            station,
            adapter.login_2fa_path(),
            json!({"flow_token": data(&login)["flow_token"], "code": code, "totp": code}),
        )
        .await?;
        (verify, verify_session.or(login_session))
    } else {
        (login, login_session)
    };
    let authentication_data = data(&authentication);
    copy_tokens(secret, authentication_data);
    if station.kind == "newapi" {
        secret.newapi_user_id = authentication_data.get("id").and_then(|id| {
            id.as_str()
                .map(str::to_string)
                .or_else(|| id.as_i64().map(|id| id.to_string()))
        });
        secret.newapi_session = session;
        if secret.newapi_user_id.is_none() {
            return Err("登录成功，但站点未返回用户标识".into());
        }
        if secret.newapi_session.is_none() {
            return Err("登录成功，但站点未返回可保存的会话".into());
        }
    } else if secret.access_token.is_none() {
        return Err("登录成功，但站点未返回可保存的登录令牌".into());
    }
    Ok(())
}

pub(crate) fn copy_tokens(secret: &mut Secret, value: &Value) {
    secret.access_token = value
        .get("access_token")
        .or_else(|| value.get("accessToken"))
        .and_then(Value::as_str)
        .map(str::to_string);
    secret.refresh_token = value
        .get("refresh_token")
        .or_else(|| value.get("refreshToken"))
        .and_then(Value::as_str)
        .map(str::to_string);
}

pub(crate) async fn load_authenticated_secret(
    state: &AppState,
    station: &Station,
) -> Result<Secret, String> {
    let mut secret = load_secret(&station.id)?;
    if (station.kind == "newapi"
        && (secret.newapi_user_id.is_none() || secret.newapi_session.is_none()))
        || (station.kind != "newapi" && secret.access_token.is_none())
    {
        refresh_session(state, station, &mut secret, None, false).await?;
    }
    Ok(secret)
}

pub(crate) fn is_unauthorized(error: &str) -> bool {
    error.starts_with("HTTP 401:")
}

pub(crate) async fn refresh_session(
    state: &AppState,
    station: &Station,
    secret: &mut Secret,
    totp: Option<&str>,
    bypass_backoff: bool,
) -> Result<(), String> {
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

pub(crate) async fn station_request(
    state: &AppState,
    station: &Station,
    secret: &mut Secret,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Result<Value, String> {
    let response = request(
        &state.client,
        station,
        secret.access_token.as_deref(),
        secret.newapi_user_id.as_deref(),
        secret.newapi_session.as_deref(),
        method.clone(),
        path,
        body.clone(),
    )
    .await;
    if response
        .as_ref()
        .err()
        .is_some_and(|error| is_unauthorized(error))
    {
        refresh_session(state, station, secret, None, false).await?;
        return request(
            &state.client,
            station,
            secret.access_token.as_deref(),
            secret.newapi_user_id.as_deref(),
            secret.newapi_session.as_deref(),
            method,
            path,
            body,
        )
        .await;
    }
    response
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
        let page_items = root
            .get("items")
            .or_else(|| root.get("records"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let count = page_items.len();
        items.extend(page_items);
        let total = integer(root, &["total"]);
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
        .await?;
        snapshot.station_balance = parse_balance(&value);
        snapshot.account = parse_account(&value);
        snapshot.usage = usage_from_profile(&value);
        if let Ok(value) =
            fetch_all_pages(state, station, secret, adapter, PagedResource::Usage).await
        {
            snapshot.usage = merge_usage(snapshot.usage, usage_from_logs(&value, start_of_today()));
        }
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
                snapshot.rates = map_sub2_group_rates(&groups, &overrides);
                if snapshot.rates.is_empty() {
                    snapshot.rates = map_rates(data(&overrides));
                }
            }
            (Ok(groups), Err(_)) => {
                snapshot.rates = map_sub2_group_rates(&groups, &Value::Null);
            }
            (Err(_), Ok(overrides)) => snapshot.rates = map_rates(data(&overrides)),
            (Err(_), Err(_)) => snapshot
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
        .await?;
        let status =
            station_request(state, station, secret, Method::GET, "/api/status", None).await;
        snapshot.station_balance = newapi_display_balance(&value, status.as_ref().ok());
        snapshot.account = parse_account(&value);
        snapshot.account.balance = snapshot.station_balance;
        snapshot.usage = usage_from_profile(&value);
        if let Ok(value) =
            fetch_all_pages(state, station, secret, adapter, PagedResource::Usage).await
        {
            snapshot.usage = merge_usage(snapshot.usage, usage_from_logs(&value, start_of_today()));
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
    Ok(snapshot)
}

#[cfg(test)]
mod tests {
    use axum::http::{header, HeaderMap};
    use serde_json::json;

    use super::{
        describe_changes, is_unauthorized, map_rates, map_sub2_group_rates, mask_api_key,
        model_response_text, newapi_display_balance, parse_keys, pricing_group_ratio,
        session_cookie, usage_from_logs,
    };
    use crate::{
        models::{Offer, StationSnapshot},
        station_adapter::StationAdapter,
    };

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
            {"id": 1, "name": "standard", "rate_multiplier": 1.0},
            {"id": 2, "name": "vip", "rate_multiplier": 0.8}
        ]});
        let overrides = json!({"data": {"2": 0.5}});

        let rates = map_sub2_group_rates(&groups, &overrides);

        assert_eq!(rates.len(), 2);
        assert_eq!(rates[0].group, "standard");
        assert_eq!(rates[0].multiplier, 1.0);
        assert_eq!(rates[1].group, "vip");
        assert_eq!(rates[1].multiplier, 0.5);
    }

    #[test]
    fn accepts_wrapped_sub2_groups_and_string_multipliers() {
        let groups = json!({"data": {"groups": [
            {"id": "standard", "name": "standard", "rateMultiplier": "1.25"},
            "vip"
        ]}});
        let overrides = json!({"data": {"rates": {"vip": {"multiplier": "0.5"}}}});

        let rates = map_sub2_group_rates(&groups, &overrides);

        assert_eq!(rates.len(), 2);
        assert_eq!(rates[0].multiplier, 1.25);
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
        assert!(!is_unauthorized("HTTP 403: Forbidden"));
    }
}
