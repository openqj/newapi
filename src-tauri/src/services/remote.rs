use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};

use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use ssh2::Session;
use tauri::Emitter;
use toml_edit::{value as toml_value, DocumentMut, Item, Table};
use uuid::Uuid;

use crate::{
    keyring_store::{remote_key_passphrase_entry, remote_relay_key_entry, remote_server_entry},
    models::{
        AddRemoteServerRequest, GenerateSshKeyRequest, GenerateSshKeyResult,
        RemoteConnectionResult, RemoteServer, RemoteServerSaveResult, UpdateRemoteServerRequest,
    },
    remote_store::RemoteServerStore,
    remote_sync_logs::RemoteSyncLogStore,
    support::now,
    AppState, RemoteOperationGuard,
};

pub(crate) enum RemoteSession {
    Libssh(Session),
    #[cfg(windows)]
    OpenSsh(Box<RemoteServer>),
}

pub(crate) const REMOTE_CODEX_INSTALL_LOG_EVENT: &str = "relayhub:remote-codex-install-log";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteCodexInstallLogEvent {
    server_id: String,
    phase: String,
    level: String,
    message: String,
    done: bool,
    success: Option<bool>,
}

#[derive(Clone)]
struct RemoteCodexInstallLogger {
    app_handle: tauri::AppHandle<tauri::Wry>,
    server_id: String,
}

impl RemoteCodexInstallLogger {
    fn new(app_handle: tauri::AppHandle<tauri::Wry>, server_id: &str) -> Self {
        Self {
            app_handle,
            server_id: server_id.into(),
        }
    }

    fn emit(
        &self,
        phase: &str,
        level: &str,
        message: impl Into<String>,
        done: bool,
        success: Option<bool>,
    ) {
        let _ = self.app_handle.emit(
            REMOTE_CODEX_INSTALL_LOG_EVENT,
            RemoteCodexInstallLogEvent {
                server_id: self.server_id.clone(),
                phase: phase.into(),
                level: level.into(),
                message: message.into(),
                done,
                success,
            },
        );
    }

    fn info(&self, phase: &str, message: impl Into<String>) {
        self.emit(phase, "info", message, false, None);
    }

    fn output(&self, phase: &str, output: &str) {
        for line in output
            .lines()
            .map(str::trim_end)
            .filter(|line| !line.trim().is_empty())
        {
            self.emit(phase, "output", line, false, None);
        }
    }

    fn finish(&self, success: bool, message: impl Into<String>) {
        self.emit(
            "completed",
            if success { "success" } else { "error" },
            message,
            true,
            Some(success),
        );
    }
}

impl RemoteSession {
    fn set_timeout(&mut self, timeout: u32) {
        if let Self::Libssh(session) = self {
            session.set_timeout(timeout);
        }
    }
}

pub(crate) fn acquire_operation(
    state: &AppState,
    id: &str,
) -> Result<RemoteOperationGuard, String> {
    let mut operations = state
        .remote_operations
        .lock()
        .map_err(|_| "远程同步状态不可用".to_string())?;
    if operations.contains_key(id) {
        return Err("该服务器已有同步或测试正在执行，请等待完成".into());
    }
    let cancelled = Arc::new(AtomicBool::new(false));
    operations.insert(id.to_string(), cancelled.clone());
    Ok(RemoteOperationGuard {
        id: id.to_string(),
        operations: state.remote_operations.clone(),
        cancelled,
    })
}

pub(crate) fn cancel_operation(state: &AppState, id: &str) -> Result<(), String> {
    let operations = state
        .remote_operations
        .lock()
        .map_err(|_| "远程同步状态不可用".to_string())?;
    let cancelled = operations.get(id).ok_or("该服务器当前没有可取消的操作")?;
    cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

pub(crate) fn add_sync_log(
    state: &AppState,
    server: &RemoteServer,
    status: &str,
    action: &str,
    summary: &str,
) {
    if let Ok(store) = state.store.lock() {
        let _ = store.add_remote_sync_log(
            &server.id,
            status,
            action,
            summary,
            server.relay_config_fingerprint.as_deref(),
        );
    }
}

/// Validates, probes, and persists a new remote server without recording an audit event.
pub(crate) fn add_server(
    state: &AppState,
    request: AddRemoteServerRequest,
) -> Result<RemoteServerSaveResult, String> {
    if request.host.trim().is_empty() || request.username.trim().is_empty() {
        return Err("服务器 IP 和用户名不能为空".into());
    }
    if request.port == 0 {
        return Err("SSH 端口必须介于 1 和 65535 之间".into());
    }
    if !matches!(request.auth_type.as_str(), "password" | "key") {
        return Err("不支持的登录方式".into());
    }
    if request.auth_type == "password" && request.password.as_deref().unwrap_or_default().is_empty()
    {
        return Err("请输入服务器密码".into());
    }
    if request.auth_type == "key"
        && request
            .private_key_path
            .as_deref()
            .unwrap_or_default()
            .trim()
            .is_empty()
    {
        return Err("请输入或选择 SSH密匙".into());
    }
    let id = Uuid::new_v4().to_string();
    let name = if request.name.trim().is_empty() {
        let next = state
            .store
            .lock()
            .map_err(|_| "本地数据库不可用".to_string())?
            .list_remote_servers()?
            .len()
            + 1;
        format!("服务器{next}")
    } else {
        request.name.trim().to_string()
    };
    let mut server = RemoteServer {
        id,
        name,
        host: request.host.trim().to_string(),
        port: request.port,
        username: request.username.trim().to_string(),
        auth_type: request.auth_type,
        private_key_path: request
            .private_key_path
            .filter(|value| !value.trim().is_empty()),
        codex_version: None,
        codex_latest_version: None,
        codex_update_available: false,
        host_key_fingerprint: request
            .host_key_fingerprint
            .filter(|value| !value.trim().is_empty()),
        relay_url: None,
        relay_provider: request
            .relay_provider
            .filter(|value| !value.trim().is_empty()),
        relay_key_source: None,
        relay_key_masked: None,
        relay_config_fingerprint: None,
        connection_status: "warning".into(),
        connection_error: None,
        last_synced_at: None,
        last_sync_status: None,
        last_sync_error: None,
        updated_at: now(),
    };
    if server.host_key_fingerprint.is_none() {
        let fingerprint = probe_host_key(&server.host, server.port)?;
        server.host_key_fingerprint = Some(fingerprint.clone());
        return Ok(RemoteServerSaveResult {
            server,
            connection: RemoteConnectionResult {
                success: false,
                status: "warning".into(),
                code: None,
                reason: Some("请确认 SSH 主机指纹后再保存服务器".into()),
                host_key_fingerprint: Some(fingerprint),
                requires_host_key_confirmation: true,
            },
        });
    }
    if server.auth_type == "password" {
        remote_server_entry(&server.id)?
            .set_password(request.password.as_deref().unwrap_or_default())
            .map_err(|error| error.to_string())?;
    }
    if server.auth_type == "key" {
        if let Some(passphrase) = request
            .private_key_passphrase
            .filter(|value| !value.is_empty())
        {
            remote_key_passphrase_entry(&server.id)?
                .set_password(&passphrase)
                .map_err(|error| error.to_string())?;
        }
    }
    let (connection, relay) = test_and_read_server(&server, None);
    server.connection_status = connection.status.clone();
    server.connection_error = connection
        .reason
        .clone()
        .map(|reason| match connection.code {
            Some(code) => format!("错误代码 {code}: {reason}"),
            None => reason,
        });
    if !connection.success {
        if server.auth_type == "password" {
            if let Ok(entry) = remote_server_entry(&server.id) {
                let _ = entry.delete_credential();
            }
        }
        if server.auth_type == "key" {
            if let Ok(entry) = remote_key_passphrase_entry(&server.id) {
                let _ = entry.delete_credential();
            }
        }
        return Ok(RemoteServerSaveResult { server, connection });
    }
    if let Some(snapshot) = relay {
        apply_snapshot(&mut server, snapshot)?;
    }
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_remote_server(&server)?;
    Ok(RemoteServerSaveResult { server, connection })
}

pub(crate) struct RemoteServerUpdate {
    pub(crate) before: RemoteServer,
    pub(crate) result: RemoteServerSaveResult,
}

/// Updates a saved server and records the operational outcome, but not the audit event.
pub(crate) fn update_server(
    state: &AppState,
    request: UpdateRemoteServerRequest,
) -> Result<RemoteServerUpdate, String> {
    if request.host.trim().is_empty() || request.username.trim().is_empty() {
        return Err("服务器 IP 和用户名不能为空".into());
    }
    if request.port == 0 {
        return Err("SSH 端口必须介于 1 和 65535 之间".into());
    }
    if !matches!(request.auth_type.as_str(), "password" | "key") {
        return Err("不支持的登录方式".into());
    }
    let operation = acquire_operation(state, &request.id)?;
    let mut server = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_remote_server(&request.id)?;
    let before = server.clone();
    let password = request.password.unwrap_or_default();
    let private_key_path = request.private_key_path.unwrap_or_default();
    let has_saved_password = remote_server_entry(&server.id)?
        .get_password()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false);
    if request.auth_type == "password"
        && password.trim().is_empty()
        && (server.auth_type != "password" || !has_saved_password)
    {
        return Err("未保存服务器密码，请重新输入后保存".into());
    }
    if request.auth_type == "key" && private_key_path.trim().is_empty() {
        return Err("请输入或选择 SSH密匙".into());
    }
    if request.auth_type == "password" && !password.trim().is_empty() {
        remote_server_entry(&server.id)?
            .set_password(&password)
            .map_err(|error| error.to_string())?;
    }
    if request.auth_type == "key" && server.auth_type != "key" {
        let _ = remote_server_entry(&server.id)?.delete_credential();
    }
    if request.auth_type == "key" {
        if let Some(passphrase) = request
            .private_key_passphrase
            .filter(|value| !value.is_empty())
        {
            remote_key_passphrase_entry(&server.id)?
                .set_password(&passphrase)
                .map_err(|error| error.to_string())?;
        }
    } else if server.auth_type == "key" {
        let _ = remote_key_passphrase_entry(&server.id)?.delete_credential();
    }
    server.name = if request.name.trim().is_empty() {
        request.host.trim().to_string()
    } else {
        request.name.trim().to_string()
    };
    server.host = request.host.trim().to_string();
    server.port = request.port;
    server.username = request.username.trim().to_string();
    server.auth_type = request.auth_type;
    server.private_key_path = if server.auth_type == "key" {
        Some(private_key_path)
    } else {
        None
    };
    server.relay_provider = request
        .relay_provider
        .filter(|value| !value.trim().is_empty());
    let (connection, relay) = test_and_read_server(&server, Some(&operation));
    server.connection_status = connection.status.clone();
    server.connection_error = connection
        .reason
        .clone()
        .map(|reason| match connection.code {
            Some(code) => format!("错误代码 {code}: {reason}"),
            None => reason,
        });
    if let Some(snapshot) = relay {
        apply_snapshot(&mut server, snapshot)?;
    }
    server.updated_at = now();
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_remote_server(&server)?;
    add_sync_log(
        state,
        &server,
        if connection.success {
            "success"
        } else {
            "error"
        },
        "update",
        if connection.success {
            "服务器配置已更新并完成读取"
        } else {
            server
                .connection_error
                .as_deref()
                .unwrap_or("服务器连接失败")
        },
    );
    Ok(RemoteServerUpdate {
        before,
        result: RemoteServerSaveResult { server, connection },
    })
}

