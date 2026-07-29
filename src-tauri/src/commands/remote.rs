use tauri::State;
use url::Url;

use crate::services::remote::{
    acquire_operation as acquire_remote_operation, add_server as add_remote_server_service,
    cancel_operation as cancel_remote_operation, delete_server as delete_remote_server_service,
    install_or_update_server_codex, test_server as test_remote_server_service,
    update_server as update_remote_server_service, verify_server_codex_session, write_server_relay,
};
use crate::{
    commands::audit::{
        finalize_remote_relay_rollback_snapshot, record_remote_change, record_remote_relay_change,
        save_remote_relay_rollback_snapshot, RemoteRelayRollbackReference,
    },
    keyring_store::remote_relay_key_entry,
    models::{
        AddRemoteServerRequest, RemoteConnectionResult, RemoteServer, RemoteServerSaveResult,
        RemoteSyncLog, UpdateRemoteRelayRequest, UpdateRemoteServerRequest,
    },
    remote_store::RemoteServerStore,
    remote_sync_logs::RemoteSyncLogStore,
    services::api_keys::read_api_key,
    services::remote::capture_codex_config_state,
    support::base,
    AppState,
};

fn capture_relay_rollback(
    server: &RemoteServer,
    operation: &crate::RemoteOperationGuard,
) -> (Option<RemoteRelayRollbackReference>, Option<String>) {
    let result = capture_codex_config_state(server, Some(operation))
        .and_then(|snapshot| save_remote_relay_rollback_snapshot(&server.id, &snapshot));
    match result {
        Ok(reference) => (Some(reference), None),
        Err(error) => (
            None,
            Some(format!(
                "A secure snapshot of the previous remote relay could not be saved ({error}). This change cannot be rolled back from history."
            )),
        ),
    }
}

fn finalize_relay_rollback(
    server: &RemoteServer,
    operation: &crate::RemoteOperationGuard,
    reference: Option<RemoteRelayRollbackReference>,
    unavailable_reason: Option<String>,
) -> (Option<RemoteRelayRollbackReference>, Option<String>) {
    let Some(reference) = reference else {
        return (None, unavailable_reason);
    };
    match capture_codex_config_state(server, Some(operation))
        .and_then(|current| finalize_remote_relay_rollback_snapshot(reference, &current))
    {
        Ok(reference) => (Some(reference), None),
        Err(error) => (
            None,
            Some(format!(
                "The relay was applied, but its secure rollback snapshot could not be finalized ({error}). This change cannot be rolled back from history."
            )),
        ),
    }
}

#[tauri::command]
pub(crate) async fn list_remote_servers(
    state: State<'_, AppState>,
) -> Result<Vec<RemoteServer>, String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .list_remote_servers()
}

#[tauri::command]
pub(crate) async fn list_remote_sync_logs(
    state: State<'_, AppState>,
    server_id: String,
) -> Result<Vec<RemoteSyncLog>, String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .list_remote_sync_logs(&server_id)
}

#[tauri::command]
pub(crate) async fn cancel_remote_server_operation(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    cancel_remote_operation(&state, &id)
}

#[tauri::command]
pub(crate) async fn install_or_update_remote_codex_command(
    state: State<'_, AppState>,
    id: String,
    action: String,
) -> Result<RemoteServer, String> {
    install_or_update_server_codex(&state, &id, &action)
}

#[tauri::command]
pub(crate) async fn add_remote_server(
    state: State<'_, AppState>,
    request: AddRemoteServerRequest,
) -> Result<RemoteServerSaveResult, String> {
    let result = add_remote_server_service(&state, request)?;
    if result.connection.success {
        record_remote_change(
            &state,
            "remote.server.create",
            "Saved remote-server metadata after the connection check.",
            None,
            Some(&result.server),
            false,
        );
    }
    Ok(result)
}

#[tauri::command]
pub(crate) async fn update_remote_server(
    state: State<'_, AppState>,
    request: UpdateRemoteServerRequest,
) -> Result<RemoteServerSaveResult, String> {
    let update = update_remote_server_service(&state, request)?;
    record_remote_change(
        &state,
        "remote.server.update",
        "Updated local remote-server metadata. Rollback does not change SSH credentials or remote Codex files.",
        Some(&update.before),
        Some(&update.result.server),
        true,
    );
    Ok(update.result)
}

