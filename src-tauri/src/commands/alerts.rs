use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_notification::NotificationExt;

use crate::{
    alert_store::{ActiveAlertRecord, AlertStore},
    settings_store::SettingsStore,
    station_snapshot_store::StationSnapshotStore,
    station_store::StationStore,
    AppState,
};

const POLICY_KEY: &str = "alertPolicy";
const NOTIFIED_PREFIX: &str = "alertNotified:";
const NOTIFICATION_COOLDOWN_SECONDS: i64 = 6 * 60 * 60;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AlertPolicy {
    pub(crate) enabled: bool,
    pub(crate) low_balance_threshold: Option<f64>,
    pub(crate) remaining_quota_percent: Option<f64>,
    pub(crate) quota_reset_warning_hours: Option<f64>,
    pub(crate) notify_station_failures: bool,
}

impl Default for AlertPolicy {
    fn default() -> Self {
        Self {
            enabled: false,
            low_balance_threshold: Some(5.0),
            remaining_quota_percent: Some(10.0),
            quota_reset_warning_hours: Some(24.0),
            notify_station_failures: true,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StationAlert {
    pub(crate) id: String,
    pub(crate) station_id: String,
    pub(crate) station_name: String,
    pub(crate) severity: String,
    pub(crate) title: String,
    pub(crate) detail: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AlertHistoryItem {
    pub(crate) id: i64,
    pub(crate) alert_id: String,
    pub(crate) station_id: String,
    pub(crate) station_name: String,
    pub(crate) severity: String,
    pub(crate) title: String,
    pub(crate) detail: String,
    pub(crate) status: String,
    pub(crate) occurred_at: i64,
}

fn load_policy(state: &AppState) -> Result<AlertPolicy, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?;
    store
        .setting(POLICY_KEY)?
        .map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
        .transpose()
        .map(|value| value.unwrap_or_default())
}

pub(crate) fn evaluate(state: &AppState) -> Result<Vec<StationAlert>, String> {
    let policy = load_policy(state)?;
    if !policy.enabled {
        return Ok(Vec::new());
    }
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?;
    let mut alerts = Vec::new();
    for station in store.list_stations()? {
        if policy.notify_station_failures && station.status == "error" {
            alerts.push(StationAlert {
                id: format!("station-error:{}", station.id),
                station_id: station.id.clone(),
                station_name: station.name.clone(),
                severity: "critical".into(),
                title: "站点同步失败".into(),
                detail: station
                    .last_error
                    .clone()
                    .unwrap_or_else(|| "请重新认证或运行站点体检。".into()),
            });
        }
        let Some((_, snapshot)) = store.load_snapshot(&station.id)? else {
            continue;
        };
        if let (Some(threshold), Some(balance)) =
            (policy.low_balance_threshold, snapshot.station_balance)
        {
            if balance <= threshold {
                alerts.push(StationAlert {
                    id: format!("low-balance:{}", station.id),
                    station_id: station.id.clone(),
                    station_name: station.name.clone(),
                    severity: "warning".into(),
                    title: "站点余额偏低".into(),
                    detail: format!("当前余额 {balance:.2}，低于阈值 {threshold:.2}。"),
                });
            }
        }
        if let Some(threshold) = policy.remaining_quota_percent {
            for key in &snapshot.api_keys {
                let (Some(remaining), Some(total)) = (key.remaining_quota, key.total_quota) else {
                    continue;
                };
                if total > 0.0 && !key.unlimited_quota && remaining / total * 100.0 <= threshold {
                    alerts.push(StationAlert {
                        id: format!("low-key-quota:{}:{}", station.id, key.id),
                        station_id: station.id.clone(),
                        station_name: station.name.clone(),
                        severity: "warning".into(),
                        title: "API 密钥额度偏低".into(),
                        detail: format!(
                            "{} 剩余 {:.1}% ，低于阈值 {:.1}% 。",
                            if key.name.is_empty() {
                                "未命名密钥"
                            } else {
                                &key.name
                            },
                            remaining / total * 100.0,
                            threshold
                        ),
                    });
                }
            }
        }
    }
    if let Some(hours) = policy.quota_reset_warning_hours {
        let warning_seconds = (hours * 60.0 * 60.0) as i64;
        let now = crate::support::now();
        for station in store.list_stations()? {
            let Some((_, snapshot)) = store.load_snapshot(&station.id)? else {
                continue;
            };
            for key in &snapshot.api_keys {
                let Some(reset_at) = key.quota_reset_at else {
                    continue;
                };
                let remaining = reset_at - now;
                if (0..=warning_seconds).contains(&remaining) {
                    alerts.push(StationAlert {
                        id: format!("key-quota-reset:{}:{}", station.id, key.id),
                        station_id: station.id.clone(),
                        station_name: station.name.clone(),
                        severity: "info".into(),
                        title: "API 密钥额度即将重置".into(),
                        detail: format!(
                            "{} 的额度将在约 {} 分钟后重置。",
                            if key.name.is_empty() {
                                "未命名密钥"
                            } else {
                                &key.name
                            },
                            (remaining + 59) / 60
                        ),
                    });
                }
            }
        }
    }
    Ok(alerts)
}

pub(crate) fn notify(app: &AppHandle, state: &AppState) -> Result<Vec<StationAlert>, String> {
    let alerts = evaluate(state)?;
    let now = crate::support::now();
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?;
    let active = alerts
        .iter()
        .map(|alert| ActiveAlertRecord {
            alert_id: alert.id.clone(),
            station_id: alert.station_id.clone(),
            station_name: alert.station_name.clone(),
            severity: alert.severity.clone(),
            title: alert.title.clone(),
            detail: alert.detail.clone(),
        })
        .collect::<Vec<_>>();
    store.record_alert_evaluation(&active, now)?;
    for alert in &alerts {
        let setting_key = format!("{NOTIFIED_PREFIX}{}", alert.id);
        let recently_notified = store
            .setting(&setting_key)?
            .and_then(|value| value.parse::<i64>().ok())
            .is_some_and(|time| now - time < NOTIFICATION_COOLDOWN_SECONDS);
        if !recently_notified {
            let _ = app
                .notification()
                .builder()
                .title(&alert.title)
                .body(format!("{}：{}", alert.station_name, alert.detail))
                .show();
            store.save_setting(&setting_key, &now.to_string())?;
        }
    }
    Ok(alerts)
}

#[tauri::command]
pub(crate) async fn get_alert_policy(state: State<'_, AppState>) -> Result<AlertPolicy, String> {
    load_policy(&state)
}

#[tauri::command]
pub(crate) async fn save_alert_policy(
    state: State<'_, AppState>,
    policy: AlertPolicy,
) -> Result<AlertPolicy, String> {
    if policy
        .low_balance_threshold
        .is_some_and(|value| value < 0.0)
        || policy
            .remaining_quota_percent
            .is_some_and(|value| !(0.0..=100.0).contains(&value))
        || policy
            .quota_reset_warning_hours
            .is_some_and(|value| !(0.0..=24.0 * 365.0).contains(&value))
    {
        return Err("告警阈值必须是有效的非负数，额度百分比不能超过 100。".into());
    }
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_setting(
            POLICY_KEY,
            &serde_json::to_string(&policy).map_err(|error| error.to_string())?,
        )?;
    Ok(policy)
}

#[tauri::command]
pub(crate) async fn evaluate_alerts(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<StationAlert>, String> {
    notify(&app, &state)
}

#[tauri::command]
pub(crate) async fn list_alert_history(
    state: State<'_, AppState>,
    limit: Option<usize>,
) -> Result<Vec<AlertHistoryItem>, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?;
    store.list_alert_events(limit.unwrap_or(50)).map(|events| {
        events
            .into_iter()
            .map(|event| AlertHistoryItem {
                id: event.id,
                alert_id: event.alert_id,
                station_id: event.station_id,
                station_name: event.station_name,
                severity: event.severity,
                title: event.title,
                detail: event.detail,
                status: event.status,
                occurred_at: event.occurred_at,
            })
            .collect()
    })
}