/// Applies one relay credential to the remote Codex configuration and persists its snapshot.
/// Audit rollback capture/finalization stays at the command boundary.
#[allow(clippy::too_many_arguments)]
pub(crate) fn write_server_relay(
    state: &AppState,
    server: &mut RemoteServer,
    operation: &RemoteOperationGuard,
    relay_url: &str,
    relay_key: &str,
    relay_key_source: Option<String>,
    relay_provider: Option<String>,
    original_config_fingerprint: Option<&str>,
    action: &str,
    summary: &str,
) -> Result<(), String> {
    if relay_provider.is_some() {
        server.relay_provider = relay_provider;
    }
    let previous_key = match replace_relay_key(&server.id, relay_key) {
        Ok(key) => key,
        Err(error) => {
            record_failure(state, server, action, &error);
            return Err(error);
        }
    };
    let mut write_server = server.clone();
    if let Some(fingerprint) = original_config_fingerprint {
        write_server.relay_config_fingerprint = Some(fingerprint.to_string());
    }
    let snapshot =
        match write_codex_relay_config(&write_server, relay_url, relay_key, Some(operation)) {
            Ok(snapshot) => snapshot,
            Err(error) => {
                restore_relay_key(&server.id, previous_key.as_deref());
                record_failure(state, server, action, &error);
                return Err(error);
            }
        };
    server.relay_url = Some(relay_url.to_string());
    server.relay_key_source = relay_key_source;
    server.relay_key_masked = Some(mask_secret(relay_key));
    apply_snapshot(server, snapshot)?;
    server.updated_at = now();
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_remote_server(server)?;
    add_sync_log(state, server, "success", action, summary);
    Ok(())
}

pub(crate) fn record_failure(
    state: &AppState,
    server: &mut RemoteServer,
    action: &str,
    reason: &str,
) {
    server.last_synced_at = Some(now());
    server.last_sync_status = Some(if reason == "操作已取消" {
        "cancelled".into()
    } else {
        "error".into()
    });
    server.last_sync_error = Some(reason.to_string());
    server.updated_at = now();
    if let Ok(store) = state.store.lock() {
        let _ = store.save_remote_server(server);
        let _ = store.add_remote_sync_log(
            &server.id,
            server.last_sync_status.as_deref().unwrap_or("error"),
            action,
            reason,
            server.relay_config_fingerprint.as_deref(),
        );
    }
}

/// Installs or updates Codex on a saved remote server and persists the refreshed snapshot.
pub(crate) fn install_or_update_server_codex(
    state: &AppState,
    id: &str,
    action: &str,
) -> Result<RemoteServer, String> {
    let logger = RemoteCodexInstallLogger::new(state.app_handle.clone(), id);
    if !matches!(action, "install" | "update") {
        return Err("不支持的 Codex 操作".into());
    }
    let operation = match acquire_operation(state, id) {
        Ok(operation) => operation,
        Err(error) => {
            logger.finish(false, format!("Codex CLI 安装失败：{error}"));
            return Err(error);
        }
    };
    let mut server = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_remote_server(id)?;
    if action == "update" && server.codex_version.is_none() {
        return Err("服务器尚未检测到 Codex，请先安装".into());
    }
    if action == "update" && !server.codex_update_available {
        return Err("当前未检测到可用更新，请先测试 SSH 连接刷新版本状态".into());
    }
    let snapshot = match install_or_update_codex(&server, Some(&operation), Some(&logger)) {
        Ok(snapshot) => snapshot,
        Err(error) => {
            logger.finish(false, format!("Codex CLI 安装失败：{error}"));
            record_failure(state, &mut server, action, &error);
            return Err(error);
        }
    };
    apply_snapshot(&mut server, snapshot)?;
    server.connection_status = "online".into();
    server.connection_error = None;
    server.updated_at = now();
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_remote_server(&server)?;
    add_sync_log(
        state,
        &server,
        "success",
        action,
        if action == "install" {
            "已安装 Codex CLI 并完成版本校验"
        } else {
            "已更新 Codex CLI 并完成版本校验"
        },
    );
    logger.finish(
        true,
        if action == "install" {
            "Codex CLI 安装完成并已校验版本"
        } else {
            "Codex CLI 更新完成并已校验版本"
        },
    );
    Ok(server)
}

/// Runs the SSH/Codex probe for a saved server and stores the observed state.
pub(crate) fn test_server(state: &AppState, id: &str) -> Result<RemoteConnectionResult, String> {
    let operation = acquire_operation(state, id)?;
    let mut server = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_remote_server(id)?;
    let (connection, relay) = test_and_read_server(&server, Some(&operation));
    server.connection_status = connection.status.clone();
    server.connection_error = connection
        .reason
        .clone()
        .map(|reason| match connection.code {
            Some(code) => format!("错误代码 {code}: {reason}"),
            None => reason,
        });
    if let Some(snapshot) = relay {
        apply_snapshot(&mut server, snapshot)?;
    }
    server.updated_at = now();
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_remote_server(&server)?;
    add_sync_log(
        state,
        &server,
        if connection.success {
            "success"
        } else {
            "error"
        },
        "test",
        if connection.success {
            "SSH 连接和 Codex 配置读取成功"
        } else {
            server.connection_error.as_deref().unwrap_or("SSH 连接失败")
        },
    );
    Ok(connection)
}

/// Verifies a saved remote Codex CLI session and persists the observed result.
pub(crate) fn verify_server_codex_session(
    state: &AppState,
    id: &str,
) -> Result<RemoteConnectionResult, String> {
    let operation = acquire_operation(state, id)?;
    let mut server = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_remote_server(id)?;
    let result = verify_codex_session(&server, Some(&operation));
    server.connection_status = result.status.clone();
    server.connection_error = result.reason.clone();
    server.last_synced_at = Some(now());
    server.last_sync_status = Some(if result.success {
        "verified".into()
    } else {
        "error".into()
    });
    server.last_sync_error = result.reason.clone();
    server.updated_at = now();
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_remote_server(&server)?;
    add_sync_log(
        state,
        &server,
        if result.success { "success" } else { "error" },
        "session",
        if result.success {
            "Codex CLI 实际会话验证成功"
        } else {
            "Codex CLI 实际会话验证失败（错误详情已脱敏）"
        },
    );
    Ok(result)
}

/// Deletes persisted server metadata and its local credentials, returning the audit snapshot.
pub(crate) fn delete_server(state: &AppState, id: &str) -> Result<RemoteServer, String> {
    let _operation = acquire_operation(state, id)?;
    let server = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_remote_server(id)?;
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .delete_remote_server(id)?;
    if let Ok(entry) = remote_server_entry(id) {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = remote_key_passphrase_entry(id) {
        let _ = entry.delete_credential();
    }
    if let Ok(entry) = remote_relay_key_entry(id) {
        let _ = entry.delete_credential();
    }
    Ok(server)
}

pub(crate) fn replace_relay_key(id: &str, key: &str) -> Result<Option<String>, String> {
    let entry = remote_relay_key_entry(id)?;
    let previous = entry
        .get_password()
        .ok()
        .filter(|value| !value.trim().is_empty());
    entry.set_password(key).map_err(|error| error.to_string())?;
    Ok(previous)
}

pub(crate) fn restore_relay_key(id: &str, previous: Option<&str>) {
    if let Ok(entry) = remote_relay_key_entry(id) {
        match previous {
            Some(key) => {
                let _ = entry.set_password(key);
            }
            None => {
                let _ = entry.delete_credential();
            }
        }
    }
}

pub(crate) struct CodexRelayConfig {
    pub(crate) url: String,
    pub(crate) key: String,
    pub(crate) provider: String,
}

pub(crate) struct RemoteCodexSnapshot {
    pub(crate) relay: Option<CodexRelayConfig>,
    pub(crate) codex_version: Option<String>,
    pub(crate) codex_latest_version: Option<String>,
    pub(crate) codex_update_available: bool,
    pub(crate) host_key_fingerprint: String,
    pub(crate) config_fingerprint: String,
}

/// The complete set of remote files changed when applying a Codex relay.
/// This type is only intended for credential-store rollback snapshots; it
/// must never be copied into the SQLite audit payload.
#[derive(Clone, Debug, serde::Deserialize, serde::Serialize)]
pub(crate) struct RemoteCodexConfigState {
    pub(crate) host_key_fingerprint: String,
    pub(crate) config: Option<String>,
    pub(crate) auth: Option<String>,
    pub(crate) relay_env: Option<String>,
    pub(crate) bashrc: Option<String>,
    pub(crate) config_fingerprint: String,
    pub(crate) state_fingerprint: String,
}

pub(crate) fn remote_socket(host: &str, port: u16) -> Result<SocketAddr, String> {
    let address = if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    };
    address
        .to_socket_addrs()
        .map_err(|error| error.to_string())?
        .next()
        .ok_or_else(|| "未解析到服务器地址".into())
}

fn libssh_host_key_fingerprint(session: &Session) -> Result<String, String> {
    let (host_key, _) = session.host_key().ok_or("服务器未提供 SSH 主机密钥")?;
    let digest = Sha256::digest(host_key);
    Ok(format!(
        "SHA256:{}",
        digest
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    ))
}

pub(crate) fn host_key_fingerprint(session: &RemoteSession) -> Result<String, String> {
    match session {
        RemoteSession::Libssh(session) => libssh_host_key_fingerprint(session),
        #[cfg(windows)]
        RemoteSession::OpenSsh(server) => probe_host_key(&server.host, server.port),
    }
}

fn system_ssh_target(server: &RemoteServer) -> String {
    format!("{}@{}", server.username, server.host)
}

#[cfg(windows)]
fn append_system_ssh_line(
    output: &mut String,
    logger: Option<&RemoteCodexInstallLogger>,
    phase: &str,
    line: String,
) {
    let line = line.trim_end_matches('\r');
    if !output.is_empty() {
        output.push('\n');
    }
    output.push_str(line);
    if let Some(logger) = logger {
        logger.output(phase, line);
    }
}