#[tauri::command]
pub(crate) async fn assign_remote_relay_key(
    state: State<'_, AppState>,
    server_id: String,
    station_id: String,
    key_id: String,
) -> Result<RemoteServer, String> {
    let (station, key) = read_api_key(&state, &station_id, &key_id).await?;
    let _operation = acquire_remote_operation(&state, &server_id)?;
    let mut server = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_remote_server(&server_id)?;
    let before = server.clone();
    let (rollback_reference, rollback_unavailable_reason) =
        capture_relay_rollback(&server, &_operation);
    let relay_url = base(&station.base_url);
    let relay_provider = server.relay_provider.clone();
    write_server_relay(
        &state,
        &mut server,
        &_operation,
        &relay_url,
        &key,
        Some(format!("{} / {}", station.name, key_id)),
        relay_provider,
        rollback_reference
            .as_ref()
            .map(|reference| reference.original_config_fingerprint.as_str()),
        "switch",
        "已将本地中转站密钥写入服务器 Codex CLI",
    )?;
    let (rollback_reference, rollback_unavailable_reason) = finalize_relay_rollback(
        &server,
        &_operation,
        rollback_reference,
        rollback_unavailable_reason,
    );
    record_remote_relay_change(
        &state,
        "remote.relay.assign",
        "Applied a relay configuration to the remote Codex CLI. The API key is redacted.",
        &before,
        &server,
        rollback_reference,
        rollback_unavailable_reason.as_deref(),
    );
    Ok(server)
}

#[tauri::command]
pub(crate) async fn update_remote_relay(
    state: State<'_, AppState>,
    request: UpdateRemoteRelayRequest,
) -> Result<RemoteServer, String> {
    let relay_url = request.relay_url.trim();
    if !relay_url.is_empty() {
        let parsed = Url::parse(relay_url).map_err(|_| "请输入有效的中转站地址")?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("中转站地址仅支持 HTTP 或 HTTPS".into());
        }
    }
    let _operation = acquire_remote_operation(&state, &request.server_id)?;
    let mut server = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_remote_server(&request.server_id)?;
    let before = server.clone();
    let (rollback_reference, rollback_unavailable_reason) =
        capture_relay_rollback(&server, &_operation);
    let relay_key = request
        .relay_key
        .filter(|key| !key.trim().is_empty())
        .map(|key| key.trim().to_string())
        .or_else(|| {
            remote_relay_key_entry(&server.id)
                .ok()
                .and_then(|entry| entry.get_password().ok())
        });
    if relay_key.is_some() && relay_url.is_empty() {
        return Err("请先填写中转站地址，再同步中转站密钥".into());
    }
    if relay_url.is_empty() {
        return Err("请输入中转站地址".into());
    }
    let relay_provider = request
        .relay_provider
        .filter(|value| !value.trim().is_empty());
    let relay_key = relay_key.ok_or("未保存中转站密钥，请输入新密钥后同步")?;
    write_server_relay(
        &state,
        &mut server,
        &_operation,
        relay_url,
        &relay_key,
        None,
        relay_provider,
        rollback_reference
            .as_ref()
            .map(|reference| reference.original_config_fingerprint.as_str()),
        "manual",
        "已将手动中转配置写入服务器 Codex CLI",
    )?;
    let (rollback_reference, rollback_unavailable_reason) = finalize_relay_rollback(
        &server,
        &_operation,
        rollback_reference,
        rollback_unavailable_reason,
    );
    record_remote_relay_change(
        &state,
        "remote.relay.update",
        "Applied a manual relay configuration to the remote Codex CLI. The relay key is redacted.",
        &before,
        &server,
        rollback_reference,
        rollback_unavailable_reason.as_deref(),
    );
    Ok(server)
}

#[tauri::command]
pub(crate) async fn test_remote_server(
    state: State<'_, AppState>,
    id: String,
) -> Result<RemoteConnectionResult, String> {
    test_remote_server_service(&state, &id)
}

#[tauri::command]
pub(crate) async fn verify_remote_codex_session_command(
    state: State<'_, AppState>,
    id: String,
) -> Result<RemoteConnectionResult, String> {
    verify_server_codex_session(&state, &id)
}

#[tauri::command]
pub(crate) async fn choose_private_key_file() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("选择 SSH密匙文件")
        .add_filter("SSH密匙文件", &["pem", "ppk", "key"])
        .pick_file()
        .map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
pub(crate) async fn delete_remote_server(
    state: State<'_, AppState>,
    id: String,
) -> Result<(), String> {
    let before = delete_remote_server_service(&state, &id)?;
    record_remote_change(
        &state,
        "remote.server.delete",
        "Deleted local remote-server metadata and credentials. Rollback restores metadata only; re-enter credentials before reconnecting.",
        Some(&before),
        None,
        true,
    );
    Ok(())
}
