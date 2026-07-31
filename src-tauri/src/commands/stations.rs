use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use reqwest::Method;
use serde_json::json;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_notification::NotificationExt;
use tokio::task::JoinSet;
use url::Url;

use crate::{
    commands::alerts::notify as notify_alerts,
    keyring_store::{clear_secret, load_secret, save_secret, Secret},
    services::stations::{
        authenticate, detect_kind, refresh_session, station_request, sync_one,
        sync_one_authorized, title_from_html,
    },
    station_adapter::{Station, StationAdapter},
    station_store::StationStore,
    support::station_base,
    AddStationRequest, AppState, StationConnectionResult, StationProbe, StationSaveResult,
    SyncProgress, SyncResult, UpdateStationRequest,
};
use uuid::Uuid;

const MAX_CONCURRENT_STATION_SYNCS: usize = 6;

#[tauri::command]
pub(crate) async fn redeem_station_code(
    state: State<'_, AppState>,
    station_id: String,
    code: String,
) -> Result<String, String> {
    let code = code.trim();
    if code.is_empty() || code.len() > 128 || code.chars().any(char::is_control) {
        return Err("请输入有效兑换码".into());
    }
    let station = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_station(&station_id)?;
    if StationAdapter::for_station(&station)? != StationAdapter::NewApi {
        return Err("当前站点类型暂不支持应用内兑换，请前往站点完成兑换。".into());
    }
    let mut secret = load_secret(&station.id)?;
    let response = station_request(
        &state,
        &station,
        &mut secret,
        Method::POST,
        "/api/user/topup",
        Some(json!({ "key": code })),
    )
    .await?;
    if response.get("success").and_then(|value| value.as_bool()) == Some(false) {
        return Err(response
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("兑换失败，请检查兑换码。")
            .to_string());
    }
    sync_one_authorized(&state, &station.id).await?;
    Ok(response
        .get("message")
        .and_then(|value| value.as_str())
        .unwrap_or("兑换成功，账户余额已更新。")
        .to_string())
}

#[tauri::command]
pub(crate) async fn probe_station(
    state: State<'_, AppState>,
    base_url: String,
) -> Result<StationProbe, String> {
    let parsed = Url::parse(&base_url).map_err(|_| "请输入有效站点地址")?;
    if parsed.scheme() != "https" {
        return Err("仅允许 HTTPS 站点地址".into());
    }
    let fallback = parsed.host_str().unwrap_or("未命名站点").to_string();
    let page = state
        .client
        .get(station_base(&base_url))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .ok();
    let name = match page {
        Some(response) => response
            .text()
            .await
            .ok()
            .and_then(|html| title_from_html(&html))
            .unwrap_or(fallback),
        None => fallback,
    };
    Ok(StationProbe {
        name,
        kind: detect_kind(&state.client, &station_base(&base_url))
            .await
            .ok(),
    })
}

#[tauri::command]
pub(crate) async fn add_station(
    state: State<'_, AppState>,
    request: AddStationRequest,
) -> Result<StationSaveResult, String> {
    let parsed = Url::parse(&request.base_url).map_err(|_| "请输入有效站点地址")?;
    if parsed.scheme() != "https" {
        return Err("仅允许 HTTPS 站点地址".into());
    }
    let kind = if request.kind == "auto" {
        detect_kind(&state.client, &station_base(&request.base_url)).await?
    } else {
        request.kind
    };
    if kind != "newapi" && kind != "sub2api" {
        return Err("仅支持 New API 和 Sub2API".into());
    }
    let mut station = Station {
        id: Uuid::new_v4().to_string(),
        name: if request.name.trim().is_empty() {
            parsed.host_str().unwrap_or("未命名站点").to_string()
        } else {
            request.name.trim().to_string()
        },
        base_url: station_base(&request.base_url),
        kind,
        status: "connecting".into(),
        last_synced_at: None,
        last_error: None,
    };
    let mut secret = Secret {
        username: request.username,
        password: request.password,
        access_token: None,
        refresh_token: None,
        newapi_user_id: None,
        newapi_session: None,
    };
    let connection = match authenticate(
        &state.client,
        &station,
        &mut secret,
        request.totp.as_deref(),
    )
    .await
    {
        Ok(()) => StationConnectionResult {
            success: true,
            status: "online".into(),
            reason: None,
        },
        Err(reason) => {
            station.status = "error".into();
            return Ok(StationSaveResult {
                station,
                connection: StationConnectionResult {
                    success: false,
                    status: "error".into(),
                    reason: Some(reason),
                },
            });
        }
    };
    save_secret(&station.id, &secret)?;
    station.status = "online".into();
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_station(&station)?;
    let station = sync_one_authorized(&state, &station.id).await?.station;
    Ok(StationSaveResult {
        station,
        connection,
    })
}