#[cfg(windows)]
fn system_ssh_with_host_key_policy(
    server: &RemoteServer,
    script: &str,
    timeout: Duration,
    use_known_hosts: bool,
    logger: Option<&RemoteCodexInstallLogger>,
    log_phase: &str,
) -> Result<(i32, String), String> {
    let private_key = server
        .private_key_path
        .as_deref()
        .filter(|path| !path.contains("-----BEGIN"))
        .ok_or("Windows OpenSSH 回退仅支持密钥文件路径")?;
    let mut command = Command::new("ssh");
    command
        .arg("-i")
        .arg(private_key)
        .arg("-o")
        .arg("IdentitiesOnly=yes")
        .arg("-o")
        .arg("BatchMode=yes");
    if use_known_hosts {
        command.arg("-o").arg("StrictHostKeyChecking=accept-new");
    } else {
        // The caller has already verified the host key through libssh2. Use
        // an isolated known-hosts file so an obsolete user entry cannot block
        // this one-shot validation.
        command
            .arg("-o")
            .arg("StrictHostKeyChecking=no")
            .arg("-o")
            .arg("UserKnownHostsFile=NUL");
    }
    let mut child = command
        .arg("-o")
        .arg("ConnectTimeout=15")
        .arg("-p")
        .arg(server.port.to_string())
        .arg(system_ssh_target(server))
        .arg("bash -s")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("无法启动 Windows OpenSSH：{error}"))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or("无法打开 Windows OpenSSH 标准输入")?;
    stdin
        .write_all(script.as_bytes())
        .map_err(|error| format!("无法发送远程 SSH 命令：{error}"))?;
    drop(stdin);
    if let Some(logger) = logger {
        return stream_system_ssh_output(child, timeout, logger, log_phase);
    }
    let started = std::time::Instant::now();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("无法等待 Windows OpenSSH：{error}"))?
        {
            let output = child
                .wait_with_output()
                .map_err(|error| format!("无法读取 Windows OpenSSH 输出：{error}"))?;
            // SSH may emit host-key notices on stderr even when the remote command succeeds.
            // Keep stderr out of file contents such as config.toml and auth.json.
            let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
            if !status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                if !stderr.trim().is_empty() {
                    if !text.is_empty() {
                        text.push('\n');
                    }
                    text.push_str(&stderr);
                }
            }
            return Ok((status.code().unwrap_or(1), text));
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "Windows OpenSSH 命令超时（{} 秒）",
                timeout.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(windows)]
fn stream_system_ssh_output(
    mut child: std::process::Child,
    timeout: Duration,
    logger: &RemoteCodexInstallLogger,
    log_phase: &str,
) -> Result<(i32, String), String> {
    let stdout = child
        .stdout
        .take()
        .ok_or("无法打开 Windows OpenSSH 标准输出")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("无法打开 Windows OpenSSH 标准错误")?;
    let (line_sender, line_receiver) = std::sync::mpsc::channel::<String>();
    let mut readers = Vec::with_capacity(2);
    let streams: [Box<dyn Read + Send>; 2] = [Box::new(stdout), Box::new(stderr)];
    for stream in streams {
        let sender = line_sender.clone();
        readers.push(std::thread::spawn(move || {
            let reader = BufReader::new(stream);
            for line in reader.lines().map_while(Result::ok) {
                let _ = sender.send(line);
            }
        }));
    }
    drop(line_sender);

    let mut output = String::new();
    let started = std::time::Instant::now();
    loop {
        while let Ok(line) = line_receiver.try_recv() {
            append_system_ssh_line(&mut output, Some(logger), log_phase, line);
        }
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("无法等待 Windows OpenSSH：{error}"))?
        {
            for reader in readers {
                let _ = reader.join();
            }
            while let Ok(line) = line_receiver.try_recv() {
                append_system_ssh_line(&mut output, Some(logger), log_phase, line);
            }
            return Ok((status.code().unwrap_or(1), output));
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            for reader in readers {
                let _ = reader.join();
            }
            return Err(format!(
                "Windows OpenSSH {log_phase} 命令超时（{} 秒）",
                timeout.as_secs()
            ));
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(windows)]
fn system_ssh_session(
    server: &RemoteServer,
    operation: Option<&RemoteOperationGuard>,
    use_known_hosts: bool,
) -> Result<RemoteSession, String> {
    ensure_active(operation)?;
    let fingerprint = probe_host_key(&server.host, server.port)?;
    if let Some(expected) = &server.host_key_fingerprint {
        if expected != &fingerprint {
            return Err(format!(
                "SSH 主机指纹不匹配：预期 {expected}，实际 {fingerprint}"
            ));
        }
    }
    if !use_known_hosts && server.host_key_fingerprint.is_none() {
        return Err("使用隔离的 OpenSSH 主机密钥验证前必须先确认主机指纹".into());
    }
    let (status, output) = system_ssh_with_host_key_policy(
        server,
        "true\n",
        Duration::from_secs(20),
        use_known_hosts,
        None,
        "command",
    )?;
    if status != 0 {
        let detail = output.trim();
        return Err(if detail.is_empty() {
            format!("Windows OpenSSH 私钥认证失败，退出码 {status}")
        } else {
            format!("Windows OpenSSH 私钥认证失败：{detail}")
        });
    }
    Ok(RemoteSession::OpenSsh(Box::new(server.clone())))
}

fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        encoded.push(ALPHABET[(first >> 2) as usize] as char);
        encoded.push(ALPHABET[(((first & 0b11) << 4) | (second >> 4)) as usize] as char);
        encoded.push(if chunk.len() > 1 {
            ALPHABET[(((second & 0b1111) << 2) | (third >> 6)) as usize] as char
        } else {
            '='
        });
        encoded.push(if chunk.len() > 2 {
            ALPHABET[(third & 0b111111) as usize] as char
        } else {
            '='
        });
    }
    encoded
}

pub(crate) fn probe_host_key(host: &str, port: u16) -> Result<String, String> {
    let socket = remote_socket(host, port)?;
    let tcp = TcpStream::connect_timeout(&socket, Duration::from_secs(15))
        .map_err(|error| format!("SSH TCP 连接失败：{error}"))?;
    tcp.set_read_timeout(Some(Duration::from_secs(20)))
        .map_err(|error| error.to_string())?;
    tcp.set_write_timeout(Some(Duration::from_secs(20)))
        .map_err(|error| error.to_string())?;
    let mut session = Session::new().map_err(|error| format!("无法创建 SSH 会话：{error}"))?;
    session.set_tcp_stream(tcp);
    session.set_timeout(20_000);
    session
        .handshake()
        .map_err(|error| format!("SSH 握手失败：{error}"))?;
    libssh_host_key_fingerprint(&session)
}

pub(crate) fn ensure_active(operation: Option<&RemoteOperationGuard>) -> Result<(), String> {
    if operation.is_some_and(RemoteOperationGuard::is_cancelled) {
        return Err("操作已取消".into());
    }
    Ok(())
}

fn session_transport(
    host: &str,
    port: u16,
    expected_host_key_fingerprint: Option<&str>,
    operation: Option<&RemoteOperationGuard>,
) -> Result<Session, String> {
    ensure_active(operation)?;
    let socket = remote_socket(host, port)?;
    let tcp = TcpStream::connect_timeout(&socket, Duration::from_secs(15))
        .map_err(|error| format!("SSH TCP 连接失败：{error}"))?;
    ensure_active(operation)?;
    tcp.set_read_timeout(Some(Duration::from_secs(20)))
        .map_err(|error| error.to_string())?;
    tcp.set_write_timeout(Some(Duration::from_secs(20)))
        .map_err(|error| error.to_string())?;
    let mut session = Session::new().map_err(|error| format!("无法创建 SSH 会话：{error}"))?;
    session.set_tcp_stream(tcp);
    session.set_timeout(20_000);
    session
        .handshake()
        .map_err(|error| format!("SSH 握手失败：{error}"))?;
    ensure_active(operation)?;
    let fingerprint = libssh_host_key_fingerprint(&session)?;
    if let Some(expected) = expected_host_key_fingerprint {
        if expected != fingerprint {
            return Err(format!(
                "SSH 主机指纹不匹配：预期 {expected}，实际 {fingerprint}"
            ));
        }
    }
    Ok(session)
}

