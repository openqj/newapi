use std::collections::BTreeSet;

use reqwest::Method;
use serde_json::{json, Value};
use tauri::State;

use crate::services::api_keys::{
    empty_mutation, newapi_create_payload, read_api_key, read_newapi_token, sub2_payload,
    update_newapi_token,
};
use crate::{
    services::stations::{
        fetch_all_pages, load_authenticated_secret, parse_keys, record_station_audit,
        station_request, sync_one,
    },
    station_adapter::{PagedResource, StationAdapter},
    station_snapshot_store::StationSnapshotStore,
    station_store::StationStore,
    ApiKeyInfo, ApiKeyMutationRequest, AppState, SyncResult,
};

fn cached_key(state: &AppState, station_id: &str, key_id: &str) -> Option<ApiKeyInfo> {
    let store = state.store.lock().ok()?;
    store
        .load_snapshot(station_id)
        .ok()
        .flatten()?
        .1
        .api_keys
        .into_iter()
        .find(|key| key.id == key_id)
}

fn record_key_change(
    state: &AppState,
    station_id: &str,
    action: &str,
    detail: &str,
    before: Option<&ApiKeyInfo>,
    after: Option<&ApiKeyInfo>,
) {
    let payload: Value = json!({
        "before": before,
        "after": after,
        "rollback": null,
        "note": "API-key history is informational only. Remote key mutations are never replayed or rolled back automatically.",
    });
    if let Ok(store) = state.store.lock() {
        let _ = crate::audit_store::AuditStore::record_audit_with_payload(
            &*store, station_id, action, "success", detail, &payload,
        );
    }
}

#[tauri::command]
pub(crate) async fn reveal_key(
    state: State<'_, AppState>,
    station_id: String,
    key_id: String,
) -> Result<String, String> {
    let key = read_api_key(&state, &station_id, &key_id).await?.1;
    record_station_audit(
        &state,
        &station_id,
        "key.reveal",
        "API key revealed to local user",
    );
    Ok(key)
}

#[tauri::command]
pub(crate) async fn apply_api_key_to_codex(
    state: State<'_, AppState>,
    station_id: String,
    key_id: String,
) -> Result<crate::CodexIntegrationStatus, String> {
    crate::services::codex_config::apply_api_key(&state, station_id, key_id).await
}

#[tauri::command]
pub(crate) async fn delete_api_key(
    state: State<'_, AppState>,
    station_id: String,
    key_id: String,
) -> Result<SyncResult, String> {
    let before = cached_key(&state, &station_id, &key_id);
    let station = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_station(&station_id)?;
    let mut secret = load_authenticated_secret(&state, &station).await?;
    let path = match StationAdapter::for_station(&station)? {
        StationAdapter::Sub2Api => format!("/api/v1/keys/{key_id}"),
        StationAdapter::NewApi => format!("/api/token/{key_id}/"),
    };
    station_request(&state, &station, &mut secret, Method::DELETE, &path, None).await?;
    let result = sync_one(&state, &station_id).await?;
    record_key_change(
        &state,
        &station_id,
        "key.delete",
        "API key deleted",
        before.as_ref(),
        None,
    );
    Ok(result)
}

#[tauri::command]
pub(crate) async fn update_key_group(
    state: State<'_, AppState>,
    station_id: String,
    key_id: String,
    group: String,
) -> Result<SyncResult, String> {
    if group.trim().is_empty() {
        return Err("请选择一个分组".into());
    }
    let before = cached_key(&state, &station_id, &key_id);
    let station = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_station(&station_id)?;
    let mut secret = load_authenticated_secret(&state, &station).await?;
    match StationAdapter::for_station(&station)? {
        StationAdapter::Sub2Api => {
            let path = format!("/api/v1/keys/{key_id}");
            if station_request(
                &state,
                &station,
                &mut secret,
                Method::PATCH,
                &path,
                Some(json!({"group": group})),
            )
            .await
            .is_err()
            {
                station_request(
                    &state,
                    &station,
                    &mut secret,
                    Method::PUT,
                    &path,
                    Some(json!({"group": group})),
                )
                .await?;
            }
        }
        StationAdapter::NewApi => {
            let current = read_newapi_token(&state, &station, &mut secret, &key_id).await?;
            let mut request = empty_mutation(&station_id, Some(key_id.clone()));
            request.group = Some(group);
            update_newapi_token(&state, &station, &mut secret, &current, &request).await?;
        }
    }
    let result = sync_one(&state, &station_id).await?;
    let after = result.snapshot.api_keys.iter().find(|key| key.id == key_id);
    record_key_change(
        &state,
        &station_id,
        "key.group.update",
        "API key group updated",
        before.as_ref(),
        after,
    );
    Ok(result)
}

