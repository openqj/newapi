use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use tauri::{AppHandle, State};
use tauri_plugin_notification::NotificationExt;
use url::Url;

use crate::{
    commands::alerts::notify as notify_alerts,
    keyring_store::{clear_secret, load_secret, save_secret, Secret},
    services::stations::{authenticate, detect_kind, refresh_session, sync_one, title_from_html},
    station_adapter::Station,
    station_store::StationStore,
    support::station_base,
    AddStationRequest, AppState, StationConnectionResult, StationProbe, StationSaveResult,
    SyncProgress, SyncResult,
};
use uuid::Uuid;

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
    Ok(StationSaveResult {
        station,
        connection,
    })
}

#[tauri::command]
pub(crate) fn list_stations(state: State<'_, AppState>) -> Result<Vec<Station>, String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .list_stations()
}

#[tauri::command]
pub(crate) fn clear_station_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
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
pub(crate) fn delete_station(state: State<'_, AppState>, id: String) -> Result<(), String> {
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
pub(crate) fn get_sync_progress(
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
pub(crate) fn cancel_sync(state: State<'_, AppState>) -> Result<(), String> {
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
    let mut results = Vec::new();
    for station in stations {
        if cancelled.load(Ordering::Relaxed) {
            break;
        }
        if let Ok(mut progress) = state.sync_progress.lock() {
            if let Some(progress) = progress.get_mut("all") {
                progress.current_station = Some(station.name.clone());
            }
        }
        match sync_one(&state, &station.id).await {
            Ok(result) => {
                if result.changed {
                    let _ = app
                        .notification()
                        .builder()
                        .title(&result.station.name)
                        .body(result.change_summary.join("，"))
                        .show();
                }
                results.push(result);
            }
            Err(error) => {
                let mut failed = station.clone();
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
    Ok(results)
}