fn userauth_ssh_agent(session: &Session, username: &str) -> Result<(), String> {
    let mut agent = session.agent().map_err(|error| error.to_string())?;
    agent.connect().map_err(|error| error.to_string())?;
    agent.list_identities().map_err(|error| error.to_string())?;
    let identities = agent.identities().map_err(|error| error.to_string())?;
    if identities.is_empty() {
        return Err("SSH Agent 中没有可用身份".into());
    }
    let mut last_error = String::new();
    for identity in identities {
        match agent.userauth(username, &identity) {
            Ok(()) if session.authenticated() => return Ok(()),
            Ok(()) => last_error = "SSH Agent 身份未获服务器接受".into(),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(if last_error.is_empty() {
        "SSH Agent 身份认证失败".into()
    } else {
        last_error
    })
}

fn session_once(
    server: &RemoteServer,
    operation: Option<&RemoteOperationGuard>,
) -> Result<Session, String> {
    let session = session_transport(
        &server.host,
        server.port,
        server.host_key_fingerprint.as_deref(),
        operation,
    )?;

    if server.auth_type == "password" {
        let password = remote_server_entry(&server.id)?
            .get_password()
            .map_err(|_| "未找到服务器密码".to_string())?;
        session
            .userauth_password(&server.username, &password)
            .map_err(|error| format!("SSH 密码认证失败：{error}"))?;
    } else {
        let private_key = server
            .private_key_path
            .as_deref()
            .ok_or("未找到 SSH 密钥")?;
        let passphrase = remote_key_passphrase_entry(&server.id)
            .ok()
            .and_then(|entry| entry.get_password().ok());
        let file_auth = if private_key.contains("-----BEGIN") {
            let mut key_file = tempfile::NamedTempFile::new().map_err(|error| error.to_string())?;
            key_file
                .write_all(private_key.as_bytes())
                .map_err(|error| error.to_string())?;
            session.userauth_pubkey_file(
                &server.username,
                None,
                key_file.path(),
                passphrase.as_deref(),
            )
        } else {
            session.userauth_pubkey_file(
                &server.username,
                None,
                Path::new(private_key),
                passphrase.as_deref(),
            )
        };
        if let Err(file_error) = file_auth {
            if let Err(agent_error) = userauth_ssh_agent(&session, &server.username) {
                return Err(format!("SSH 私钥认证失败。文件密钥: {file_error}; SSH Agent 回退: {agent_error}。请将 ED25519 密钥加入 Windows OpenSSH Agent，或使用 PEM/RSA 密钥。"));
            }
        }
    }

    ensure_active(operation)?;
    if session.authenticated() {
        Ok(session)
    } else {
        Err("SSH 身份验证失败".into())
    }
}

pub(crate) fn session(
    server: &RemoteServer,
    operation: Option<&RemoteOperationGuard>,
) -> Result<RemoteSession, String> {
    let mut last_error = String::new();
    for attempt in 0..2 {
        ensure_active(operation)?;
        match session_once(server, operation) {
            Ok(session) => return Ok(RemoteSession::Libssh(session)),
            Err(error) => {
                last_error = error;
                if attempt == 0 {
                    std::thread::sleep(Duration::from_millis(350));
                }
            }
        }
    }
    #[cfg(windows)]
    if server.auth_type == "key" {
        // A persisted fingerprint has already been checked by the libssh2
        // probe, so stale user known-hosts entries must not block the fallback.
        let use_known_hosts = server.host_key_fingerprint.is_none();
        return system_ssh_session(server, operation, use_known_hosts).map_err(|fallback_error| {
            format!("{last_error}; Windows OpenSSH 回退失败：{fallback_error}")
        });
    }
    Err(last_error)
}

pub(crate) fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn libssh_command(session: &Session, command: &str) -> Result<(i32, String), String> {
    let mut channel = session
        .channel_session()
        .map_err(|error| error.to_string())?;
    channel.exec(command).map_err(|error| error.to_string())?;
    channel.send_eof().map_err(|error| error.to_string())?;
    let mut output = String::new();
    channel
        .read_to_string(&mut output)
        .map_err(|error| error.to_string())?;
    channel.wait_close().map_err(|error| error.to_string())?;
    Ok((
        channel.exit_status().map_err(|error| error.to_string())?,
        output,
    ))
}

fn command_with_install_log(
    session: &RemoteSession,
    command: &str,
    logger: Option<&RemoteCodexInstallLogger>,
    log_phase: &str,
) -> Result<(i32, String), String> {
    match session {
        RemoteSession::Libssh(session) => {
            let result = libssh_command(session, command)?;
            if let Some(logger) = logger {
                logger.output(log_phase, &result.1);
            }
            Ok(result)
        }
        #[cfg(windows)]
        RemoteSession::OpenSsh(server) => system_ssh_with_host_key_policy(
            server,
            command,
            Duration::from_secs(300),
            server.host_key_fingerprint.is_none(),
            logger,
            log_phase,
        ),
    }
}

pub(crate) fn command(session: &RemoteSession, command: &str) -> Result<(i32, String), String> {
    command_with_install_log(session, command, None, "command")
}

fn password_session(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
    expected_host_key_fingerprint: Option<&str>,
) -> Result<Session, String> {
    let session = session_transport(host, port, expected_host_key_fingerprint, None)?;
    session
        .userauth_password(username, password)
        .map_err(|error| format!("SSH 密码认证失败：{error}"))?;
    if session.authenticated() {
        Ok(session)
    } else {
        Err("SSH 身份验证失败".into())
    }
}

fn private_key_session(
    host: &str,
    port: u16,
    username: &str,
    private_key_path: &Path,
    expected_host_key_fingerprint: Option<&str>,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        // libssh2 bundled with the Windows build cannot reliably parse every
        // OpenSSH ED25519 private-key format. Reuse the same OpenSSH client
        // used by the normal Windows key-auth fallback for this verification.
        let server = RemoteServer {
            id: "relayhub-generated-key-validation".into(),
            name: host.into(),
            host: host.into(),
            port,
            username: username.into(),
            auth_type: "key".into(),
            private_key_path: Some(private_key_path.to_string_lossy().into_owned()),
            codex_version: None,
            codex_latest_version: None,
            codex_update_available: false,
            host_key_fingerprint: expected_host_key_fingerprint.map(str::to_string),
            relay_url: None,
            relay_provider: None,
            relay_key_source: None,
            relay_key_masked: None,
            relay_config_fingerprint: None,
            connection_status: "warning".into(),
            connection_error: None,
            last_synced_at: None,
            last_sync_status: None,
            last_sync_error: None,
            updated_at: now(),
        };
        return system_ssh_session(&server, None, false)
            .map(|_| ())
            .map_err(|error| {
                format!("生成的 SSH 私钥认证失败：Windows OpenSSH 验证失败：{error}")
            });
    }

    #[cfg(not(windows))]
    {
        let session = session_transport(host, port, expected_host_key_fingerprint, None)?;
        session
            .userauth_pubkey_file(username, None, private_key_path, None)
            .map_err(|error| format!("生成的 SSH 私钥认证失败：{error}"))?;
        if session.authenticated() {
            Ok(())
        } else {
            Err("生成的 SSH 私钥未获服务器接受".into())
        }
    }
}

fn local_ssh_directory() -> Result<PathBuf, String> {
    let home = std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .ok_or("无法确定本机用户目录")?;
    Ok(PathBuf::from(home).join(".ssh"))
}

fn safe_key_component(host: &str) -> String {
    let component: String = host
        .chars()
        .filter(|character| {
            character.is_ascii_alphanumeric() || matches!(*character, '-' | '_' | '.')
        })
        .take(64)
        .collect();
    if component.is_empty() {
        "server".into()
    } else {
        component
    }
}

fn remove_generated_keypair(private_key_path: &Path, public_key_path: &Path) {
    let _ = fs::remove_file(private_key_path);
    let _ = fs::remove_file(public_key_path);
}

fn generate_local_keypair(host: &str) -> Result<(PathBuf, PathBuf, String), String> {
    let directory = local_ssh_directory()?;
    fs::create_dir_all(&directory).map_err(|error| format!("无法创建本机 SSH 目录：{error}"))?;

    let key_id = Uuid::new_v4().simple().to_string();
    let filename = format!(
        "relayhub_{}_{}_ed25519",
        safe_key_component(host),
        &key_id[..8]
    );
    let private_key_path = directory.join(filename);
    let public_key_path = PathBuf::from(format!("{}.pub", private_key_path.display()));
    let comment = format!("relayhub-{key_id}");
    let output = Command::new("ssh-keygen")
        .arg("-q")
        .arg("-t")
        .arg("ed25519")
        .arg("-N")
        .arg("")
        .arg("-C")
        .arg(comment)
        .arg("-f")
        .arg(&private_key_path)
        .output()
        .map_err(|error| format!("本机未找到 ssh-keygen，请先安装 OpenSSH 客户端：{error}"))?;
    if !output.status.success() {
        remove_generated_keypair(&private_key_path, &public_key_path);
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "本地 SSH 密钥生成失败".into()
        } else {
            format!("本地 SSH 密钥生成失败：{detail}")
        });
    }
    if !private_key_path.is_file() || !public_key_path.is_file() {
        remove_generated_keypair(&private_key_path, &public_key_path);
        return Err("本地 SSH 密钥生成失败：未找到生成的密钥文件".into());
    }

    let public_key = fs::read_to_string(&public_key_path)
        .map_err(|error| format!("无法读取本地 SSH 公钥：{error}"))?;
    let public_key = public_key.trim();
    if public_key.is_empty()
        || public_key.lines().count() != 1
        || !public_key.starts_with("ssh-ed25519 ")
    {
        remove_generated_keypair(&private_key_path, &public_key_path);
        return Err("本地 SSH 公钥格式无效".into());
    }
    Ok((private_key_path, public_key_path, public_key.to_string()))
}

fn install_public_key(
    session: &RemoteSession,
    remote_home: &str,
    public_key: &str,
) -> Result<(), String> {
    let ssh_directory = format!("{remote_home}/.ssh");
    let authorized_keys = format!("{ssh_directory}/authorized_keys");
    let public_key = public_key.trim();
    let script = format!(
        "set -eu\nmkdir -p -- {ssh_directory}\nchmod 700 -- {ssh_directory}\ntouch -- {authorized_keys}\nchmod 600 -- {authorized_keys}\nif ! grep -Fqx -- {public_key} {authorized_keys}; then\n  printf '%s\\n' {public_key} >> {authorized_keys}\nfi\nchmod 600 -- {authorized_keys}\n",
        ssh_directory = shell_quote(&ssh_directory),
        authorized_keys = shell_quote(&authorized_keys),
        public_key = shell_quote(public_key),
    );
    let (status, output) = command(session, &script)?;
    if status == 0 {
        Ok(())
    } else {
        Err(format!("无法把 SSH 公钥写入服务器：{}", output.trim()))
    }
}

fn remove_public_key(
    session: &RemoteSession,
    remote_home: &str,
    public_key: &str,
) -> Result<(), String> {
    let authorized_keys = format!("{remote_home}/.ssh/authorized_keys");
    let temporary = format!("{authorized_keys}.relayhub-{}.tmp", Uuid::new_v4());
    let script = format!(
        "set -eu\nif [ -f {authorized_keys} ]; then\n  grep -Fvx -- {public_key} {authorized_keys} > {temporary} || true\n  chmod 600 -- {temporary}\n  mv -f -- {temporary} {authorized_keys}\nfi\n",
        authorized_keys = shell_quote(&authorized_keys),
        public_key = shell_quote(public_key.trim()),
        temporary = shell_quote(&temporary),
    );
    let (status, output) = command(session, &script)?;
    if status == 0 {
        Ok(())
    } else {
        Err(format!(
            "无法回滚服务器上的临时 SSH 公钥：{}",
            output.trim()
        ))
    }
}

fn key_generation_failure(
    reason: String,
    host_key_fingerprint: Option<String>,
) -> GenerateSshKeyResult {
    GenerateSshKeyResult {
        private_key_path: None,
        public_key_path: None,
        connection: RemoteConnectionResult {
            success: false,
            status: "error".into(),
            code: None,
            reason: Some(reason),
            host_key_fingerprint,
            requires_host_key_confirmation: false,
        },
    }
}

pub(crate) fn generate_ssh_key(
    request: GenerateSshKeyRequest,
) -> Result<GenerateSshKeyResult, String> {
    let host = request.host.trim();
    let username = request.username.trim();
    if host.is_empty() || username.is_empty() {
        return Err("请先填写服务器主机和用户名".into());
    }
    if request.port == 0 {
        return Err("SSH 端口必须介于 1 和 65535 之间".into());
    }
    if request.password.is_empty() {
        return Err("请先输入服务器密码".into());
    }

    let expected_fingerprint = request
        .host_key_fingerprint
        .as_deref()
        .filter(|value| !value.trim().is_empty());
    let session = match password_session(
        host,
        request.port,
        username,
        &request.password,
        expected_fingerprint,
    ) {
        Ok(session) => session,
        Err(reason) => return Ok(key_generation_failure(reason, None)),
    };
    let observed_fingerprint = libssh_host_key_fingerprint(&session)?;
    if expected_fingerprint.is_none() {
        return Ok(GenerateSshKeyResult {
            private_key_path: None,
            public_key_path: None,
            connection: RemoteConnectionResult {
                success: false,
                status: "warning".into(),
                code: None,
                reason: Some("请先确认 SSH 主机指纹后再生成密钥".into()),
                host_key_fingerprint: Some(observed_fingerprint),
                requires_host_key_confirmation: true,
            },
        });
    }

    let remote_session = RemoteSession::Libssh(session);
    let remote_home = home(&remote_session)?;
    let (private_key_path, public_key_path, public_key) = match generate_local_keypair(host) {
        Ok(keypair) => keypair,
        Err(reason) => {
            return Ok(key_generation_failure(
                reason,
                expected_fingerprint.map(str::to_string),
            ))
        }
    };
    if let Err(reason) = install_public_key(&remote_session, &remote_home, &public_key) {
        remove_generated_keypair(&private_key_path, &public_key_path);
        return Ok(key_generation_failure(
            reason,
            expected_fingerprint.map(str::to_string),
        ));
    }

    if let Err(reason) = private_key_session(
        host,
        request.port,
        username,
        &private_key_path,
        expected_fingerprint,
    ) {
        let _ = remove_public_key(&remote_session, &remote_home, &public_key);
        remove_generated_keypair(&private_key_path, &public_key_path);
        return Ok(key_generation_failure(
            reason,
            expected_fingerprint.map(str::to_string),
        ));
    }

    Ok(GenerateSshKeyResult {
        private_key_path: Some(private_key_path.to_string_lossy().into_owned()),
        public_key_path: Some(public_key_path.to_string_lossy().into_owned()),
        connection: RemoteConnectionResult {
            success: true,
            status: "online".into(),
            code: None,
            reason: None,
            host_key_fingerprint: expected_fingerprint.map(str::to_string),
            requires_host_key_confirmation: false,
        },
    })
}

