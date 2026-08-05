use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::State;

use uuid::Uuid;

use crate::{
    audit_store::AuditStore,
    keyring_store::remote_relay_rollback_entry,
    models::{AuditEvent, RemoteServerRollbackSnapshot},
    remote_store::RemoteServerStore,
    services::remote::{
        acquire_operation as acquire_remote_operation, apply_snapshot, host_key_fingerprints_match,
        restore_codex_config_state, restore_relay_key, RemoteCodexConfigState,
    },
    support::now,
    AppState, RemoteServer,
};

pub(crate) const REMOTE_AUDIT_SCOPE: &str = "remote-config";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteRelayRollbackSnapshot {
    server_id: String,
    original: RemoteCodexConfigState,
    expected_current_state_fingerprint: Option<String>,
}

/// Windows Credential Manager limits an individual password value to 2,560
/// UTF-16 code units. Keep a margin for platform-specific representation.
const REMOTE_RELAY_ROLLBACK_CHUNK_MAX_UTF16_UNITS: usize = 2_000;
const REMOTE_RELAY_ROLLBACK_MANIFEST_VERSION: u8 = 1;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteRelayRollbackManifest {
    version: u8,
    generation: String,
    chunk_count: usize,
}

#[derive(Clone, Debug)]
pub(crate) struct RemoteRelayRollbackReference {
    id: String,
    pub(crate) original_config_fingerprint: String,
}

pub(crate) fn rollback_snapshot(server: &RemoteServer) -> RemoteServerRollbackSnapshot {
    RemoteServerRollbackSnapshot {
        id: server.id.clone(),
        name: server.name.clone(),
        host: server.host.clone(),
        port: server.port,
        username: server.username.clone(),
        auth_type: server.auth_type.clone(),
        host_key_fingerprint: server.host_key_fingerprint.clone(),
        relay_provider: server.relay_provider.clone(),
        relay_url: server.relay_url.clone(),
    }
}

pub(crate) fn remote_change_payload(
    before: Option<&RemoteServer>,
    after: Option<&RemoteServer>,
    rollback: bool,
) -> Value {
    remote_change_payload_with_rollback(before, after, rollback.then(|| json!({
        "kind": "remote-server-local",
        "note": "Only non-secret local server metadata can be restored. SSH credentials, private-key paths, relay keys, and remote Codex files are never changed.",
    })))
}

fn remote_change_payload_with_rollback(
    before: Option<&RemoteServer>,
    after: Option<&RemoteServer>,
    rollback: Option<Value>,
) -> Value {
    json!({
        "before": before.map(rollback_snapshot),
        "after": after.map(rollback_snapshot),
        "rollback": rollback,
    })
}

/// Stores the old *observed* remote relay configuration in the OS credential
/// manager.  The audit database gets only an opaque reference, never the key.
pub(crate) fn save_remote_relay_rollback_snapshot(
    server_id: &str,
    original: &RemoteCodexConfigState,
) -> Result<RemoteRelayRollbackReference, String> {
    let reference = RemoteRelayRollbackReference {
        id: Uuid::new_v4().to_string(),
        original_config_fingerprint: original.config_fingerprint.clone(),
    };
    let snapshot = RemoteRelayRollbackSnapshot {
        server_id: server_id.to_string(),
        original: original.clone(),
        expected_current_state_fingerprint: None,
    };
    save_secure_remote_relay_snapshot(&reference.id, &snapshot, "save")?;
    Ok(reference)
}

pub(crate) fn finalize_remote_relay_rollback_snapshot(
    reference: RemoteRelayRollbackReference,
    current: &RemoteCodexConfigState,
) -> Result<RemoteRelayRollbackReference, String> {
    let mut snapshot = load_secure_remote_relay_snapshot(&reference.id)?;
    if !host_key_fingerprints_match(
        &snapshot.original.host_key_fingerprint,
        &current.host_key_fingerprint,
    ) {
        return Err(
            "The remote SSH host key changed while applying the relay configuration".into(),
        );
    }
    snapshot.expected_current_state_fingerprint = Some(current.state_fingerprint.clone());
    save_secure_remote_relay_snapshot(&reference.id, &snapshot, "finalize")?;
    Ok(reference)
}