#[tauri::command]
pub(crate) async fn create_api_key(
    state: State<'_, AppState>,
    request: ApiKeyMutationRequest,
) -> Result<SyncResult, String> {
    if request
        .name
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
    {
        return Err("请输入密钥名称".into());
    }
    let station = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_station(&request.station_id)?;
    let mut secret = load_authenticated_secret(&state, &station).await?;
    let adapter = StationAdapter::for_station(&station)?;
    let existing_key_ids = if adapter == StationAdapter::NewApi {
        let value =
            fetch_all_pages(&state, &station, &mut secret, adapter, PagedResource::Keys).await?;
        parse_keys(&value, adapter)
            .into_iter()
            .map(|key| key.id)
            .collect::<BTreeSet<_>>()
    } else {
        BTreeSet::new()
    };
    match adapter {
        StationAdapter::Sub2Api => {
            station_request(
                &state,
                &station,
                &mut secret,
                Method::POST,
                "/api/v1/keys",
                Some(sub2_payload(&request, false)),
            )
            .await?
        }
        StationAdapter::NewApi => {
            station_request(
                &state,
                &station,
                &mut secret,
                Method::POST,
                "/api/token/",
                Some(newapi_create_payload(&request)?),
            )
            .await?
        }
    };
    let mut result = sync_one(&state, &request.station_id).await?;
    if adapter == StationAdapter::NewApi {
        let name = request.name.as_deref().map(str::trim).unwrap_or_default();
        let created = result
            .snapshot
            .api_keys
            .iter()
            .find(|key| !existing_key_ids.contains(&key.id) && key.name == name)
            .or_else(|| {
                result
                    .snapshot
                    .api_keys
                    .iter()
                    .find(|key| !existing_key_ids.contains(&key.id))
            })
            .ok_or("NewAPI 已接受创建请求，但刷新后的密钥列表中未找到新密钥")?;
        result
            .change_summary
            .push(format!("已定位新建 NewAPI 密钥：{}", created.name));
    }
    let created = result.snapshot.api_keys.iter().find(|key| {
        request
            .name
            .as_deref()
            .is_some_and(|name| key.name == name.trim())
    });
    record_key_change(
        &state,
        &request.station_id,
        "key.create",
        "API key created",
        None,
        created,
    );
    Ok(result)
}

#[tauri::command]
pub(crate) async fn update_api_key(
    state: State<'_, AppState>,
    request: ApiKeyMutationRequest,
) -> Result<SyncResult, String> {
    let key_id = request
        .key_id
        .as_deref()
        .filter(|id| !id.trim().is_empty())
        .ok_or("缺少密钥标识")?;
    let before = cached_key(&state, &request.station_id, key_id);
    let station = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_station(&request.station_id)?;
    let mut secret = load_authenticated_secret(&state, &station).await?;
    match StationAdapter::for_station(&station)? {
        StationAdapter::Sub2Api => {
            let path = format!("/api/v1/keys/{key_id}");
            let payload = sub2_payload(&request, false);
            if station_request(
                &state,
                &station,
                &mut secret,
                Method::PATCH,
                &path,
                Some(payload.clone()),
            )
            .await
            .is_err()
            {
                station_request(
                    &state,
                    &station,
                    &mut secret,
                    Method::PUT,
                    &path,
                    Some(payload),
                )
                .await?;
            }
        }
        StationAdapter::NewApi => {
            let current = read_newapi_token(&state, &station, &mut secret, key_id).await?;
            update_newapi_token(&state, &station, &mut secret, &current, &request).await?;
        }
    }
    let result = sync_one(&state, &request.station_id).await?;
    let after = result.snapshot.api_keys.iter().find(|key| key.id == key_id);
    record_key_change(
        &state,
        &request.station_id,
        "key.update",
        "API key updated",
        before.as_ref(),
        after,
    );
    Ok(result)
}