pub(crate) fn home(session: &RemoteSession) -> Result<String, String> {
    let (status, output) = command(
        session,
        r#"home="${HOME:-}"; if [ -z "$home" ] && command -v getent >/dev/null 2>&1; then home="$(getent passwd "$(id -un)" | cut -d: -f6)"; fi; if [ -z "$home" ]; then home="$PWD"; fi; printf 'RELAYHUB_HOME:%s\n' "$home""#,
    )?;
    let home = output
        .lines()
        .filter_map(|line| line.trim().strip_prefix("RELAYHUB_HOME:"))
        .map(str::trim)
        .find(|value| !value.is_empty());
    if status != 0 {
        return Err(format!("无法确定服务器用户目录，远程命令退出码 {status}"));
    }
    home.map(str::to_string)
        .ok_or_else(|| "无法确定服务器用户目录：远程未返回有效路径".into())
}

pub(crate) fn read_file(session: &RemoteSession, path: &str) -> Result<Option<String>, String> {
    let (status, content) = command(
        session,
        &format!(
            "if [ -e {path} ]; then cat -- {path}; else exit 44; fi",
            path = shell_quote(path)
        ),
    )?;
    match status {
        0 => Ok(Some(content)),
        44 => Ok(None),
        _ => Err(format!("无法读取服务器文件：{path}")),
    }
}

pub(crate) fn write_file(session: &RemoteSession, path: &str, content: &str) -> Result<(), String> {
    let directory = Path::new(path)
        .parent()
        .ok_or("无效的服务器文件路径")?
        .to_string_lossy();
    let temporary = format!("{path}.relayhub-{}.tmp", Uuid::new_v4());
    #[cfg(windows)]
    if let RemoteSession::OpenSsh(server) = session {
        let script = format!(
            "set -eu\nmkdir -p -- {directory}\nchmod 700 -- {directory}\nbase64 -d > {temporary} <<'RELAYHUB_CONTENT'\n{}\nRELAYHUB_CONTENT\nchmod 600 -- {temporary}\nmv -f -- {temporary} {path}\nchmod 600 -- {path}\n",
            base64_encode(content.as_bytes()),
            directory = shell_quote(&directory),
            temporary = shell_quote(&temporary),
            path = shell_quote(path),
        );
        let (status, output) = system_ssh_with_host_key_policy(
            server,
            &script,
            Duration::from_secs(30),
            server.host_key_fingerprint.is_none(),
            None,
            "command",
        )?;
        return if status == 0 {
            Ok(())
        } else {
            Err(format!("写入远程配置文件失败：{}", output.trim()))
        };
    }
    let RemoteSession::Libssh(session) = session else {
        unreachable!("all RemoteSession variants are handled above");
    };
    let mut channel = session
        .channel_session()
        .map_err(|error| error.to_string())?;
    channel
        .exec(&format!(
            "mkdir -p -- {directory} && chmod 700 -- {directory}",
            directory = shell_quote(&directory)
        ))
        .map_err(|error| error.to_string())?;
    channel.send_eof().map_err(|error| error.to_string())?;
    channel.wait_close().map_err(|error| error.to_string())?;
    let status = channel.exit_status().map_err(|error| error.to_string())?;
    if status != 0 {
        return Err("无法创建服务器 Codex 配置目录".into());
    }
    let sftp = session.sftp().map_err(|error| error.to_string())?;
    {
        let mut file = sftp
            .create(Path::new(&temporary))
            .map_err(|error| format!("创建远端临时文件失败 ({temporary}): {error}"))?;
        file.write_all(content.as_bytes())
            .map_err(|error| format!("写入远端临时文件失败 ({temporary}): {error}"))?;
        file.flush()
            .map_err(|error| format!("刷新远端临时文件失败 ({temporary}): {error}"))?;
    }
    if let Err(sftp_error) = sftp.rename(
        Path::new(&temporary),
        Path::new(path),
        Some(ssh2::RenameFlags::OVERWRITE),
    ) {
        let (status, output) = libssh_command(
            session,
            &format!("mv -f -- {} {}", shell_quote(&temporary), shell_quote(path)),
        )?;
        if status != 0 {
            return Err(format!(
                "原子替换远端文件失败 ({path}): {sftp_error}; mv: {}",
                output.trim()
            ));
        }
    }
    let (status, _) = libssh_command(session, &format!("chmod 600 -- {}", shell_quote(path)))?;
    if status != 0 {
        return Err(format!("无法设置服务器文件权限：{path}"));
    }
    Ok(())
}

pub(crate) fn restore_file(
    session: &RemoteSession,
    path: &str,
    original: Option<&str>,
) -> Result<(), String> {
    match original {
        Some(content) => write_file(session, path, content),
        None => {
            let (status, _) = command(session, &format!("rm -f -- {}", shell_quote(path)))?;
            if status == 0 {
                Ok(())
            } else {
                Err(format!("无法删除服务器文件：{path}"))
            }
        }
    }
}

fn codex_config_state(
    session: &RemoteSession,
    home: &str,
) -> Result<RemoteCodexConfigState, String> {
    let config = read_file(session, &format!("{home}/.codex/config.toml"))?;
    let auth = read_file(session, &format!("{home}/.codex/auth.json"))?;
    let relay_env = read_file(session, &format!("{home}/.codex/relayhub.env"))?;
    let bashrc = read_file(session, &format!("{home}/.bashrc"))?;
    let host_key_fingerprint = host_key_fingerprint(session)?;
    let config_fingerprint = config_fingerprint(config.as_deref(), auth.as_deref());
    let state_fingerprint = rollback_state_fingerprint(
        config.as_deref(),
        auth.as_deref(),
        relay_env.as_deref(),
        bashrc.as_deref(),
    );
    Ok(RemoteCodexConfigState {
        host_key_fingerprint,
        config,
        auth,
        relay_env,
        bashrc,
        config_fingerprint,
        state_fingerprint,
    })
}

/// Captures raw remote configuration before a relay change. The caller must
/// keep this only in the OS credential store because `auth` may contain keys.
pub(crate) fn capture_codex_config_state(
    server: &RemoteServer,
    operation: Option<&RemoteOperationGuard>,
) -> Result<RemoteCodexConfigState, String> {
    ensure_active(operation)?;
    let session = session(server, operation)?;
    let home = home(&session)?;
    ensure_active(operation)?;
    codex_config_state(&session, &home)
}

/// Restores the exact files captured before a relay change. Refuse to write
/// when either the SSH host key or any affected file changed since the relay
/// was applied, so history rollback cannot clobber external edits.
pub(crate) fn restore_codex_config_state(
    server: &RemoteServer,
    original: &RemoteCodexConfigState,
    expected_current_state_fingerprint: &str,
    operation: Option<&RemoteOperationGuard>,
) -> Result<RemoteCodexSnapshot, String> {
    ensure_active(operation)?;
    let session = session(server, operation)?;
    let home = home(&session)?;
    let current = codex_config_state(&session, &home)?;
    if current.host_key_fingerprint != original.host_key_fingerprint {
        return Err(
            "The remote SSH host key changed since this rollback snapshot was created".into(),
        );
    }
    if current.state_fingerprint != expected_current_state_fingerprint {
        return Err("The remote Codex configuration changed after this relay was applied. Refresh and resolve the change before rolling back.".into());
    }
    ensure_active(operation)?;
    restore_file(
        &session,
        &format!("{home}/.codex/config.toml"),
        original.config.as_deref(),
    )?;
    ensure_active(operation)?;
    restore_file(
        &session,
        &format!("{home}/.codex/auth.json"),
        original.auth.as_deref(),
    )?;
    ensure_active(operation)?;
    restore_file(
        &session,
        &format!("{home}/.codex/relayhub.env"),
        original.relay_env.as_deref(),
    )?;
    ensure_active(operation)?;
    restore_file(
        &session,
        &format!("{home}/.bashrc"),
        original.bashrc.as_deref(),
    )?;
    ensure_active(operation)?;
    fetch_codex_relay_config(server, operation)
}

pub(crate) fn fetch_codex_relay_config(
    server: &RemoteServer,
    operation: Option<&RemoteOperationGuard>,
) -> Result<RemoteCodexSnapshot, String> {
    ensure_active(operation)?;
    let session = session(server, operation)?;
    let host_key_fingerprint = host_key_fingerprint(&session)?;
    let home = home(&session)?;
    let config = read_file(&session, &format!("{home}/.codex/config.toml"))?;
    let auth = read_file(&session, &format!("{home}/.codex/auth.json"))?;
    ensure_active(operation)?;
    let relay = config.as_deref().and_then(|config| {
        codex_relay_config(
            config,
            auth.as_deref().unwrap_or_default(),
            &HashMap::new(),
            server.relay_provider.as_deref(),
        )
    });
    ensure_active(operation)?;
    let codex_version = command(&session, "codex --version 2>/dev/null")
        .ok()
        .and_then(|(status, output)| (status == 0).then(|| output.trim().to_string()))
        .filter(|version| !version.is_empty());
    let codex_latest_version = codex_version
        .as_ref()
        .and_then(|_| command(&session, "command -v npm >/dev/null 2>&1 && npm view @openai/codex version --silent 2>/dev/null").ok())
        .and_then(|(status, output)| (status == 0).then(|| output.trim().to_string()))
        .filter(|version| !version.is_empty());
    Ok(RemoteCodexSnapshot {
        relay,
        codex_update_available: codex_update_available(
            codex_version.as_deref(),
            codex_latest_version.as_deref(),
        ),
        codex_version,
        codex_latest_version,
        host_key_fingerprint,
        config_fingerprint: config_fingerprint(config.as_deref(), auth.as_deref()),
    })
}