fn remote_relay_rollback_chunk_entry(
    reference_id: &str,
    generation: &str,
    index: usize,
) -> Result<keyring::Entry, String> {
    remote_relay_rollback_entry(&format!("{reference_id}:{generation}:{index}"))
}

fn split_remote_relay_rollback_chunks(serialized: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    let mut current_units = 0;

    for character in serialized.chars() {
        let character_units = character.len_utf16();
        if current_units + character_units > REMOTE_RELAY_ROLLBACK_CHUNK_MAX_UTF16_UNITS {
            chunks.push(current);
            current = String::new();
            current_units = 0;
        }
        current.push(character);
        current_units += character_units;
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn valid_remote_relay_rollback_manifest(
    manifest: &RemoteRelayRollbackManifest,
) -> Result<(), String> {
    if manifest.version != REMOTE_RELAY_ROLLBACK_MANIFEST_VERSION
        || manifest.generation.is_empty()
        || manifest.chunk_count == 0
        || manifest.chunk_count > 16_384
    {
        return Err("The secure rollback snapshot is invalid and cannot be used".into());
    }
    Ok(())
}

fn manifest_from_serialized_snapshot(value: &str) -> Option<RemoteRelayRollbackManifest> {
    serde_json::from_str(value)
        .ok()
        .filter(|manifest: &RemoteRelayRollbackManifest| {
            valid_remote_relay_rollback_manifest(manifest).is_ok()
        })
}

fn delete_remote_relay_rollback_chunks(reference_id: &str, manifest: &RemoteRelayRollbackManifest) {
    for index in 0..manifest.chunk_count {
        if let Ok(entry) =
            remote_relay_rollback_chunk_entry(reference_id, &manifest.generation, index)
        {
            let _ = entry.delete_credential();
        }
    }
}

fn save_secure_remote_relay_snapshot(
    reference_id: &str,
    snapshot: &RemoteRelayRollbackSnapshot,
    operation: &str,
) -> Result<(), String> {
    let serialized = serde_json::to_string(snapshot).map_err(|error| error.to_string())?;
    let chunks = split_remote_relay_rollback_chunks(&serialized);
    let manifest = RemoteRelayRollbackManifest {
        version: REMOTE_RELAY_ROLLBACK_MANIFEST_VERSION,
        generation: Uuid::new_v4().to_string(),
        chunk_count: chunks.len(),
    };
    let entry = remote_relay_rollback_entry(reference_id)?;
    let previous_manifest = entry
        .get_password()
        .ok()
        .and_then(|value| manifest_from_serialized_snapshot(&value));

    for (index, chunk) in chunks.iter().enumerate() {
        if let Err(error) =
            remote_relay_rollback_chunk_entry(reference_id, &manifest.generation, index).and_then(
                |chunk_entry| {
                    chunk_entry
                        .set_password(chunk)
                        .map_err(|error| error.to_string())
                },
            )
        {
            delete_remote_relay_rollback_chunks(reference_id, &manifest);
            return Err(format!(
                "Unable to {operation} the secure rollback snapshot: {error}"
            ));
        }
    }

    let manifest_json = serde_json::to_string(&manifest).map_err(|error| error.to_string())?;
    if let Err(error) = entry.set_password(&manifest_json) {
        delete_remote_relay_rollback_chunks(reference_id, &manifest);
        return Err(format!(
            "Unable to {operation} the secure rollback snapshot: {error}"
        ));
    }
    if let Some(previous_manifest) = previous_manifest {
        delete_remote_relay_rollback_chunks(reference_id, &previous_manifest);
    }
    Ok(())
}

fn load_secure_remote_relay_snapshot(
    reference_id: &str,
) -> Result<RemoteRelayRollbackSnapshot, String> {
    let serialized = remote_relay_rollback_entry(reference_id)?
        .get_password()
        .map_err(|_| "The secure rollback snapshot is no longer available locally".to_string())?;

    let complete_snapshot = match manifest_from_serialized_snapshot(&serialized) {
        Some(manifest) => {
            let mut chunks = String::new();
            for index in 0..manifest.chunk_count {
                let chunk =
                    remote_relay_rollback_chunk_entry(reference_id, &manifest.generation, index)?
                        .get_password()
                        .map_err(|_| {
                            "The secure rollback snapshot is incomplete and cannot be used"
                                .to_string()
                        })?;
                chunks.push_str(&chunk);
            }
            chunks
        }
        // Snapshots stored before chunking used the root credential directly.
        None => serialized,
    };
    serde_json::from_str(&complete_snapshot)
        .map_err(|_| "The secure rollback snapshot is invalid and cannot be used".to_string())
}

pub(crate) fn record_remote_change(
    state: &AppState,
    action: &str,
    detail: &str,
    before: Option<&RemoteServer>,
    after: Option<&RemoteServer>,
    rollback: bool,
) {
    if let Ok(store) = state.store.lock() {
        let _ = store.record_audit_with_payload(
            REMOTE_AUDIT_SCOPE,
            action,
            "success",
            detail,
            &remote_change_payload(before, after, rollback),
        );
    }
}

pub(crate) fn record_remote_relay_change(
    state: &AppState,
    action: &str,
    detail: &str,
    before: &RemoteServer,
    after: &RemoteServer,
    rollback_reference: Option<RemoteRelayRollbackReference>,
    unavailable_reason: Option<&str>,
) {
    let rollback = rollback_reference.map(|reference| json!({
        "kind": "remote-relay-config",
        "snapshotId": reference.id,
        "note": "Restores the exact remote Codex files observed before this relay change, including an absent or incomplete prior relay. Sensitive values remain only in the operating system credential store.",
    })).or_else(|| Some(json!({
        "kind": "unavailable",
        "note": unavailable_reason.unwrap_or("A secure, actionable remote relay snapshot was not available, so this change cannot be rolled back from history."),
    })));
    if let Ok(store) = state.store.lock() {
        let _ = store.record_audit_with_payload(
            REMOTE_AUDIT_SCOPE,
            action,
            "success",
            detail,
            &remote_change_payload_with_rollback(Some(before), Some(after), rollback),
        );
    }
}

#[tauri::command]
pub(crate) async fn list_audit_events(
    state: State<'_, AppState>,
    scope: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<AuditEvent>, String> {
    let scope = scope.as_deref().filter(|value| !value.trim().is_empty());
    state
        .store
        .lock()
        .map_err(|_| "Local database unavailable".to_string())?
        .list_audit_events(scope, limit.unwrap_or(100))
}

fn relay_rollback_reference(event: &AuditEvent) -> Result<String, String> {
    if !matches!(
        event.action.as_str(),
        "remote.relay.assign" | "remote.relay.update"
    ) {
        return Err("This audit event does not change a remote Codex relay configuration".into());
    }
    event
        .payload
        .as_ref()
        .and_then(|payload| payload.get("rollback"))
        .and_then(|rollback| {
            (rollback.get("kind")?.as_str() == Some("remote-relay-config")).then_some(rollback)
        })
        .and_then(|rollback| rollback.get("snapshotId")?.as_str())
        .map(str::to_string)
        .ok_or(
            "This relay change has no secure rollback snapshot. It cannot be replayed safely."
                .to_string(),
        )
}

fn restore_local_metadata(state: &AppState, event: &AuditEvent) -> Result<RemoteServer, String> {
    let snapshot = event
        .payload
        .as_ref()
        .and_then(|payload| payload.get("before"))
        .cloned()
        .ok_or("This audit event has no local rollback snapshot")?;
    let snapshot: RemoteServerRollbackSnapshot = serde_json::from_value(snapshot)
        .map_err(|_| "This audit event has an invalid rollback snapshot")?;
    let store = state
        .store
        .lock()
        .map_err(|_| "Local database unavailable".to_string())?;
    let mut server = match store.get_remote_server(&snapshot.id) {
        Ok(server) => server,
        Err(_) if event.action == "remote.server.delete" => RemoteServer {
            id: snapshot.id.clone(), name: snapshot.name.clone(), host: snapshot.host.clone(), port: snapshot.port,
            username: snapshot.username.clone(), auth_type: snapshot.auth_type.clone(), private_key_path: None,
            codex_version: None, codex_latest_version: None, codex_update_available: false, host_key_fingerprint: snapshot.host_key_fingerprint.clone(),
            relay_url: None, relay_provider: snapshot.relay_provider.clone(), relay_key_source: None, relay_key_masked: None,
            relay_config_fingerprint: None, connection_status: "warning".into(), connection_error: Some("Restored from local history. Re-enter SSH credentials and test the connection before changing the remote relay.".into()),
            last_synced_at: None, last_sync_status: None, last_sync_error: None, updated_at: now(),
        },
        Err(error) => return Err(error),
    };
    server.name = snapshot.name;
    server.host = snapshot.host;
    server.port = snapshot.port;
    server.username = snapshot.username;
    server.auth_type = snapshot.auth_type;
    server.host_key_fingerprint = snapshot.host_key_fingerprint;
    server.relay_provider = snapshot.relay_provider;
    server.relay_url = snapshot.relay_url;
    // Never restore a key path, saved SSH credential, relay key source, or mask.
    server.private_key_path = None;
    server.relay_key_source = None;
    server.relay_key_masked = None;
    server.updated_at = now();
    store.save_remote_server(&server)?;
    store.record_audit_with_payload(
        REMOTE_AUDIT_SCOPE,
        "remote.server.rollback",
        "success",
        "Restored non-secret local remote-server metadata from history. No credential or remote Codex file was changed.",
        &json!({"sourceEventId": event.id, "after": rollback_snapshot(&server)}),
    )?;
    Ok(server)
}

fn restore_remote_relay(
    state: &AppState,
    event: &AuditEvent,
    reference: &str,
) -> Result<RemoteServer, String> {
    let snapshot = load_secure_remote_relay_snapshot(reference).map_err(|error| {
        if error == "The secure rollback snapshot is no longer available locally" {
            "The secure rollback snapshot is no longer available locally. The remote relay cannot be restored safely.".to_string()
        } else {
            error
        }
    })?;
    let before = event
        .payload
        .as_ref()
        .and_then(|payload| payload.get("before"));
    let event_server_id = before
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .ok_or("This relay audit event has no server identity")?;
    if snapshot.server_id != event_server_id {
        return Err("The secure rollback snapshot does not belong to this server".into());
    }
    let _operation = acquire_remote_operation(state, &snapshot.server_id)?;
    let mut server = state
        .store
        .lock()
        .map_err(|_| "Local database unavailable".to_string())?
        .get_remote_server(&snapshot.server_id)?;
    let expected_current_state_fingerprint = snapshot
        .expected_current_state_fingerprint
        .as_deref()
        .ok_or("This relay rollback snapshot was not finalized after the original change")?;
    let remote_snapshot = restore_codex_config_state(
        &server,
        &snapshot.original,
        expected_current_state_fingerprint,
        Some(&_operation),
    )?;
    // A first assignment may have replaced an absent or incomplete relay.
    // Clear local relay metadata before applying the restored remote snapshot.
    server.relay_provider = None;
    server.relay_url = None;
    server.relay_key_source = None;
    server.relay_key_masked = None;
    let restored_relay_key = remote_snapshot
        .relay
        .as_ref()
        .map(|relay| relay.key.clone());
    apply_snapshot(&mut server, remote_snapshot)?;
    restore_relay_key(&server.id, restored_relay_key.as_deref());
    server.updated_at = now();
    let store = state
        .store
        .lock()
        .map_err(|_| "Local database unavailable".to_string())?;
    store.save_remote_server(&server)?;
    store.record_audit_with_payload(
        REMOTE_AUDIT_SCOPE,
        "remote.relay.rollback",
        "success",
        "Restored the exact remote Codex configuration from a secure local rollback snapshot.",
        &json!({"sourceEventId": event.id, "after": rollback_snapshot(&server)}),
    )?;
    Ok(server)
}

#[tauri::command]
pub(crate) async fn rollback_audit_event(
    state: State<'_, AppState>,
    event_id: i64,
) -> Result<RemoteServer, String> {
    let event = state
        .store
        .lock()
        .map_err(|_| "Local database unavailable".to_string())?
        .audit_event(event_id)?
        .ok_or("Audit event not found")?;
    if event.station_id != REMOTE_AUDIT_SCOPE {
        return Err("Only remote configuration audit events can be rolled back".into());
    }
    if matches!(
        event.action.as_str(),
        "remote.relay.assign" | "remote.relay.update"
    ) {
        let reference = relay_rollback_reference(&event)?;
        return restore_remote_relay(&state, &event, &reference);
    }
    if matches!(
        event.action.as_str(),
        "remote.server.update" | "remote.server.delete"
    ) {
        return restore_local_metadata(&state, &event);
    }
    Err("This audit event cannot be rolled back safely".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audit_snapshot_excludes_ssh_and_relay_secrets() {
        let server = RemoteServer {
            id: "server".into(),
            name: "Server".into(),
            host: "host".into(),
            port: 22,
            username: "root".into(),
            auth_type: "key".into(),
            private_key_path: Some("C:/private.pem".into()),
            codex_version: None,
            codex_latest_version: None,
            codex_update_available: false,
            host_key_fingerprint: None,
            relay_url: Some("https://relay.example".into()),
            relay_provider: Some("relay".into()),
            relay_key_source: Some("station / key".into()),
            relay_key_masked: Some("sk-***".into()),
            relay_config_fingerprint: None,
            connection_status: "online".into(),
            connection_error: None,
            last_synced_at: None,
            last_sync_status: None,
            last_sync_error: None,
            updated_at: 0,
        };
        let payload = remote_change_payload(Some(&server), None, true).to_string();
        assert!(!payload.contains("private.pem"));
        assert!(!payload.contains("station / key"));
        assert!(!payload.contains("sk-***"));
    }

    #[test]
    fn relay_rollback_requires_secure_reference() {
        let event = AuditEvent {
            id: 1,
            station_id: REMOTE_AUDIT_SCOPE.into(),
            action: "remote.relay.update".into(),
            outcome: "success".into(),
            detail: String::new(),
            payload: Some(json!({"rollback": {"kind": "unavailable"}})),
            created_at: 0,
        };
        assert!(relay_rollback_reference(&event).is_err());
    }

    #[test]
    fn rollback_snapshot_chunks_stay_under_windows_credential_limit() {
        let serialized = format!("prefix{}suffix", "a😀中".repeat(1_500));
        let chunks = split_remote_relay_rollback_chunks(&serialized);

        assert!(chunks.len() > 1);
        assert_eq!(chunks.concat(), serialized);
        assert!(chunks.iter().all(|chunk| {
            chunk.encode_utf16().count() <= REMOTE_RELAY_ROLLBACK_CHUNK_MAX_UTF16_UNITS
        }));
    }

    #[test]
    fn rollback_manifest_requires_supported_non_empty_shape() {
        let valid = RemoteRelayRollbackManifest {
            version: REMOTE_RELAY_ROLLBACK_MANIFEST_VERSION,
            generation: "generation".into(),
            chunk_count: 1,
        };
        assert!(valid_remote_relay_rollback_manifest(&valid).is_ok());

        let invalid = RemoteRelayRollbackManifest {
            version: 2,
            generation: "generation".into(),
            chunk_count: 1,
        };
        assert!(valid_remote_relay_rollback_manifest(&invalid).is_err());
    }
}