#[tauri::command]
pub(crate) async fn update_station(
    state: State<'_, AppState>,
    request: UpdateStationRequest,
) -> Result<StationSaveResult, String> {
    let parsed = Url::parse(&request.base_url).map_err(|_| "请输入有效站点地址")?;
    if parsed.scheme() != "https" {
        return Err("仅允许 HTTPS 站点地址".into());
    }
    let mut station = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_station(&request.id)?;
    let kind = if request.kind == "auto" {
        detect_kind(&state.client, &station_base(&request.base_url)).await?
    } else {
        request.kind
    };
    if kind != "newapi" && kind != "sub2api" {
        return Err("仅支持 New API 和 Sub2API".into());
    }
    station.name = if request.name.trim().is_empty() {
        parsed.host_str().unwrap_or("未命名站点").to_string()
    } else {
        request.name.trim().to_string()
    };
    station.base_url = station_base(&request.base_url);
    station.kind = kind;
    let mut secret = load_secret(&station.id)?;
    if let Some(username) = request.username.filter(|value| !value.trim().is_empty()) {
        secret.username = username.trim().to_string();
    }
    if let Some(password) = request.password.filter(|value| !value.is_empty()) {
        secret.password = password;
    }
    secret.access_token = None;
    secret.refresh_token = None;
    secret.newapi_user_id = None;
    secret.newapi_session = None;
    let connection = match authenticate(
        &state.client,
        &station,
        &mut secret,
        request.totp.as_deref(),
    )
    .await
    {
        Ok(()) => StationConnectionResult {
            success: true,
            status: "online".into(),
            reason: None,
        },
        Err(reason) => {
            return Ok(StationSaveResult {
                station,
                connection: StationConnectionResult {
                    success: false,
                    status: "error".into(),
                    reason: Some(reason),
                },
            });
        }
    };
    save_secret(&station.id, &secret)?;
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_station(&station)?;
    let station = sync_one_authorized(&state, &station.id).await?.station;
    Ok(StationSaveResult {
        station,
        connection,
    })
}

#[tauri::command]
pub(crate) async fn list_stations(state: State<'_, AppState>) -> Result<Vec<Station>, String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .list_stations()
}

#[tauri::command]
pub(crate) async fn clear_station_session(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let mut secret = load_secret(&id)?;
    secret.newapi_session = None;
    secret.newapi_user_id = None;
    save_secret(&id, &secret)?;
    state
        .auth_backoff
        .lock()
        .map_err(|_| "认证状态不可用".to_string())?
        .remove(&id);
    Ok(())
}

#[tauri::command]
pub(crate) async fn delete_station(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .delete_station(&id)?;
    clear_secret(&id);
    Ok(())
}