pub(crate) fn write_codex_relay_config(
    server: &RemoteServer,
    relay_url: &str,
    relay_key: &str,
    operation: Option<&RemoteOperationGuard>,
) -> Result<RemoteCodexSnapshot, String> {
    ensure_active(operation)?;
    let session = session(server, operation)?;
    let home = home(&session)?;
    ensure_active(operation)?;
    let config_path = format!("{home}/.codex/config.toml");
    let auth_path = format!("{home}/.codex/auth.json");
    let env_path = format!("{home}/.codex/relayhub.env");
    let bashrc_path = format!("{home}/.bashrc");
    let original_config = read_file(&session, &config_path)?;
    let original_auth = read_file(&session, &auth_path)?;
    let original_env = read_file(&session, &env_path)?;
    let original_bashrc = read_file(&session, &bashrc_path)?;
    ensure_active(operation)?;
    let original_fingerprint =
        config_fingerprint(original_config.as_deref(), original_auth.as_deref());
    if let Some(expected) = &server.relay_config_fingerprint {
        if expected != &original_fingerprint {
            return Err("远端 Codex 配置已在上次读取后变更，请先测试连接刷新配置再同步".into());
        }
    }

    let (next_config, provider_name) = patch_codex_config(
        original_config.as_deref().unwrap_or_default(),
        server.relay_provider.as_deref(),
        relay_url,
        relay_key,
    )?;

    let auth = original_auth.as_deref().unwrap_or("{}");
    let mut auth = if auth.trim().is_empty() {
        Value::Object(Default::default())
    } else {
        serde_json::from_str::<Value>(auth)
            .map_err(|_| "服务器 Codex auth.json 格式无效".to_string())?
    };
    let auth = auth
        .as_object_mut()
        .ok_or("服务器 Codex auth.json 根节点必须是对象")?;
    auth.insert(
        "OPENAI_API_KEY".into(),
        Value::String(relay_key.to_string()),
    );
    let next_auth = serde_json::to_string_pretty(&auth).map_err(|error| error.to_string())?;
    let next_bashrc = remove_bashrc_relay_source(original_bashrc.as_deref());

    let result = (|| -> Result<RemoteCodexSnapshot, String> {
        ensure_active(operation)?;
        write_file(&session, &config_path, &next_config)?;
        ensure_active(operation)?;
        write_file(&session, &auth_path, &next_auth)?;
        ensure_active(operation)?;
        restore_file(&session, &env_path, None)?;
        if let Some(next_bashrc) = &next_bashrc {
            ensure_active(operation)?;
            write_file(&session, &bashrc_path, next_bashrc)?;
        }
        ensure_active(operation)?;
        let snapshot = fetch_codex_relay_config(server, operation)?;
        let relay = snapshot
            .relay
            .as_ref()
            .ok_or("写入后未读取到完整 Codex 中转配置")?;
        if relay.url != relay_url || relay.key != relay_key || relay.provider != provider_name {
            return Err("写入后的 Codex 中转配置与预期不一致".into());
        }
        Ok(snapshot)
    })();
    if let Err(error) = result {
        let rollback = restore_file(&session, &config_path, original_config.as_deref())
            .and_then(|_| restore_file(&session, &auth_path, original_auth.as_deref()))
            .and_then(|_| restore_file(&session, &env_path, original_env.as_deref()))
            .and_then(|_| restore_file(&session, &bashrc_path, original_bashrc.as_deref()));
        return Err(match rollback {
            Ok(()) => format!("同步失败，已恢复远端配置：{error}"),
            Err(rollback) => format!("同步失败且恢复远端配置失败：{error}；{rollback}"),
        });
    }
    result
}

fn install_or_update_codex(
    server: &RemoteServer,
    operation: Option<&RemoteOperationGuard>,
    logger: Option<&RemoteCodexInstallLogger>,
) -> Result<RemoteCodexSnapshot, String> {
    ensure_active(operation)?;
    if let Some(logger) = logger {
        logger.info("connecting", "正在连接远程服务器");
    }
    let mut session = session(server, operation)?;
    session.set_timeout(180_000);
    if let Some(logger) = logger {
        logger.info("preparing", "正在检查 Node.js 和 npm 环境");
    }
    let bootstrap = "if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then if ! command -v apt-get >/dev/null 2>&1; then echo 'Node.js/npm is missing and this server does not provide apt-get'; exit 126; fi; if [ \"$(id -u)\" -eq 0 ]; then apt-get update && apt-get install -y nodejs npm; elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then sudo -n apt-get update && sudo -n apt-get install -y nodejs npm; else echo 'Node.js/npm is missing; log in as root or grant passwordless sudo for apt-get'; exit 126; fi; fi; node --version && npm --version";
    let (status, output) = command_with_install_log(
        &session,
        &format!("timeout 240 sh -c {} 2>&1", shell_quote(bootstrap)),
        logger,
        "preparing",
    )?;
    ensure_active(operation)?;
    if status != 0 {
        let detail = output.trim();
        return Err(if detail.is_empty() {
            format!("Node.js/npm 准备失败，退出码 {status}")
        } else {
            format!("Node.js/npm 准备失败：{detail}")
        });
    }
    if let Some(logger) = logger {
        logger.info("installing", "正在安装 Codex CLI");
    }
    let (status, output) = command_with_install_log(
        &session,
        "timeout 240 env NPM_CONFIG_FETCH_TIMEOUT=60000 NPM_CONFIG_FETCH_RETRIES=2 npm install -g @openai/codex@latest --no-audit --no-fund 2>&1",
        logger,
        "installing",
    )?;
    ensure_active(operation)?;
    if status != 0 {
        let detail = output.trim();
        return Err(if detail.is_empty() {
            format!("Codex 安装失败，退出码 {status}")
        } else {
            format!("Codex 安装失败：{detail}")
        });
    }
    if let Some(logger) = logger {
        logger.info("verifying", "正在校验 Codex CLI 版本");
    }
    let snapshot = fetch_codex_relay_config(server, operation)?;
    if snapshot.codex_version.is_none() {
        return Err(
            "npm 已完成，但当前 SSH 环境仍无法执行 codex；请确认 npm 全局 bin 目录已在 PATH 中"
                .into(),
        );
    }
    Ok(snapshot)
}

pub(crate) fn test_and_read_server(
    server: &RemoteServer,
    operation: Option<&RemoteOperationGuard>,
) -> (RemoteConnectionResult, Option<RemoteCodexSnapshot>) {
    match fetch_codex_relay_config(server, operation) {
        Ok(snapshot) => (
            RemoteConnectionResult {
                success: true,
                status: "online".into(),
                code: None,
                reason: None,
                host_key_fingerprint: Some(snapshot.host_key_fingerprint.clone()),
                requires_host_key_confirmation: false,
            },
            Some(snapshot),
        ),
        Err(reason) => (
            RemoteConnectionResult {
                success: false,
                status: "error".into(),
                code: None,
                reason: Some(reason),
                host_key_fingerprint: None,
                requires_host_key_confirmation: false,
            },
            None,
        ),
    }
}

pub(crate) fn verify_codex_session(
    server: &RemoteServer,
    operation: Option<&RemoteOperationGuard>,
) -> RemoteConnectionResult {
    let result = (|| -> Result<(), String> {
        ensure_active(operation)?;
        let mut session = session(server, operation)?;
        session.set_timeout(120_000);
        let prompt = "Reply with exactly RELAYHUB_SESSION_OK and no other text.";
        let command_to_run = format!(
            "exec timeout 90 codex exec --skip-git-repo-check {} 2>&1",
            shell_quote(prompt)
        );
        let (status, output) = command(
            &session,
            &format!("bash -lc {}", shell_quote(&command_to_run)),
        )?;
        if status != 0 {
            return Err(if status == 124 {
                "Codex CLI 会话验证超时".into()
            } else {
                "Codex CLI 会话验证失败".into()
            });
        }
        if !output.contains("RELAYHUB_SESSION_OK") {
            return Err("Codex CLI 未返回预期会话响应".into());
        }
        Ok(())
    })();
    match result {
        Ok(()) => RemoteConnectionResult {
            success: true,
            status: "online".into(),
            code: None,
            reason: None,
            host_key_fingerprint: server.host_key_fingerprint.clone(),
            requires_host_key_confirmation: false,
        },
        Err(reason) => RemoteConnectionResult {
            success: false,
            status: "error".into(),
            code: None,
            reason: Some(reason),
            host_key_fingerprint: server.host_key_fingerprint.clone(),
            requires_host_key_confirmation: false,
        },
    }
}

pub(crate) fn apply_relay_config(
    server: &mut RemoteServer,
    relay: CodexRelayConfig,
) -> Result<(), String> {
    remote_relay_key_entry(&server.id)?
        .set_password(&relay.key)
        .map_err(|error| error.to_string())?;
    server.relay_url = Some(relay.url);
    server.relay_provider = Some(relay.provider);
    server.relay_key_source = Some("Ubuntu Codex CLI".into());
    server.relay_key_masked = Some(mask_secret(&relay.key));
    Ok(())
}

pub(crate) fn apply_snapshot(
    server: &mut RemoteServer,
    snapshot: RemoteCodexSnapshot,
) -> Result<(), String> {
    server.host_key_fingerprint = Some(snapshot.host_key_fingerprint);
    server.relay_config_fingerprint = Some(snapshot.config_fingerprint);
    server.codex_version = snapshot.codex_version;
    server.codex_latest_version = snapshot.codex_latest_version;
    server.codex_update_available = snapshot.codex_update_available;
    server.last_synced_at = Some(now());
    match snapshot.relay {
        Some(relay) => {
            apply_relay_config(server, relay)?;
            server.last_sync_status = Some("synced".into());
            server.last_sync_error = None;
        }
        None => {
            server.last_sync_status = Some("partial".into());
            server.last_sync_error = Some("已连接服务器，但未读取到完整 Codex 中转配置".into());
        }
    }
    Ok(())
}

pub(crate) fn mask_secret(value: &str) -> String {
    if value.len() > 10 {
        format!("{}...{}", &value[..5], &value[value.len() - 4..])
    } else {
        "已安全保存".into()
    }
}

pub(crate) fn config_fingerprint(config: Option<&str>, auth: Option<&str>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(config.unwrap_or_default().as_bytes());
    hasher.update([0]);
    hasher.update(auth.unwrap_or_default().as_bytes());
    format!(
        "sha256:{}",
        hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}

fn rollback_state_fingerprint(
    config: Option<&str>,
    auth: Option<&str>,
    relay_env: Option<&str>,
    bashrc: Option<&str>,
) -> String {
    let mut hasher = Sha256::new();
    for value in [config, auth, relay_env, bashrc] {
        match value {
            Some(value) => {
                hasher.update([1]);
                hasher.update(value.as_bytes());
            }
            None => hasher.update([0]),
        }
        hasher.update([0xff]);
    }
    format!(
        "sha256:{}",
        hasher
            .finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    )
}

pub(crate) fn codex_update_available(installed: Option<&str>, latest: Option<&str>) -> bool {
    let (Some(installed), Some(latest)) = (
        installed.and_then(comparable_version),
        latest.and_then(comparable_version),
    ) else {
        return false;
    };
    let length = installed.len().max(latest.len());
    for index in 0..length {
        match installed
            .get(index)
            .copied()
            .unwrap_or(0)
            .cmp(&latest.get(index).copied().unwrap_or(0))
        {
            std::cmp::Ordering::Equal => continue,
            std::cmp::Ordering::Less => return true,
            std::cmp::Ordering::Greater => return false,
        }
    }
    false
}

fn comparable_version(value: &str) -> Option<Vec<u64>> {
    value
        .split(|character: char| !character.is_ascii_digit() && character != '.')
        .find(|part| {
            part.contains('.')
                && part
                    .chars()
                    .all(|character| character.is_ascii_digit() || character == '.')
        })?
        .split('.')
        .map(str::parse::<u64>)
        .collect::<Result<Vec<_>, _>>()
        .ok()
}

pub(crate) fn remove_bashrc_relay_source(content: Option<&str>) -> Option<String> {
    const START: &str = "# >>> RelayHub Codex >>>";
    const END: &str = "# <<< RelayHub Codex <<<";
    let current = content?;
    let (Some(start), Some(end)) = (current.find(START), current.find(END)) else {
        return None;
    };
    if end < start {
        return None;
    }
    Some(format!(
        "{}{}",
        &current[..start],
        &current[end + END.len()..]
    ))
}

pub(crate) fn patch_codex_config(
    config: &str,
    requested_provider: Option<&str>,
    relay_url: &str,
    relay_key: &str,
) -> Result<(String, String), String> {
    let mut document = if config.trim().is_empty() {
        DocumentMut::new()
    } else {
        config
            .parse::<DocumentMut>()
            .map_err(|_| "服务器 Codex config.toml 格式无效".to_string())?
    };
    let provider_name = requested_provider
        .filter(|name| !name.trim().is_empty())
        .map(str::to_string)
        .or_else(|| {
            let name = document.get("model_provider").and_then(Item::as_str)?;
            let providers = document.get("model_providers").and_then(Item::as_table)?;
            providers.contains_key(name).then(|| name.to_string())
        })
        .unwrap_or_else(|| "custom".into());
    document["model_provider"] = toml_value(provider_name.clone());
    if document.get("model_providers").is_none() {
        document["model_providers"] = Item::Table(Table::new());
    }
    let providers = document["model_providers"]
        .as_table_mut()
        .ok_or("服务器 Codex model_providers 必须是表")?;
    if !providers.contains_key(&provider_name) {
        providers.insert(&provider_name, Item::Table(Table::new()));
    }
    let provider = providers
        .get_mut(&provider_name)
        .and_then(Item::as_table_mut)
        .ok_or("服务器 Codex provider 必须是表")?;
    if provider
        .get("name")
        .and_then(Item::as_str)
        .is_none_or(|name| name.trim().is_empty())
    {
        provider["name"] = toml_value("RelayHub");
    }
    provider["base_url"] = toml_value(relay_url.trim());
    provider["wire_api"] = toml_value("responses");
    provider["requires_openai_auth"] = toml_value(true);
    provider["experimental_bearer_token"] = toml_value(relay_key);
    provider.remove("env_key");
    provider.remove("api_key");
    Ok((document.to_string(), provider_name))
}

pub(crate) fn codex_relay_config(
    config: &str,
    auth_json: &str,
    environment: &HashMap<String, String>,
    requested_provider: Option<&str>,
) -> Option<CodexRelayConfig> {
    let document = config.parse::<toml::Value>().ok()?;
    let root = document.as_table()?;
    let providers = root
        .get("model_providers")
        .and_then(toml::Value::as_table)?;
    let provider_name = requested_provider
        .filter(|name| providers.contains_key(*name))
        .or_else(|| {
            root.get("model_provider")
                .and_then(toml::Value::as_str)
                .filter(|name| providers.contains_key(*name))
        })
        .or_else(|| {
            providers.iter().find_map(|(name, value)| {
                value
                    .get("base_url")
                    .and_then(toml::Value::as_str)
                    .is_some()
                    .then_some(name.as_str())
            })
        })?;
    let provider = providers.get(provider_name)?.as_table()?;
    let url = provider
        .get("base_url")
        .and_then(toml::Value::as_str)?
        .trim();
    if url.is_empty() {
        return None;
    }
    let env_key = provider
        .get("env_key")
        .and_then(toml::Value::as_str)
        .unwrap_or("OPENAI_API_KEY");
    let key = provider
        .get("experimental_bearer_token")
        .and_then(toml::Value::as_str)
        .filter(|key| !key.starts_with('$'))
        .map(str::to_string)
        .or_else(|| {
            provider
                .get("api_key")
                .and_then(toml::Value::as_str)
                .filter(|key| !key.starts_with('$'))
                .map(str::to_string)
        })
        .or_else(|| environment.get(env_key).cloned())
        .or_else(|| auth_json_api_key(auth_json, env_key))
        .or_else(|| environment.get("OPENAI_API_KEY").cloned())?;
    (!key.trim().is_empty()).then(|| CodexRelayConfig {
        url: url.to_string(),
        key,
        provider: provider_name.to_string(),
    })
}

fn auth_json_api_key(auth_json: &str, env_key: &str) -> Option<String> {
    let auth = serde_json::from_str::<Value>(auth_json).ok()?;
    auth.get(env_key)
        .and_then(Value::as_str)
        .or_else(|| {
            auth.get("env")
                .and_then(|env| env.get(env_key))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            (env_key == "OPENAI_API_KEY")
                .then(|| auth.get("api_key"))
                .flatten()
                .and_then(Value::as_str)
        })
        .filter(|key| !key.trim().is_empty())
        .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::{
        codex_relay_config, codex_update_available, patch_codex_config, remove_bashrc_relay_source,
        rollback_state_fingerprint,
    };
    use crate::{
        audit_store::AuditStore,
        keyring_store::{remote_relay_key_entry, remote_server_entry},
        models::{RemoteServer, DEFAULT_SSH_PORT},
        remote_store::RemoteServerStore,
        remote_sync_logs::RemoteSyncLogStore,
        store::Store,
        support::{base, now},
    };
    use serde_json::Value;
    use uuid::Uuid;

    #[test]
    fn reads_codex_relay_provider_from_local_style_config() {
        let environment = HashMap::new();
        let relay = codex_relay_config(
            r#"
model_provider = "custom"

[model_providers.custom]
name = "RelayHub"
base_url = "https://relay.example.com"
wire_api = "responses"
requires_openai_auth = true
experimental_bearer_token = "sk-relay-config-token"
"#,
            r#"{"OPENAI_API_KEY":"sk-relay-auth-token"}"#,
            &environment,
            None,
        )
        .expect("relay configuration should be available");
        assert_eq!(relay.url, "https://relay.example.com");
        assert_eq!(relay.key, "sk-relay-config-token");
    }

    #[test]
    fn keeps_the_station_root_url_for_codex_relay() {
        assert_eq!(
            base("https://relay.example.com/"),
            "https://relay.example.com"
        );
        assert_eq!(
            base("https://relay.example.com/v1"),
            "https://relay.example.com/v1"
        );
    }

    #[test]
    fn removes_only_the_relayhub_bashrc_block() {
        let source = "before\n# >>> RelayHub Codex >>>\nsource relayhub.env\n# <<< RelayHub Codex <<<\nafter\n";
        assert_eq!(
            remove_bashrc_relay_source(Some(source)).as_deref(),
            Some("before\n\nafter\n")
        );
        assert_eq!(remove_bashrc_relay_source(Some("export PATH=/bin\n")), None);
    }

    #[test]
    fn patches_only_the_selected_codex_provider() {
        let source = "# keep this comment\nmodel_provider = \"custom\"\n\n[model_providers.custom]\nbase_url = \"https://old.example/v1\"\napi_key = \"$CUSTOM_KEY\"\n\n[model_providers.other]\nbase_url = \"https://other.example/v1\"\n";
        let (patched, provider) = patch_codex_config(
            source,
            Some("custom"),
            "https://new.example",
            "sk-relay-token",
        )
        .expect("config should be patchable");
        assert_eq!(provider, "custom");
        assert!(patched.contains("# keep this comment"));
        assert!(patched.contains("base_url = \"https://other.example/v1\""));
        assert!(patched.contains("base_url = \"https://new.example\""));
        assert!(patched.contains("name = \"RelayHub\""));
        assert!(patched.contains("wire_api = \"responses\""));
        assert!(patched.contains("requires_openai_auth = true"));
        assert!(patched.contains("experimental_bearer_token = \"sk-relay-token\""));
        assert!(!patched.contains("api_key = \"$CUSTOM_KEY\""));
        assert!(!patched.contains("env_key = \"OPENAI_API_KEY\""));
    }

    #[test]
    fn preserves_the_existing_codex_provider_without_an_explicit_provider() {
        let source = "model_provider = \"existing\"\n\n[model_providers.existing]\nbase_url = \"https://old.example\"\n";
        let (patched, provider) =
            patch_codex_config(source, None, "https://new.example", "sk-relay-token")
                .expect("config should be patchable");

        assert_eq!(provider, "existing");
        assert!(patched.contains("model_provider = \"existing\""));
        assert!(patched.contains("base_url = \"https://new.example\""));
    }

    #[test]
    fn identifies_codex_updates_from_semantic_versions() {
        assert!(codex_update_available(
            Some("codex-cli 0.92.1"),
            Some("0.93.0")
        ));
        assert!(!codex_update_available(
            Some("codex-cli 0.93.0"),
            Some("0.93.0")
        ));
        assert!(!codex_update_available(
            Some("codex-cli 1.0.0"),
            Some("0.99.9")
        ));
        assert!(!codex_update_available(Some("unknown"), Some("0.93.0")));
    }

    #[test]
    fn rollback_state_fingerprint_detects_missing_and_changed_files() {
        let original = rollback_state_fingerprint(
            None,
            Some("{\"OPENAI_API_KEY\":\"before\"}"),
            None,
            Some("export PATH=/usr/bin\n"),
        );
        assert_ne!(
            original,
            rollback_state_fingerprint(
                Some(""),
                Some("{\"OPENAI_API_KEY\":\"before\"}"),
                None,
                Some("export PATH=/usr/bin\n"),
            )
        );
        assert_ne!(
            original,
            rollback_state_fingerprint(
                None,
                Some("{\"OPENAI_API_KEY\":\"after\"}"),
                None,
                Some("export PATH=/usr/bin\n"),
            )
        );
    }

    #[test]
    #[ignore = "requires SSH host/username and either RELAYHUB_E2E_SSH_PASSWORD or RELAYHUB_E2E_SSH_KEY_PATH"]
    fn syncs_remote_codex_relay_configuration() {
        let password = std::env::var("RELAYHUB_E2E_SSH_PASSWORD")
            .ok()
            .filter(|value| !value.is_empty());
        let private_key_path = std::env::var("RELAYHUB_E2E_SSH_KEY_PATH")
            .ok()
            .filter(|value| !value.is_empty());
        if password.is_none() && private_key_path.is_none() {
            panic!("missing SSH password or key path");
        }
        let server = e2e_server(
            "relayhub-e2e",
            if password.is_some() {
                "password"
            } else {
                "key"
            },
            private_key_path,
        );
        if let Some(password) = password {
            remote_server_entry(&server.id)
                .unwrap()
                .set_password(&password)
                .unwrap();
        }

        let session =
            super::session(&server, None).expect("password SSH authentication should succeed");
        let home = super::home(&session).expect("remote home should be available");
        let config_path = format!("{home}/.codex/config.toml");
        let auth_path = format!("{home}/.codex/auth.json");
        let env_path = format!("{home}/.codex/relayhub.env");
        let bashrc_path = format!("{home}/.bashrc");
        let original_config =
            super::read_file(&session, &config_path).expect("config should be readable");
        let original_auth =
            super::read_file(&session, &auth_path).expect("auth should be readable");
        let original_env =
            super::read_file(&session, &env_path).expect("relay environment should be readable");
        let original_bashrc =
            super::read_file(&session, &bashrc_path).expect("bashrc should be readable");
        drop(session);

        let relay_url = format!("https://relayhub-e2e-{}.example/v1", Uuid::new_v4());
        let relay_key = format!("sk-relayhub-e2e-{}", Uuid::new_v4());
        let result = (|| -> Result<(), String> {
            super::write_codex_relay_config(&server, &relay_url, &relay_key, None)?;
            let relay = super::fetch_codex_relay_config(&server, None)?
                .relay
                .ok_or("写入后未读取到 Codex 中转配置")?;
            if relay.url != relay_url || relay.key != relay_key {
                return Err("写入后的 Codex 中转配置与预期不一致".into());
            }
            Ok(())
        })();

        let restore = (|| -> Result<(), String> {
            let session = super::session(&server, None)?;
            match original_config.as_deref() {
                Some(config) => super::write_file(&session, &config_path, config)?,
                None => {
                    super::command(
                        &session,
                        &format!("rm -f -- {}", super::shell_quote(&config_path)),
                    )?;
                }
            }
            match original_auth.as_deref() {
                Some(auth) => super::write_file(&session, &auth_path, auth)?,
                None => {
                    super::command(
                        &session,
                        &format!("rm -f -- {}", super::shell_quote(&auth_path)),
                    )?;
                }
            }
            super::restore_file(&session, &env_path, original_env.as_deref())?;
            super::restore_file(&session, &bashrc_path, original_bashrc.as_deref())?;
            if super::read_file(&session, &config_path)? != original_config
                || super::read_file(&session, &auth_path)? != original_auth
                || super::read_file(&session, &env_path)? != original_env
                || super::read_file(&session, &bashrc_path)? != original_bashrc
            {
                return Err("恢复后的 Codex 配置与原始内容不一致".into());
            }
            Ok(())
        })();
        delete_e2e_credentials(&server.id);
        restore.expect("original Codex configuration should be restored");
        result.expect("remote Codex relay sync should succeed");
    }

    #[test]
    #[ignore = "requires relay URL/key, SSH host/username, and either RELAYHUB_E2E_SSH_PASSWORD or RELAYHUB_E2E_SSH_KEY_PATH"]
    fn configures_remote_relay_and_runs_codex_session() {
        let password = std::env::var("RELAYHUB_E2E_SSH_PASSWORD")
            .ok()
            .filter(|value| !value.is_empty());
        let private_key_path = std::env::var("RELAYHUB_E2E_SSH_KEY_PATH")
            .ok()
            .filter(|value| !value.is_empty());
        if password.is_none() && private_key_path.is_none() {
            panic!("missing SSH password or key path");
        }
        let server = e2e_server(
            "relayhub-session",
            if password.is_some() {
                "password"
            } else {
                "key"
            },
            private_key_path,
        );
        let relay_url = std::env::var("RELAYHUB_E2E_RELAY_URL").expect("missing relay URL");
        let relay_key = std::env::var("RELAYHUB_E2E_RELAY_KEY").expect("missing relay key");
        if let Some(password) = &password {
            remote_server_entry(&server.id)
                .unwrap()
                .set_password(password)
                .unwrap();
        }
        let session = super::session(&server, None).expect("SSH authentication should succeed");
        let home = super::home(&session).expect("remote home should be available");
        let config_path = format!("{home}/.codex/config.toml");
        let auth_path = format!("{home}/.codex/auth.json");
        let env_path = format!("{home}/.codex/relayhub.env");
        let bashrc_path = format!("{home}/.bashrc");
        let original_config =
            super::read_file(&session, &config_path).expect("config should be readable");
        let original_auth =
            super::read_file(&session, &auth_path).expect("auth should be readable");
        let original_env =
            super::read_file(&session, &env_path).expect("relay environment should be readable");
        let original_bashrc =
            super::read_file(&session, &bashrc_path).expect("bashrc should be readable");
        drop(session);

        let result = (|| -> Result<(), String> {
            let snapshot = super::write_codex_relay_config(&server, &relay_url, &relay_key, None)?;
            let relay = snapshot.relay.ok_or("写入后未读取到完整 Codex 中转配置")?;
            if relay.url != relay_url || relay.key != relay_key {
                return Err("远端 Codex 中转配置与预期不一致".into());
            }

            let session = super::session(&server, None)?;
            let config =
                super::read_file(&session, &config_path)?.ok_or("远端 config.toml 未创建")?;
            let config = config
                .parse::<toml::Value>()
                .map_err(|_| "远端 config.toml 写入后格式无效")?;
            let provider = config
                .get("model_providers")
                .and_then(toml::Value::as_table)
                .and_then(|providers| providers.get("custom"))
                .and_then(toml::Value::as_table)
                .ok_or("远端 config.toml 未写入 custom Provider")?;
            if config.get("model_provider").and_then(toml::Value::as_str) != Some("custom")
                || provider.get("wire_api").and_then(toml::Value::as_str) != Some("responses")
                || provider
                    .get("requires_openai_auth")
                    .and_then(toml::Value::as_bool)
                    != Some(true)
                || provider
                    .get("experimental_bearer_token")
                    .and_then(toml::Value::as_str)
                    != Some(relay_key.as_str())
            {
                return Err("远端 config.toml 与本地 Codex 中转格式不一致".into());
            }
            let auth = super::read_file(&session, &auth_path)?.ok_or("远端 auth.json 未创建")?;
            let auth = serde_json::from_str::<Value>(&auth)
                .map_err(|_| "远端 auth.json 写入后格式无效")?;
            if auth.get("OPENAI_API_KEY").and_then(Value::as_str) != Some(relay_key.as_str()) {
                return Err("远端 auth.json 未同步 OPENAI_API_KEY".into());
            }
            if super::read_file(&session, &env_path)?.is_some() {
                return Err("远端 relayhub.env 未清理".into());
            }
            if super::read_file(&session, &bashrc_path)?
                .as_deref()
                .is_some_and(|bashrc| bashrc.contains("# >>> RelayHub Codex >>>"))
            {
                return Err("远端 .bashrc RelayHub 注入未清理".into());
            }
            let session_result = super::verify_codex_session(&server, None);
            if !session_result.success {
                return Err(session_result
                    .reason
                    .unwrap_or_else(|| "Codex CLI 会话验证失败".into()));
            }
            Ok(())
        })();

        if let Err(error) = result {
            let restore = (|| -> Result<(), String> {
                let session = super::session(&server, None)?;
                super::restore_file(&session, &config_path, original_config.as_deref())?;
                super::restore_file(&session, &auth_path, original_auth.as_deref())?;
                super::restore_file(&session, &env_path, original_env.as_deref())?;
                super::restore_file(&session, &bashrc_path, original_bashrc.as_deref())?;
                Ok(())
            })();
            delete_e2e_credentials(&server.id);
            if let Err(restore_error) = restore {
                panic!("{}; 恢复远端配置失败: {}", error, restore_error);
            }
            panic!("{}", error);
        }
        delete_e2e_credentials(&server.id);
    }

    #[test]
    #[ignore = "requires RELAYHUB_E2E_SSH_HOST, RELAYHUB_E2E_SSH_USERNAME, and RELAYHUB_E2E_SSH_KEY_PATH"]
    fn authenticates_remote_ed25519_private_key() {
        let server = e2e_server(
            "relayhub-key-auth",
            "key",
            Some(std::env::var("RELAYHUB_E2E_SSH_KEY_PATH").expect("missing SSH key path")),
        );
        let session = super::session(&server, None)
            .expect("ED25519 private-key SSH authentication should succeed");
        assert!(!super::home(&session)
            .expect("remote home should be available")
            .trim()
            .is_empty());
    }

    #[test]
    #[ignore = "requires RELAYHUB_E2E_LOCAL_DB_PATH and the SSH E2E environment"]
    fn reconciles_local_remote_server_from_live_codex_configuration() {
        let database_path = std::env::var("RELAYHUB_E2E_LOCAL_DB_PATH")
            .expect("missing local RelayHub database path");
        let mut server = e2e_server(
            "relayhub-managed",
            "key",
            Some(std::env::var("RELAYHUB_E2E_SSH_KEY_PATH").expect("missing SSH key path")),
        );
        server.name = "服务器 124.222.165.170".into();
        let snapshot = super::fetch_codex_relay_config(&server, None)
            .expect("remote Codex configuration should be readable");
        let store = Store::open(database_path.into()).expect("local RelayHub database should open");
        for duplicate in store
            .list_remote_servers()
            .expect("remote servers should be listed")
            .into_iter()
            .filter(|saved| {
                saved.host == server.host
                    && saved.port == server.port
                    && saved.username == server.username
            })
        {
            store
                .delete_remote_server(&duplicate.id)
                .expect("duplicate server should be removed");
            delete_e2e_credentials(&duplicate.id);
        }
        super::apply_snapshot(&mut server, snapshot).expect("remote metadata should be applied");
        server.connection_status = "online".into();
        server.connection_error = None;
        server.last_synced_at = Some(now());
        server.last_sync_status = Some("verified".into());
        server.last_sync_error = None;
        server.updated_at = now();
        store
            .save_remote_server(&server)
            .expect("managed remote server should be saved");
        store
            .add_remote_sync_log(
                &server.id,
                "success",
                "reconcile",
                "Read the live Codex Relay configuration and consolidated duplicate server records.",
                server.relay_config_fingerprint.as_deref(),
            )
            .expect("reconciliation log should be saved");
        store
            .record_audit(
                &server.id,
                "remote.server.reconcile",
                "success",
                "Consolidated duplicate server records after reading the live Codex Relay configuration. Credentials are stored only in the OS credential store.",
            )
            .expect("reconciliation audit event should be saved");
    }

    fn e2e_server(prefix: &str, auth_type: &str, private_key_path: Option<String>) -> RemoteServer {
        RemoteServer {
            id: format!("{prefix}-{}", Uuid::new_v4()),
            name: "RelayHub E2E".into(),
            host: std::env::var("RELAYHUB_E2E_SSH_HOST").expect("missing SSH host"),
            port: DEFAULT_SSH_PORT,
            username: std::env::var("RELAYHUB_E2E_SSH_USERNAME").expect("missing SSH username"),
            auth_type: auth_type.into(),
            private_key_path,
            codex_version: None,
            codex_latest_version: None,
            codex_update_available: false,
            host_key_fingerprint: std::env::var("RELAYHUB_E2E_SSH_HOST_KEY_FINGERPRINT")
                .ok()
                .filter(|value| !value.trim().is_empty()),
            relay_url: None,
            relay_provider: None,
            relay_key_source: None,
            relay_key_masked: None,
            relay_config_fingerprint: None,
            connection_status: "warning".into(),
            connection_error: None,
            last_synced_at: None,
            last_sync_status: None,
            last_sync_error: None,
            updated_at: now(),
        }
    }

    fn delete_e2e_credentials(server_id: &str) {
        let _ = remote_relay_key_entry(server_id)
            .and_then(|entry| entry.delete_credential().map_err(|error| error.to_string()));
        let _ = remote_server_entry(server_id)
            .and_then(|entry| entry.delete_credential().map_err(|error| error.to_string()));
    }
}