#[tauri::command]
pub(crate) async fn refresh_station(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> Result<SyncResult, String> {
    let result = sync_one(&state, &id).await?;
    if result.changed {
        let _ = app
            .notification()
            .builder()
            .title(&result.station.name)
            .body(result.change_summary.join("，"))
            .show();
    }
    let _ = notify_alerts(&app, &state);
    Ok(result)
}

#[tauri::command]
pub(crate) async fn reauthenticate_station(
    state: State<'_, AppState>,
    id: String,
    totp: Option<String>,
) -> Result<SyncResult, String> {
    let station = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_station(&id)?;
    let mut secret = load_secret(&id)?;
    refresh_session(&state, &station, &mut secret, totp.as_deref(), true).await?;
    sync_one(&state, &id).await
}

#[tauri::command]
pub(crate) async fn get_sync_progress(
    state: State<'_, AppState>,
) -> Result<Option<SyncProgress>, String> {
    Ok(state
        .sync_progress
        .lock()
        .map_err(|_| "同步状态不可用".to_string())?
        .get("all")
        .cloned())
}

#[tauri::command]
pub(crate) async fn cancel_sync(state: State<'_, AppState>) -> Result<(), String> {
    let operations = state
        .sync_operations
        .lock()
        .map_err(|_| "同步状态不可用".to_string())?;
    operations
        .get("all")
        .ok_or("当前没有可取消的同步任务")?
        .store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
pub(crate) async fn refresh_all(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<SyncResult>, String> {
    let stations = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .list_stations()?;
    let cancelled = Arc::new(AtomicBool::new(false));
    state
        .sync_operations
        .lock()
        .map_err(|_| "同步状态不可用".to_string())?
        .insert("all".into(), cancelled.clone());
    state
        .sync_progress
        .lock()
        .map_err(|_| "同步状态不可用".to_string())?
        .insert(
            "all".into(),
            SyncProgress {
                operation_id: "all".into(),
                completed: 0,
                total: stations.len(),
                current_station: None,
                status: "running".into(),
            },
        );
    let mut queued_stations = stations.into_iter().enumerate();
    let mut workers = JoinSet::new();
    let mut results = Vec::new();
    loop {
        while workers.len() < MAX_CONCURRENT_STATION_SYNCS && !cancelled.load(Ordering::Relaxed) {
            let Some((position, station)) = queued_stations.next() else {
                break;
            };
            if let Ok(mut progress) = state.sync_progress.lock() {
                if let Some(progress) = progress.get_mut("all") {
                    progress.current_station = Some(station.name.clone());
                }
            }
            let task_app = app.clone();
            workers.spawn(async move {
                let state = task_app.state::<AppState>();
                let result = sync_one(&state, &station.id).await;
                (position, station, result)
            });
        }

        let Some(joined) = workers.join_next().await else {
            break;
        };
        let Ok((position, station, result)) = joined else {
            continue;
        };
        match result {
            Ok(result) => {
                if result.changed {
                    let _ = app
                        .notification()
                        .builder()
                        .title(&result.station.name)
                        .body(result.change_summary.join("，"))
                        .show();
                }
                results.push((position, result));
            }
            Err(error) => {
                let mut failed = station;
                failed.status = "error".into();
                failed.last_error = Some(error);
                let _ = state
                    .store
                    .lock()
                    .map_err(|_| "本地数据库不可用".to_string())?
                    .save_station(&failed);
            }
        }
        if let Ok(mut progress) = state.sync_progress.lock() {
            if let Some(progress) = progress.get_mut("all") {
                progress.completed += 1;
            }
        }
    }
    if let Ok(mut progress) = state.sync_progress.lock() {
        if let Some(progress) = progress.get_mut("all") {
            progress.current_station = None;
            progress.status = if cancelled.load(Ordering::Relaxed) {
                "cancelled".into()
            } else {
                "completed".into()
            };
        }
    }
    if let Ok(mut operations) = state.sync_operations.lock() {
        operations.remove("all");
    }
    let _ = notify_alerts(&app, &state);
    results.sort_by_key(|(position, _)| *position);
    Ok(results.into_iter().map(|(_, result)| result).collect())
}
