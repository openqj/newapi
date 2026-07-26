mod command_contract;
mod support;

use std::{collections::{BTreeSet, HashMap}, fs, io::{Read, Write}, net::{SocketAddr, TcpStream, ToSocketAddrs}, path::Path, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}, time::{Duration, Instant}};

use axum::{
    body::{to_bytes, Body},
    extract::{OriginalUri, State as AxumState},
    http::{header, HeaderMap, HeaderName, Request, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
    Router,
};
use chrono::{Datelike, Local, TimeZone};
use keyring::Entry;
use reqwest::{Client, Method};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use ssh2::Session;
use tauri::{menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu}, tray::TrayIconBuilder, AppHandle, Manager, State, WindowEvent};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;
use tokio::sync::{oneshot, RwLock};
use toml_edit::{value as toml_value, DocumentMut, Item, Table};
use url::Url;
use uuid::Uuid;
use support::{api_base_url, base, now};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Station {
    id: String,
    name: String,
    base_url: String,
    kind: String,
    status: String,
    last_synced_at: Option<i64>,
    last_error: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum StationAdapter {
    Sub2Api,
    NewApi,
}

#[derive(Clone, Copy)]
enum PagedResource {
    Keys,
    Usage,
}

impl StationAdapter {
    fn for_station(station: &Station) -> Result<Self, String> {
        match station.kind.as_str() {
            "sub2api" => Ok(Self::Sub2Api),
            "newapi" => Ok(Self::NewApi),
            _ => Err("不支持的站点类型".into()),
        }
    }

    fn login_path(self) -> &'static str {
        match self { Self::Sub2Api => "/api/v1/auth/login", Self::NewApi => "/api/user/login" }
    }

    fn login_2fa_path(self) -> &'static str {
        match self { Self::Sub2Api => "/api/v1/auth/login/2fa", Self::NewApi => "/api/user/login/2fa" }
    }

    fn login_body(self, username: &str, password: &str) -> Value {
        match self {
            Self::Sub2Api => json!({"email": username, "password": password}),
            Self::NewApi => json!({"username": username, "password": password}),
        }
    }

    fn profile_path(self) -> &'static str {
        match self { Self::Sub2Api => "/api/v1/user/profile", Self::NewApi => "/api/user/self" }
    }

    fn paged_path(self, resource: PagedResource, page: i64, page_size: i64) -> String {
        match (self, resource) {
            (Self::Sub2Api, PagedResource::Keys) => format!("/api/v1/keys?page={page}&page_size={page_size}"),
            (Self::Sub2Api, PagedResource::Usage) => format!("/api/v1/usage?page={page}&page_size={page_size}"),
            (Self::NewApi, PagedResource::Keys) => format!("/api/token/?p={page}&size={page_size}"),
            (Self::NewApi, PagedResource::Usage) => format!("/api/log/self?p={page}&page_size={page_size}"),
        }
    }

    fn first_page(self) -> i64 { match self { Self::Sub2Api => 1, Self::NewApi => 0 } }

    fn capabilities(self) -> StationCapabilities {
        match self {
            Self::Sub2Api => StationCapabilities { key_update: "patch_with_put_fallback".into(), supports_custom_key: true, supports_ip_blacklist: true, supports_rate_limits: true, supports_key_reveal: true },
            Self::NewApi => StationCapabilities { key_update: "full_put_and_status_put".into(), supports_custom_key: false, supports_ip_blacklist: false, supports_rate_limits: false, supports_key_reveal: true },
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct ApiKeyInfo {
    id: String,
    name: String,
    masked_key: String,
    group: Option<String>,
    status: String,
    remaining_quota: Option<f64>,
    total_quota: Option<f64>,
    unlimited_quota: bool,
    current_concurrency: Option<i64>,
    used_quota: Option<f64>,
    today_spent: Option<f64>,
    last_30_days_spent: Option<f64>,
    expires_at: Option<i64>,
    created_at: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
struct StationCapabilities {
    key_update: String,
    supports_custom_key: bool,
    supports_ip_blacklist: bool,
    supports_rate_limits: bool,
    supports_key_reveal: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KeyRow {
    station_id: String,
    station_name: String,
    station_url: String,
    station_balance: Option<f64>,
    groups: Vec<GroupOption>,
    models: Vec<String>,
    key: ApiKeyInfo,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
struct AccountInfo {
    id: String,
    username: String,
    display_name: String,
    email: Option<String>,
    group: Option<String>,
    role: String,
    status: String,
    balance: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountRow {
    station_id: String,
    station_name: String,
    station_url: String,
    kind: String,
    sync_status: String,
    last_synced_at: Option<i64>,
    account: AccountInfo,
    usage: UsageStats,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelTestResult {
    model: String,
    response: Option<String>,
    error: Option<String>,
    elapsed_ms: u64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelDetectionRequest {
    #[serde(default)]
    endpoint: String,
    #[serde(default)]
    api_key: String,
    model: String,
    protocol: String,
    station_id: Option<String>,
    key_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelDetectionCheck {
    name: String,
    status: String,
    detail: String,
    trace: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelDetectionResult {
    score: u8,
    checks: Vec<ModelDetectionCheck>,
    elapsed_ms: u64,
    tokens_per_second: f64,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GroupOption {
    name: String,
    multiplier: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct GroupRate {
    group: String,
    model: String,
    multiplier: f64,
    input_multiplier: Option<f64>,
    output_multiplier: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RateRow {
    station_id: String,
    station_name: String,
    station_url: String,
    last_synced_at: Option<i64>,
    sync_status: String,
    rate: GroupRate,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Offer {
    id: String,
    title: String,
    summary: String,
    source_url: String,
    published_at: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
struct UsageStats {
    today_input_tokens: Option<i64>,
    today_output_tokens: Option<i64>,
    today_requests: Option<i64>,
    total_requests: Option<i64>,
    today_spent: Option<f64>,
    today_limit: Option<f64>,
    total_spent: Option<f64>,
    total_limit: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct UsageSummary {
    today_input_tokens: Option<i64>,
    today_output_tokens: Option<i64>,
    today_requests: Option<i64>,
    total_requests: Option<i64>,
    today_spent: Option<f64>,
    today_limit: Option<f64>,
    total_spent: Option<f64>,
    total_limit: Option<f64>,
    costs_are_isolated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
struct StationSnapshot {
    station_balance: Option<f64>,
    #[serde(default)]
    account: AccountInfo,
    rates: Vec<GroupRate>,
    api_keys: Vec<ApiKeyInfo>,
    offers: Vec<Offer>,
    unavailable: Vec<String>,
    #[serde(default)]
    usage: UsageStats,
    #[serde(default)]
    capabilities: StationCapabilities,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddStationRequest {
    name: String,
    base_url: String,
    username: String,
    password: String,
    kind: String,
    totp: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApiKeyMutationRequest {
    station_id: String,
    key_id: Option<String>,
    name: Option<String>,
    group: Option<String>,
    custom_key: Option<String>,
    quota: Option<f64>,
    expires_in_days: Option<i64>,
    status: Option<String>,
    ip_whitelist: Option<Vec<String>>,
    ip_blacklist: Option<Vec<String>>,
    rate_limit_5h: Option<f64>,
    rate_limit_1d: Option<f64>,
    rate_limit_7d: Option<f64>,
    reset_quota: Option<bool>,
    reset_rate_limit_usage: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StationConnectionResult {
    success: bool,
    status: String,
    reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StationSaveResult {
    station: Station,
    connection: StationConnectionResult,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StationProbe {
    name: String,
    kind: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct UsageLog {
    id: String,
    station_id: String,
    station_name: String,
    station_url: String,
    api_key_name: Option<String>,
    group_name: Option<String>,
    endpoint: Option<String>,
    ip_address: Option<String>,
    reasoning_effort: Option<String>,
    billing_type: Option<String>,
    billing_mode: Option<String>,
    model: String,
    input_tokens: i64,
    output_tokens: i64,
    cache_creation_tokens: i64,
    cache_read_tokens: i64,
    actual_cost: f64,
    request_type: String,
    duration_ms: Option<i64>,
    created_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteServer {
    id: String,
    name: String,
    host: String,
    port: u16,
    username: String,
    auth_type: String,
    private_key_path: Option<String>,
    codex_version: Option<String>,
    codex_latest_version: Option<String>,
    codex_update_available: bool,
    host_key_fingerprint: Option<String>,
    relay_url: Option<String>,
    relay_provider: Option<String>,
    relay_key_source: Option<String>,
    relay_key_masked: Option<String>,
    relay_config_fingerprint: Option<String>,
    connection_status: String,
    connection_error: Option<String>,
    last_synced_at: Option<i64>,
    last_sync_status: Option<String>,
    last_sync_error: Option<String>,
    updated_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteConnectionResult {
    success: bool,
    status: String,
    code: Option<i32>,
    reason: Option<String>,
    host_key_fingerprint: Option<String>,
    requires_host_key_confirmation: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteServerSaveResult {
    server: RemoteServer,
    connection: RemoteConnectionResult,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoteSyncLog {
    id: i64,
    server_id: String,
    status: String,
    action: String,
    summary: String,
    config_fingerprint: Option<String>,
    created_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AddRemoteServerRequest {
    name: String,
    host: String,
    #[serde(default = "default_ssh_port")]
    port: u16,
    username: String,
    auth_type: String,
    password: Option<String>,
    private_key_path: Option<String>,
    private_key_passphrase: Option<String>,
    relay_provider: Option<String>,
    host_key_fingerprint: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateRemoteServerRequest {
    id: String,
    name: String,
    host: String,
    #[serde(default = "default_ssh_port")]
    port: u16,
    username: String,
    auth_type: String,
    password: Option<String>,
    private_key_path: Option<String>,
    private_key_passphrase: Option<String>,
    relay_provider: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateRemoteRelayRequest {
    server_id: String,
    relay_url: String,
    relay_key: Option<String>,
    relay_provider: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
struct Secret {
    username: String,
    password: String,
    access_token: Option<String>,
    refresh_token: Option<String>,
    #[serde(default)]
    newapi_user_id: Option<String>,
    #[serde(default)]
    newapi_session: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginProfile {
    id: String,
    name: String,
    username: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginProfileRequest {
    id: Option<String>,
    name: String,
    username: String,
    password: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoginProfileSecret {
    username: String,
    password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncResult {
    station: Station,
    snapshot: StationSnapshot,
    changed: bool,
    change_summary: Vec<String>,
}

struct Store { connection: Connection, path: std::path::PathBuf }

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct SyncProgress {
    operation_id: String,
    completed: usize,
    total: usize,
    current_station: Option<String>,
    status: String,
}

struct AppState { store: Mutex<Store>, client: Client, gateway: GatewayController, auth_backoff: Mutex<HashMap<String, AuthBackoff>>, remote_operations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>, sync_operations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>, sync_progress: Mutex<HashMap<String, SyncProgress>> }

struct RemoteOperationGuard { id: String, operations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>, cancelled: Arc<AtomicBool> }

impl Drop for RemoteOperationGuard {
    fn drop(&mut self) {
        if let Ok(mut operations) = self.operations.lock() { operations.remove(&self.id); }
    }
}

struct AuthBackoff { attempts: u8, retry_after: i64 }

const DEFAULT_GATEWAY_PORT: u16 = 18765;
const DEFAULT_SSH_PORT: u16 = 22;
const GATEWAY_TOKEN_ID: &str = "local-gateway-token";
fn default_ssh_port() -> u16 { DEFAULT_SSH_PORT }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
enum RoutingMode { CcSwitch, LocalGateway }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayStatus {
    mode: RoutingMode,
    running: bool,
    port: u16,
    base_url: String,
    active_station_id: Option<String>,
    active_key_id: Option<String>,
    has_active_route: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GatewayCredentials { base_url: String, token: String }

#[derive(Clone, Debug)]
struct GatewayRoute {
    station_id: String,
    key_id: String,
    upstream_base_url: String,
    api_key: String,
}

#[derive(Clone, Debug)]
struct GatewayRuntime {
    token: String,
    port: u16,
    route: Option<GatewayRoute>,
}

#[derive(Clone)]
struct GatewayServiceState { runtime: Arc<RwLock<GatewayRuntime>>, client: Client }

struct GatewayController {
    runtime: Arc<RwLock<GatewayRuntime>>,
    client: Client,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
}

impl Store {
    fn open(path: std::path::PathBuf) -> Result<Self, String> {
        let connection = Connection::open(&path).map_err(|e| e.to_string())?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS stations (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
                kind TEXT NOT NULL, status TEXT NOT NULL, last_synced_at INTEGER, last_error TEXT
             );
             CREATE TABLE IF NOT EXISTS snapshots (
                station_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT, station_id TEXT NOT NULL, summary TEXT NOT NULL, created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT, station_id TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL,
                detail TEXT NOT NULL, created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS usage_log_cache (
                station_id TEXT NOT NULL, log_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
                PRIMARY KEY (station_id, log_id)
             );
             CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY, value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS login_profiles (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS remote_servers (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 22, username TEXT NOT NULL,
                auth_type TEXT NOT NULL, private_key_path TEXT, codex_version TEXT, codex_latest_version TEXT, codex_update_available INTEGER NOT NULL DEFAULT 0, host_key_fingerprint TEXT, relay_url TEXT, relay_provider TEXT, relay_key_source TEXT,
                relay_key_masked TEXT, relay_config_fingerprint TEXT, connection_status TEXT NOT NULL DEFAULT 'warning', connection_error TEXT,
                last_synced_at INTEGER, last_sync_status TEXT, last_sync_error TEXT, updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS remote_sync_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT, server_id TEXT NOT NULL, status TEXT NOT NULL, action TEXT NOT NULL,
                summary TEXT NOT NULL, config_fingerprint TEXT, created_at INTEGER NOT NULL
             );"
        ).map_err(|e| e.to_string())?;
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN port INTEGER NOT NULL DEFAULT 22", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN codex_version TEXT", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN codex_latest_version TEXT", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN codex_update_available INTEGER NOT NULL DEFAULT 0", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN host_key_fingerprint TEXT", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN relay_provider TEXT", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN relay_config_fingerprint TEXT", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'warning'", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN connection_error TEXT", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN last_synced_at INTEGER", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN last_sync_status TEXT", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN last_sync_error TEXT", []);
        Ok(Self { connection, path })
    }

    fn list_stations(&self) -> Result<Vec<Station>, String> {
        let mut statement = self.connection.prepare("SELECT id, name, base_url, kind, status, last_synced_at, last_error FROM stations ORDER BY name")
            .map_err(|e| e.to_string())?;
        let stations = statement.query_map([], |row| Ok(Station {
            id: row.get(0)?, name: row.get(1)?, base_url: row.get(2)?, kind: row.get(3)?, status: row.get(4)?,
            last_synced_at: row.get(5)?, last_error: row.get(6)?,
        })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(stations)
    }

    fn get_station(&self, id: &str) -> Result<Station, String> {
        self.connection.query_row("SELECT id, name, base_url, kind, status, last_synced_at, last_error FROM stations WHERE id=?1", [id], |row| Ok(Station {
            id: row.get(0)?, name: row.get(1)?, base_url: row.get(2)?, kind: row.get(3)?, status: row.get(4)?,
            last_synced_at: row.get(5)?, last_error: row.get(6)?,
        })).map_err(|e| e.to_string())
    }

    fn save_station(&self, station: &Station) -> Result<(), String> {
        self.connection.execute("INSERT OR REPLACE INTO stations (id,name,base_url,kind,status,last_synced_at,last_error) VALUES (?1,?2,?3,?4,?5,?6,?7)",
            params![station.id, station.name, station.base_url, station.kind, station.status, station.last_synced_at, station.last_error]).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn delete_station(&self, id: &str) -> Result<(), String> {
        self.connection.execute("DELETE FROM stations WHERE id=?1", [id]).map_err(|e| e.to_string())?;
        self.connection.execute("DELETE FROM snapshots WHERE station_id=?1", [id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn load_snapshot(&self, id: &str) -> Result<Option<(String, StationSnapshot)>, String> {
        let result = self.connection.query_row("SELECT fingerprint,payload FROM snapshots WHERE station_id=?1", [id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)));
        match result { Ok((fingerprint, payload)) => Ok(Some((fingerprint, serde_json::from_str(&payload).map_err(|e| e.to_string())?))), Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None), Err(e) => Err(e.to_string()) }
    }

    fn save_snapshot(&self, id: &str, fingerprint: &str, snapshot: &StationSnapshot, changes: &[String]) -> Result<(), String> {
        let now = now();
        self.connection.execute("INSERT OR REPLACE INTO snapshots (station_id,fingerprint,payload,updated_at) VALUES (?1,?2,?3,?4)",
            params![id, fingerprint, serde_json::to_string(snapshot).map_err(|e| e.to_string())?, now]).map_err(|e| e.to_string())?;
        for change in changes { self.connection.execute("INSERT INTO changes (station_id,summary,created_at) VALUES (?1,?2,?3)", params![id, change, now]).map_err(|e| e.to_string())?; }
        Ok(())
    }

    fn history(&self, id: &str) -> Result<Vec<Value>, String> {
        let mut statement = self.connection.prepare("SELECT summary,created_at FROM changes WHERE station_id=?1 ORDER BY id DESC LIMIT 30").map_err(|e| e.to_string())?;
        let history = statement.query_map([id], |row| Ok(json!({"summary": row.get::<_, String>(0)?, "createdAt": row.get::<_, i64>(1)?})))
            .map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(history)
    }

    fn record_audit(&self, station_id: &str, action: &str, outcome: &str, detail: &str) -> Result<(), String> {
        self.connection.execute("INSERT INTO audit_events (station_id,action,outcome,detail,created_at) VALUES (?1,?2,?3,?4,?5)", params![station_id, action, outcome, detail, now()]).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn cache_usage_logs(&mut self, logs: &[UsageLog]) -> Result<(), String> {
        let transaction = self.connection.transaction().map_err(|e| e.to_string())?;
        for log in logs {
            transaction.execute("INSERT OR REPLACE INTO usage_log_cache (station_id,log_id,payload,created_at) VALUES (?1,?2,?3,?4)", params![log.station_id, log.id, serde_json::to_string(log).map_err(|e| e.to_string())?, now()]).map_err(|e| e.to_string())?;
        }
        transaction.commit().map_err(|e| e.to_string())
    }

    fn cached_usage_logs(&self, station_id: &str) -> Result<Vec<UsageLog>, String> {
        let mut statement = self.connection.prepare("SELECT payload FROM usage_log_cache WHERE station_id=?1 ORDER BY created_at DESC").map_err(|e| e.to_string())?;
        let logs = statement.query_map([station_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?.map(|row| serde_json::from_str::<UsageLog>(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())).collect();
        logs
    }

    fn list_login_profiles(&self) -> Result<Vec<LoginProfile>, String> {
        let mut statement = self.connection.prepare("SELECT id,name,username FROM login_profiles ORDER BY name").map_err(|e| e.to_string())?;
        let profiles = statement.query_map([], |row| Ok(LoginProfile { id: row.get(0)?, name: row.get(1)?, username: row.get(2)? }))
            .map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(profiles)
    }

    fn save_login_profile(&self, profile: &LoginProfile) -> Result<(), String> {
        self.connection.execute("INSERT OR REPLACE INTO login_profiles (id,name,username) VALUES (?1,?2,?3)", params![profile.id, profile.name, profile.username]).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn delete_login_profile(&self, id: &str) -> Result<(), String> {
        self.connection.execute("DELETE FROM login_profiles WHERE id=?1", [id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn list_remote_servers(&self) -> Result<Vec<RemoteServer>, String> {
        let mut statement = self.connection.prepare("SELECT id,name,host,port,username,auth_type,private_key_path,codex_version,codex_latest_version,codex_update_available,host_key_fingerprint,relay_url,relay_provider,relay_key_source,relay_key_masked,relay_config_fingerprint,connection_status,connection_error,last_synced_at,last_sync_status,last_sync_error,updated_at FROM remote_servers ORDER BY name")
            .map_err(|e| e.to_string())?;
        let servers = statement.query_map([], |row| Ok(RemoteServer {
            id: row.get(0)?, name: row.get(1)?, host: row.get(2)?, port: row.get(3)?, username: row.get(4)?, auth_type: row.get(5)?, private_key_path: row.get(6)?, codex_version: row.get(7)?, codex_latest_version: row.get(8)?, codex_update_available: row.get(9)?, host_key_fingerprint: row.get(10)?,
            relay_url: row.get(11)?, relay_provider: row.get(12)?, relay_key_source: row.get(13)?, relay_key_masked: row.get(14)?, relay_config_fingerprint: row.get(15)?, connection_status: row.get(16)?, connection_error: row.get(17)?, last_synced_at: row.get(18)?, last_sync_status: row.get(19)?, last_sync_error: row.get(20)?, updated_at: row.get(21)?,
        })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(servers)
    }

    fn get_remote_server(&self, id: &str) -> Result<RemoteServer, String> {
        self.connection.query_row("SELECT id,name,host,port,username,auth_type,private_key_path,codex_version,codex_latest_version,codex_update_available,host_key_fingerprint,relay_url,relay_provider,relay_key_source,relay_key_masked,relay_config_fingerprint,connection_status,connection_error,last_synced_at,last_sync_status,last_sync_error,updated_at FROM remote_servers WHERE id=?1", [id], |row| Ok(RemoteServer {
            id: row.get(0)?, name: row.get(1)?, host: row.get(2)?, port: row.get(3)?, username: row.get(4)?, auth_type: row.get(5)?, private_key_path: row.get(6)?, codex_version: row.get(7)?, codex_latest_version: row.get(8)?, codex_update_available: row.get(9)?, host_key_fingerprint: row.get(10)?,
            relay_url: row.get(11)?, relay_provider: row.get(12)?, relay_key_source: row.get(13)?, relay_key_masked: row.get(14)?, relay_config_fingerprint: row.get(15)?, connection_status: row.get(16)?, connection_error: row.get(17)?, last_synced_at: row.get(18)?, last_sync_status: row.get(19)?, last_sync_error: row.get(20)?, updated_at: row.get(21)?,
        })).map_err(|e| e.to_string())
    }

    fn save_remote_server(&self, server: &RemoteServer) -> Result<(), String> {
        self.connection.execute("INSERT OR REPLACE INTO remote_servers (id,name,host,port,username,auth_type,private_key_path,codex_version,codex_latest_version,codex_update_available,host_key_fingerprint,relay_url,relay_provider,relay_key_source,relay_key_masked,relay_config_fingerprint,connection_status,connection_error,last_synced_at,last_sync_status,last_sync_error,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)",
            params![server.id, server.name, server.host, server.port, server.username, server.auth_type, server.private_key_path, server.codex_version, server.codex_latest_version, server.codex_update_available, server.host_key_fingerprint, server.relay_url, server.relay_provider, server.relay_key_source, server.relay_key_masked, server.relay_config_fingerprint, server.connection_status, server.connection_error, server.last_synced_at, server.last_sync_status, server.last_sync_error, server.updated_at]).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn delete_remote_server(&self, id: &str) -> Result<(), String> {
        self.connection.execute("DELETE FROM remote_servers WHERE id=?1", [id]).map_err(|e| e.to_string())?;
        self.connection.execute("DELETE FROM remote_sync_logs WHERE server_id=?1", [id]).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn add_remote_sync_log(&self, server_id: &str, status: &str, action: &str, summary: &str, config_fingerprint: Option<&str>) -> Result<(), String> {
        self.connection.execute("INSERT INTO remote_sync_logs (server_id,status,action,summary,config_fingerprint,created_at) VALUES (?1,?2,?3,?4,?5,?6)", params![server_id, status, action, summary, config_fingerprint, now()]).map_err(|e| e.to_string())?;
        Ok(())
    }

    fn list_remote_sync_logs(&self, server_id: &str) -> Result<Vec<RemoteSyncLog>, String> {
        let mut statement = self.connection.prepare("SELECT id,server_id,status,action,summary,config_fingerprint,created_at FROM remote_sync_logs WHERE server_id=?1 ORDER BY id DESC LIMIT 30").map_err(|e| e.to_string())?;
        let logs = statement.query_map([server_id], |row| Ok(RemoteSyncLog { id: row.get(0)?, server_id: row.get(1)?, status: row.get(2)?, action: row.get(3)?, summary: row.get(4)?, config_fingerprint: row.get(5)?, created_at: row.get(6)? }))
            .map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        Ok(logs)
    }

    fn setting(&self, key: &str) -> Result<Option<String>, String> {
        match self.connection.query_row("SELECT value FROM app_settings WHERE key=?1", [key], |row| row.get(0)) {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn save_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.connection.execute("INSERT OR REPLACE INTO app_settings (key,value) VALUES (?1,?2)", params![key, value]).map_err(|e| e.to_string())?;
        Ok(())
    }
}

fn credential_entry(id: &str) -> Result<Entry, String> { Entry::new("api-assistant", id).map_err(|e| e.to_string()) }
fn save_secret(id: &str, secret: &Secret) -> Result<(), String> { credential_entry(id)?.set_password(&serde_json::to_string(secret).map_err(|e| e.to_string())?).map_err(|e| e.to_string()) }
fn load_secret(id: &str) -> Result<Secret, String> { serde_json::from_str(&credential_entry(id)?.get_password().map_err(|_| "未找到该站点的安全凭据".to_string())?).map_err(|e| e.to_string()) }
fn clear_secret(id: &str) { if let Ok(entry) = credential_entry(id) { let _ = entry.delete_credential(); } }
fn login_profile_entry(id: &str) -> Result<Entry, String> { Entry::new("api-assistant-login-profile", id).map_err(|e| e.to_string()) }
fn save_login_profile_secret(id: &str, username: &str, password: &str) -> Result<(), String> { login_profile_entry(id)?.set_password(&serde_json::to_string(&LoginProfileSecret { username: username.to_string(), password: password.to_string() }).map_err(|e| e.to_string())?).map_err(|e| e.to_string()) }
fn load_login_profile_secret(id: &str) -> Result<LoginProfileSecret, String> { serde_json::from_str(&login_profile_entry(id)?.get_password().map_err(|_| "未找到该账号的安全凭据".to_string())?).map_err(|e| e.to_string()) }
fn clear_login_profile_secret(id: &str) { if let Ok(entry) = login_profile_entry(id) { let _ = entry.delete_credential(); } }
fn remote_server_entry(id: &str) -> Result<Entry, String> { Entry::new("api-assistant-remote-server", id).map_err(|e| e.to_string()) }
fn remote_key_passphrase_entry(id: &str) -> Result<Entry, String> { Entry::new("api-assistant-remote-key-passphrase", id).map_err(|e| e.to_string()) }
fn remote_relay_key_entry(id: &str) -> Result<Entry, String> { Entry::new("api-assistant-remote-relay-key", id).map_err(|e| e.to_string()) }

fn acquire_remote_operation(state: &AppState, id: &str) -> Result<RemoteOperationGuard, String> {
    let mut operations = state.remote_operations.lock().map_err(|_| "远程同步状态不可用".to_string())?;
    if operations.contains_key(id) { return Err("该服务器已有同步或测试正在执行，请等待完成".into()); }
    let cancelled = Arc::new(AtomicBool::new(false));
    operations.insert(id.to_string(), cancelled.clone());
    Ok(RemoteOperationGuard { id: id.to_string(), operations: state.remote_operations.clone(), cancelled })
}

fn ensure_remote_operation_active(operation: Option<&RemoteOperationGuard>) -> Result<(), String> {
    if operation.is_some_and(|operation| operation.cancelled.load(Ordering::Relaxed)) { return Err("操作已取消".into()); }
    Ok(())
}

fn cancel_remote_operation(state: &AppState, id: &str) -> Result<(), String> {
    let operations = state.remote_operations.lock().map_err(|_| "远程同步状态不可用".to_string())?;
    let cancelled = operations.get(id).ok_or("该服务器当前没有可取消的操作")?;
    cancelled.store(true, Ordering::Relaxed);
    Ok(())
}

fn add_remote_sync_log(state: &AppState, server: &RemoteServer, status: &str, action: &str, summary: &str) {
    if let Ok(store) = state.store.lock() {
        let _ = store.add_remote_sync_log(&server.id, status, action, summary, server.relay_config_fingerprint.as_deref());
    }
}

fn record_remote_failure(state: &AppState, server: &mut RemoteServer, action: &str, reason: &str) {
    server.last_synced_at = Some(now());
    server.last_sync_status = Some(if reason == "操作已取消" { "cancelled".into() } else { "error".into() });
    server.last_sync_error = Some(reason.to_string());
    server.updated_at = now();
    if let Ok(store) = state.store.lock() {
        let _ = store.save_remote_server(server);
        let _ = store.add_remote_sync_log(&server.id, server.last_sync_status.as_deref().unwrap_or("error"), action, reason, server.relay_config_fingerprint.as_deref());
    }
}

fn replace_remote_relay_key(id: &str, key: &str) -> Result<Option<String>, String> {
    let entry = remote_relay_key_entry(id)?;
    let previous = entry.get_password().ok().filter(|value| !value.trim().is_empty());
    entry.set_password(key).map_err(|error| error.to_string())?;
    Ok(previous)
}

fn restore_remote_relay_key(id: &str, previous: Option<&str>) {
    if let Ok(entry) = remote_relay_key_entry(id) {
        match previous {
            Some(key) => { let _ = entry.set_password(key); }
            None => { let _ = entry.delete_credential(); }
        }
    }
}
fn mask_secret(value: &str) -> String { if value.len() > 10 { format!("{}...{}", &value[..5], &value[value.len() - 4..]) } else { "已安全保存".into() } }
fn load_or_create_gateway_token() -> Result<String, String> {
    if let Ok(token) = credential_entry(GATEWAY_TOKEN_ID)?.get_password() {
        if !token.trim().is_empty() { return Ok(token); }
    }
    let token = format!("rh-{}", Uuid::new_v4().simple());
    credential_entry(GATEWAY_TOKEN_ID)?.set_password(&token).map_err(|e| e.to_string())?;
    Ok(token)
}
fn gateway_base_url(port: u16) -> String { format!("http://127.0.0.1:{port}/v1") }

struct CodexRelayConfig {
    url: String,
    key: String,
    provider: String,
}

struct RemoteCodexSnapshot {
    relay: Option<CodexRelayConfig>,
    codex_version: Option<String>,
    codex_latest_version: Option<String>,
    codex_update_available: bool,
    host_key_fingerprint: String,
    config_fingerprint: String,
}

fn remote_socket(host: &str, port: u16) -> Result<SocketAddr, String> {
    let address = if host.contains(':') { format!("[{host}]:{port}") } else { format!("{host}:{port}") };
    address
        .to_socket_addrs()
        .map_err(|error| error.to_string())?
        .next()
        .ok_or_else(|| "未解析到服务器地址".into())
}

fn host_key_fingerprint(session: &Session) -> Result<String, String> {
    let (host_key, _) = session.host_key().ok_or("服务器未提供 SSH 主机密钥")?;
    let digest = Sha256::digest(host_key);
    Ok(format!("SHA256:{}", digest.iter().map(|byte| format!("{byte:02x}")).collect::<String>()))
}

fn probe_remote_host_key(server: &RemoteServer) -> Result<String, String> {
    let socket = remote_socket(&server.host, server.port)?;
    let tcp = TcpStream::connect_timeout(&socket, Duration::from_secs(15)).map_err(|error| format!("SSH TCP 连接失败：{error}"))?;
    tcp.set_read_timeout(Some(Duration::from_secs(20))).map_err(|error| error.to_string())?;
    tcp.set_write_timeout(Some(Duration::from_secs(20))).map_err(|error| error.to_string())?;
    let mut session = Session::new().map_err(|error| format!("无法创建 SSH 会话：{error}"))?;
    session.set_tcp_stream(tcp);
    session.set_timeout(20_000);
    session.handshake().map_err(|error| format!("SSH 握手失败：{error}"))?;
    host_key_fingerprint(&session)
}

fn config_fingerprint(config: Option<&str>, auth: Option<&str>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(config.unwrap_or_default().as_bytes());
    hasher.update([0]);
    hasher.update(auth.unwrap_or_default().as_bytes());
    format!("sha256:{}", hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect::<String>())
}

fn comparable_version(value: &str) -> Option<Vec<u64>> {
    value.split(|character: char| !character.is_ascii_digit() && character != '.')
        .find(|part| part.contains('.') && part.chars().all(|character| character.is_ascii_digit() || character == '.'))?
        .split('.').map(str::parse::<u64>).collect::<Result<Vec<_>, _>>().ok()
}

fn codex_update_available(installed: Option<&str>, latest: Option<&str>) -> bool {
    let (Some(installed), Some(latest)) = (installed.and_then(comparable_version), latest.and_then(comparable_version)) else { return false; };
    let length = installed.len().max(latest.len());
    for index in 0..length {
        match installed.get(index).copied().unwrap_or(0).cmp(&latest.get(index).copied().unwrap_or(0)) {
            std::cmp::Ordering::Equal => continue,
            std::cmp::Ordering::Less => return true,
            std::cmp::Ordering::Greater => return false,
        }
    }
    false
}

fn userauth_ssh_agent(session: &Session, username: &str) -> Result<(), String> {
    let mut agent = session.agent().map_err(|error| error.to_string())?;
    agent.connect().map_err(|error| error.to_string())?;
    agent.list_identities().map_err(|error| error.to_string())?;
    let identities = agent.identities().map_err(|error| error.to_string())?;
    if identities.is_empty() { return Err("SSH Agent 中没有可用身份".into()); }
    let mut last_error = String::new();
    for identity in identities {
        match agent.userauth(username, &identity) {
            Ok(()) if session.authenticated() => return Ok(()),
            Ok(()) => last_error = "SSH Agent 身份未获服务器接受".into(),
            Err(error) => last_error = error.to_string(),
        }
    }
    Err(if last_error.is_empty() { "SSH Agent 身份认证失败".into() } else { last_error })
}

fn remote_session_once(server: &RemoteServer, operation: Option<&RemoteOperationGuard>) -> Result<Session, String> {
    ensure_remote_operation_active(operation)?;
    let socket = remote_socket(&server.host, server.port)?;
    let tcp = TcpStream::connect_timeout(&socket, Duration::from_secs(15)).map_err(|error| format!("SSH TCP 连接失败：{error}"))?;
    ensure_remote_operation_active(operation)?;
    tcp.set_read_timeout(Some(Duration::from_secs(20))).map_err(|error| error.to_string())?;
    tcp.set_write_timeout(Some(Duration::from_secs(20))).map_err(|error| error.to_string())?;
    let mut session = Session::new().map_err(|error| format!("无法创建 SSH 会话：{error}"))?;
    session.set_tcp_stream(tcp);
    session.set_timeout(20_000);
    session.handshake().map_err(|error| format!("SSH 握手失败：{error}"))?;
    ensure_remote_operation_active(operation)?;
    let fingerprint = host_key_fingerprint(&session)?;
    if let Some(expected) = &server.host_key_fingerprint {
        if expected != &fingerprint { return Err(format!("SSH 主机指纹不匹配：预期 {expected}，实际 {fingerprint}")); }
    }

    if server.auth_type == "password" {
        let password = remote_server_entry(&server.id)?
            .get_password()
            .map_err(|_| "未找到服务器密码".to_string())?;
        session.userauth_password(&server.username, &password).map_err(|error| format!("SSH 密码认证失败：{error}"))?;
    } else {
        let private_key = server.private_key_path.as_deref().ok_or("未找到 SSH 密钥")?;
        let passphrase = remote_key_passphrase_entry(&server.id).ok().and_then(|entry| entry.get_password().ok());
        let file_auth = if private_key.contains("-----BEGIN") {
            let mut key_file = tempfile::NamedTempFile::new().map_err(|error| error.to_string())?;
            key_file.write_all(private_key.as_bytes()).map_err(|error| error.to_string())?;
            session.userauth_pubkey_file(&server.username, None, key_file.path(), passphrase.as_deref())
        } else {
            session.userauth_pubkey_file(&server.username, None, Path::new(private_key), passphrase.as_deref())
        };
        if let Err(file_error) = file_auth {
            if let Err(agent_error) = userauth_ssh_agent(&session, &server.username) {
                return Err(format!("SSH 私钥认证失败。文件密钥: {file_error}; SSH Agent 回退: {agent_error}。请将 ED25519 密钥加入 Windows OpenSSH Agent，或使用 PEM/RSA 密钥。"));
            }
        }
    }

    ensure_remote_operation_active(operation)?;
    if session.authenticated() { Ok(session) } else { Err("SSH 身份验证失败".into()) }
}

fn remote_session(server: &RemoteServer, operation: Option<&RemoteOperationGuard>) -> Result<Session, String> {
    let mut last_error = String::new();
    for attempt in 0..2 {
        ensure_remote_operation_active(operation)?;
        match remote_session_once(server, operation) {
            Ok(session) => return Ok(session),
            Err(error) => {
                last_error = error;
                if attempt == 0 { std::thread::sleep(Duration::from_millis(350)); }
            }
        }
    }
    Err(last_error)
}

fn shell_quote(value: &str) -> String { format!("'{}'", value.replace('\'', "'\"'\"'")) }

fn remote_command(session: &Session, command: &str) -> Result<(i32, String), String> {
    let mut channel = session.channel_session().map_err(|error| error.to_string())?;
    channel.exec(command).map_err(|error| error.to_string())?;
    channel.send_eof().map_err(|error| error.to_string())?;
    let mut output = String::new();
    channel.read_to_string(&mut output).map_err(|error| error.to_string())?;
    channel.wait_close().map_err(|error| error.to_string())?;
    Ok((channel.exit_status().map_err(|error| error.to_string())?, output))
}

fn remote_home(session: &Session) -> Result<String, String> {
    let (status, home) = remote_command(session, "printf %s \"$HOME\"")?;
    if status != 0 || home.trim().is_empty() { return Err("无法确定服务器用户目录".into()); }
    Ok(home)
}

fn read_remote_file(session: &Session, path: &str) -> Result<Option<String>, String> {
    let (status, content) = remote_command(session, &format!("if [ -e {path} ]; then cat -- {path}; else exit 44; fi", path = shell_quote(path)))?;
    match status {
        0 => Ok(Some(content)),
        44 => Ok(None),
        _ => Err(format!("无法读取服务器文件：{path}")),
    }
}

fn write_remote_file(session: &Session, path: &str, content: &str) -> Result<(), String> {
    let directory = Path::new(path).parent().ok_or("无效的服务器文件路径")?.to_string_lossy();
    let (status, _) = remote_command(session, &format!("mkdir -p -- {directory} && chmod 700 -- {directory}", directory = shell_quote(&directory)))?;
    if status != 0 { return Err("无法创建服务器 Codex 配置目录".into()); }
    let sftp = session.sftp().map_err(|error| error.to_string())?;
    let temporary = format!("{path}.relayhub-{}.tmp", Uuid::new_v4());
    {
        let mut file = sftp.create(Path::new(&temporary)).map_err(|error| format!("创建远端临时文件失败 ({temporary}): {error}"))?;
        file.write_all(content.as_bytes()).map_err(|error| format!("写入远端临时文件失败 ({temporary}): {error}"))?;
        file.flush().map_err(|error| format!("刷新远端临时文件失败 ({temporary}): {error}"))?;
    }
    if let Err(sftp_error) = sftp.rename(Path::new(&temporary), Path::new(path), Some(ssh2::RenameFlags::OVERWRITE)) {
        let (status, output) = remote_command(session, &format!("mv -f -- {} {}", shell_quote(&temporary), shell_quote(path)))?;
        if status != 0 { return Err(format!("原子替换远端文件失败 ({path}): {sftp_error}; mv: {}", output.trim())); }
    }
    let (status, _) = remote_command(session, &format!("chmod 600 -- {}", shell_quote(path)))?;
    if status != 0 { return Err(format!("无法设置服务器文件权限：{path}")); }
    Ok(())
}

fn restore_remote_file(session: &Session, path: &str, original: Option<&str>) -> Result<(), String> {
    match original {
        Some(content) => write_remote_file(session, path, content),
        None => {
            let (status, _) = remote_command(session, &format!("rm -f -- {}", shell_quote(path)))?;
            if status == 0 { Ok(()) } else { Err(format!("无法删除服务器文件：{path}")) }
        }
    }
}

fn remove_bashrc_relay_source(content: Option<&str>) -> Option<String> {
    const START: &str = "# >>> RelayHub Codex >>>";
    const END: &str = "# <<< RelayHub Codex <<<";
    let current = content?;
    let (Some(start), Some(end)) = (current.find(START), current.find(END)) else { return None; };
    if end < start { return None; }
    Some(format!("{}{}", &current[..start], &current[end + END.len()..]))
}

fn patch_codex_config(config: &str, requested_provider: Option<&str>, relay_url: &str, relay_key: &str) -> Result<(String, String), String> {
    let mut document = if config.trim().is_empty() { DocumentMut::new() } else { config.parse::<DocumentMut>().map_err(|_| "服务器 Codex config.toml 格式无效".to_string())? };
    let provider_name = requested_provider.filter(|name| !name.trim().is_empty())
        .unwrap_or("custom").to_string();
    document["model_provider"] = toml_value(provider_name.clone());
    if document.get("model_providers").is_none() { document["model_providers"] = Item::Table(Table::new()); }
    let providers = document["model_providers"].as_table_mut().ok_or("服务器 Codex model_providers 必须是表")?;
    if !providers.contains_key(&provider_name) { providers.insert(&provider_name, Item::Table(Table::new())); }
    let provider = providers.get_mut(&provider_name).and_then(Item::as_table_mut).ok_or("服务器 Codex provider 必须是表")?;
    if provider.get("name").and_then(Item::as_str).map_or(true, |name| name.trim().is_empty()) { provider["name"] = toml_value("RelayHub"); }
    provider["base_url"] = toml_value(relay_url.trim());
    provider["wire_api"] = toml_value("responses");
    provider["requires_openai_auth"] = toml_value(true);
    provider["experimental_bearer_token"] = toml_value(relay_key);
    provider.remove("env_key");
    provider.remove("api_key");
    Ok((document.to_string(), provider_name))
}

fn write_codex_relay_config(server: &RemoteServer, relay_url: &str, relay_key: &str, operation: Option<&RemoteOperationGuard>) -> Result<RemoteCodexSnapshot, String> {
    ensure_remote_operation_active(operation)?;
    let session = remote_session(server, operation)?;
    let home = remote_home(&session)?;
    ensure_remote_operation_active(operation)?;
    let config_path = format!("{home}/.codex/config.toml");
    let auth_path = format!("{home}/.codex/auth.json");
    let env_path = format!("{home}/.codex/relayhub.env");
    let bashrc_path = format!("{home}/.bashrc");
    let original_config = read_remote_file(&session, &config_path)?;
    let original_auth = read_remote_file(&session, &auth_path)?;
    let original_env = read_remote_file(&session, &env_path)?;
    let original_bashrc = read_remote_file(&session, &bashrc_path)?;
    ensure_remote_operation_active(operation)?;
    let original_fingerprint = config_fingerprint(original_config.as_deref(), original_auth.as_deref());
    if let Some(expected) = &server.relay_config_fingerprint {
        if expected != &original_fingerprint { return Err("远端 Codex 配置已在上次读取后变更，请先测试连接刷新配置再同步".into()); }
    }

    let (next_config, provider_name) = patch_codex_config(original_config.as_deref().unwrap_or_default(), server.relay_provider.as_deref(), relay_url, relay_key)?;

    let auth = original_auth.as_deref().unwrap_or("{}");
    let mut auth = if auth.trim().is_empty() { Value::Object(Default::default()) } else { serde_json::from_str::<Value>(auth).map_err(|_| "服务器 Codex auth.json 格式无效".to_string())? };
    let auth = auth.as_object_mut().ok_or("服务器 Codex auth.json 根节点必须是对象")?;
    auth.insert("OPENAI_API_KEY".into(), Value::String(relay_key.to_string()));
    let next_auth = serde_json::to_string_pretty(&auth).map_err(|error| error.to_string())?;
    let next_bashrc = remove_bashrc_relay_source(original_bashrc.as_deref());

    let result = (|| -> Result<RemoteCodexSnapshot, String> {
        ensure_remote_operation_active(operation)?;
        write_remote_file(&session, &config_path, &next_config)?;
        ensure_remote_operation_active(operation)?;
        write_remote_file(&session, &auth_path, &next_auth)?;
        ensure_remote_operation_active(operation)?;
        restore_remote_file(&session, &env_path, None)?;
        if let Some(next_bashrc) = &next_bashrc {
            ensure_remote_operation_active(operation)?;
            write_remote_file(&session, &bashrc_path, next_bashrc)?;
        }
        ensure_remote_operation_active(operation)?;
        let snapshot = fetch_codex_relay_config(server, operation)?;
        let relay = snapshot.relay.as_ref().ok_or("写入后未读取到完整 Codex 中转配置")?;
        if relay.url != relay_url || relay.key != relay_key || relay.provider != provider_name { return Err("写入后的 Codex 中转配置与预期不一致".into()); }
        Ok(snapshot)
    })();
    if let Err(error) = result {
        let rollback = restore_remote_file(&session, &config_path, original_config.as_deref())
            .and_then(|_| restore_remote_file(&session, &auth_path, original_auth.as_deref()))
            .and_then(|_| restore_remote_file(&session, &env_path, original_env.as_deref()))
            .and_then(|_| restore_remote_file(&session, &bashrc_path, original_bashrc.as_deref()));
        return Err(match rollback { Ok(()) => format!("同步失败，已恢复远端配置：{error}"), Err(rollback) => format!("同步失败且恢复远端配置失败：{error}；{rollback}") });
    }
    result
}

fn auth_json_api_key(auth_json: &str, env_key: &str) -> Option<String> {
    let auth = serde_json::from_str::<Value>(auth_json).ok()?;
    auth.get(env_key).and_then(Value::as_str)
        .or_else(|| auth.get("env").and_then(|env| env.get(env_key)).and_then(Value::as_str))
        .or_else(|| (env_key == "OPENAI_API_KEY").then(|| auth.get("api_key")).flatten().and_then(Value::as_str))
        .filter(|key| !key.trim().is_empty())
        .map(str::to_string)
}

fn codex_relay_config(config: &str, auth_json: &str, environment: &HashMap<String, String>, requested_provider: Option<&str>) -> Option<CodexRelayConfig> {
    let document = config.parse::<toml::Value>().ok()?;
    let root = document.as_table()?;
    let providers = root.get("model_providers").and_then(toml::Value::as_table)?;
    let provider_name = requested_provider.filter(|name| providers.contains_key(*name))
        .or_else(|| root.get("model_provider").and_then(toml::Value::as_str).filter(|name| providers.contains_key(*name)))
        .or_else(|| providers.iter().find_map(|(name, value)| value.get("base_url").and_then(toml::Value::as_str).is_some().then_some(name.as_str())))?;
    let provider = providers.get(provider_name)?.as_table()?;
    let url = provider.get("base_url").and_then(toml::Value::as_str)?.trim();
    if url.is_empty() { return None; }
    let env_key = provider.get("env_key").and_then(toml::Value::as_str).unwrap_or("OPENAI_API_KEY");
    let key = provider.get("experimental_bearer_token").and_then(toml::Value::as_str).filter(|key| !key.starts_with('$'))
        .map(str::to_string)
        .or_else(|| provider.get("api_key").and_then(toml::Value::as_str).filter(|key| !key.starts_with('$')).map(str::to_string))
        .or_else(|| environment.get(env_key).cloned())
        .or_else(|| auth_json_api_key(auth_json, env_key))
        .or_else(|| environment.get("OPENAI_API_KEY").cloned())?;
    (!key.trim().is_empty()).then(|| CodexRelayConfig { url: url.to_string(), key, provider: provider_name.to_string() })
}

fn fetch_codex_relay_config(server: &RemoteServer, operation: Option<&RemoteOperationGuard>) -> Result<RemoteCodexSnapshot, String> {
    ensure_remote_operation_active(operation)?;
    let session = remote_session(server, operation)?;
    let host_key_fingerprint = host_key_fingerprint(&session)?;
    let home = remote_home(&session)?;
    let config = read_remote_file(&session, &format!("{home}/.codex/config.toml"))?;
    let auth = read_remote_file(&session, &format!("{home}/.codex/auth.json"))?;
    ensure_remote_operation_active(operation)?;
    let relay = config.as_deref().and_then(|config| codex_relay_config(config, auth.as_deref().unwrap_or_default(), &HashMap::new(), server.relay_provider.as_deref()));
    ensure_remote_operation_active(operation)?;
    let codex_version = remote_command(&session, "codex --version 2>/dev/null").ok().and_then(|(status, output)| (status == 0).then(|| output.trim().to_string())).filter(|version| !version.is_empty());
    let codex_latest_version = codex_version.as_ref().and_then(|_| remote_command(&session, "command -v npm >/dev/null 2>&1 && npm view @openai/codex version --silent 2>/dev/null").ok())
        .and_then(|(status, output)| (status == 0).then(|| output.trim().to_string())).filter(|version| !version.is_empty());
    let codex_update_available = codex_update_available(codex_version.as_deref(), codex_latest_version.as_deref());
    Ok(RemoteCodexSnapshot { relay, codex_version, codex_latest_version, codex_update_available, host_key_fingerprint, config_fingerprint: config_fingerprint(config.as_deref(), auth.as_deref()) })
}

fn install_or_update_remote_codex(server: &RemoteServer, operation: Option<&RemoteOperationGuard>) -> Result<RemoteCodexSnapshot, String> {
    ensure_remote_operation_active(operation)?;
    let session = remote_session(server, operation)?;
    session.set_timeout(180_000);
    let bootstrap = "if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then if ! command -v apt-get >/dev/null 2>&1; then echo 'Node.js/npm is missing and this server does not provide apt-get'; exit 126; fi; if [ \"$(id -u)\" -eq 0 ]; then apt-get update && apt-get install -y nodejs npm; elif command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then sudo -n apt-get update && sudo -n apt-get install -y nodejs npm; else echo 'Node.js/npm is missing; log in as root or grant passwordless sudo for apt-get'; exit 126; fi; fi; node --version && npm --version";
    let (status, output) = remote_command(&session, &format!("timeout 150 sh -c {} 2>&1", shell_quote(bootstrap)))?;
    ensure_remote_operation_active(operation)?;
    if status != 0 {
        let detail = output.trim();
        return Err(if detail.is_empty() { format!("Node.js/npm 准备失败，退出码 {status}") } else { format!("Node.js/npm 准备失败：{detail}") });
    }
    let (status, output) = remote_command(&session, "timeout 150 npm install -g @openai/codex@latest 2>&1")?;
    ensure_remote_operation_active(operation)?;
    if status != 0 {
        let detail = output.trim();
        return Err(if detail.is_empty() { format!("Codex 安装失败，退出码 {status}") } else { format!("Codex 安装失败：{detail}") });
    }
    let snapshot = fetch_codex_relay_config(server, operation)?;
    if snapshot.codex_version.is_none() { return Err("npm 已完成，但当前 SSH 环境仍无法执行 codex；请确认 npm 全局 bin 目录已在 PATH 中".into()); }
    Ok(snapshot)
}

fn apply_codex_relay_config(server: &mut RemoteServer, relay: CodexRelayConfig) -> Result<(), String> {
    remote_relay_key_entry(&server.id)?.set_password(&relay.key).map_err(|error| error.to_string())?;
    server.relay_url = Some(relay.url);
    server.relay_provider = Some(relay.provider);
    server.relay_key_source = Some("Ubuntu Codex CLI".into());
    server.relay_key_masked = Some(mask_secret(&relay.key));
    Ok(())
}

fn apply_remote_snapshot(server: &mut RemoteServer, snapshot: RemoteCodexSnapshot) -> Result<(), String> {
    server.host_key_fingerprint = Some(snapshot.host_key_fingerprint);
    server.relay_config_fingerprint = Some(snapshot.config_fingerprint);
    server.codex_version = snapshot.codex_version;
    server.codex_latest_version = snapshot.codex_latest_version;
    server.codex_update_available = snapshot.codex_update_available;
    server.last_synced_at = Some(now());
    match snapshot.relay {
        Some(relay) => {
            apply_codex_relay_config(server, relay)?;
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

fn test_and_read_remote_server(server: &RemoteServer, operation: Option<&RemoteOperationGuard>) -> (RemoteConnectionResult, Option<RemoteCodexSnapshot>) {
    match fetch_codex_relay_config(server, operation) {
        Ok(relay) => (RemoteConnectionResult { success: true, status: "online".into(), code: None, reason: None, host_key_fingerprint: Some(relay.host_key_fingerprint.clone()), requires_host_key_confirmation: false }, Some(relay)),
        Err(reason) => (RemoteConnectionResult { success: false, status: "error".into(), code: None, reason: Some(reason), host_key_fingerprint: None, requires_host_key_confirmation: false }, None),
    }
}

fn verify_remote_codex_session(server: &RemoteServer, operation: Option<&RemoteOperationGuard>) -> RemoteConnectionResult {
    let result = (|| -> Result<(), String> {
        ensure_remote_operation_active(operation)?;
        let session = remote_session(server, operation)?;
        session.set_timeout(120_000);
        let prompt = "Reply with exactly RELAYHUB_SESSION_OK and no other text.";
        let command = format!("exec timeout 90 codex exec --skip-git-repo-check {} 2>&1", shell_quote(prompt));
        let (status, output) = remote_command(&session, &format!("bash -lc {}", shell_quote(&command)))?;
        if status != 0 { return Err(if status == 124 { "Codex CLI 会话验证超时".into() } else { "Codex CLI 会话验证失败".into() }); }
        if !output.contains("RELAYHUB_SESSION_OK") { return Err("Codex CLI 未返回预期会话响应".into()); }
        Ok(())
    })();
    match result {
        Ok(()) => RemoteConnectionResult { success: true, status: "online".into(), code: None, reason: None, host_key_fingerprint: server.host_key_fingerprint.clone(), requires_host_key_confirmation: false },
        Err(reason) => RemoteConnectionResult { success: false, status: "error".into(), code: None, reason: Some(reason), host_key_fingerprint: server.host_key_fingerprint.clone(), requires_host_key_confirmation: false },
    }
}

fn routing_mode_from_setting(value: Option<String>) -> RoutingMode {
    if value.as_deref() == Some("localGateway") { RoutingMode::LocalGateway } else { RoutingMode::CcSwitch }
}
fn routing_mode_setting(mode: &RoutingMode) -> &'static str {
    match mode { RoutingMode::CcSwitch => "ccSwitch", RoutingMode::LocalGateway => "localGateway" }
}
fn load_gateway_settings(store: &Store) -> Result<(RoutingMode, u16), String> {
    let mode = routing_mode_from_setting(store.setting("routingMode")?);
    let port = store.setting("gatewayPort")?.and_then(|value| value.parse::<u16>().ok()).filter(|port| *port > 0).unwrap_or(DEFAULT_GATEWAY_PORT);
    store.save_setting("routingMode", routing_mode_setting(&mode))?;
    store.save_setting("gatewayPort", &port.to_string())?;
    Ok((mode, port))
}
fn current_routing_mode(state: &AppState) -> Result<RoutingMode, String> {
    let store = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?;
    Ok(routing_mode_from_setting(store.setting("routingMode")?))
}

async fn set_tray_routing_mode(app: AppHandle, mode: RoutingMode) -> Result<(), String> {
    let state = app.state::<AppState>();
    match mode {
        RoutingMode::CcSwitch => {
            state.gateway.stop();
            state.gateway.clear_route().await;
        }
        RoutingMode::LocalGateway => {
            if state.gateway.runtime_snapshot().await.route.is_none() {
                let _ = restore_persisted_gateway_route(&state).await;
            }
            state.gateway.start().await?;
        }
    }
    let result = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.save_setting("routingMode", routing_mode_setting(&mode));
    result
}

async fn set_gateway_route(state: &AppState, station_id: String, key_id: String) -> Result<(), String> {
    if current_routing_mode(state)? != RoutingMode::LocalGateway { return Err("请先切换到本地稳定入口模式".into()); }
    let (station, api_key) = read_api_key(state, &station_id, &key_id).await?;
    state.gateway.set_route(GatewayRoute { station_id: station_id.clone(), key_id: key_id.clone(), upstream_base_url: api_base_url(&station.base_url), api_key }).await;
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.save_setting("activeGatewayStationId", &station_id)?;
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.save_setting("activeGatewayKeyId", &key_id)?;
    state.gateway.start().await
}

fn tray_balance_label(balance: Option<f64>) -> String {
    balance.map(|value| format!("余额 · {value:.2}")).unwrap_or_else(|| "余额 · --".into())
}

fn tray_rate_label(rate: &GroupRate) -> String {
    match (rate.input_multiplier, rate.output_multiplier) {
        (Some(input), Some(output)) => format!("{} · {} · ×{:.2}（输入 ×{input:.2} / 输出 ×{output:.2}）", rate.group, rate.model, rate.multiplier),
        _ => format!("{} · {} · ×{:.2}", rate.group, rate.model, rate.multiplier),
    }
}
impl GatewayController {
    fn new(client: Client, token: String, port: u16) -> Self {
        Self { runtime: Arc::new(RwLock::new(GatewayRuntime { token, port, route: None })), client, shutdown: Mutex::new(None) }
    }

    fn is_running(&self) -> bool { self.shutdown.lock().map(|guard| guard.is_some()).unwrap_or(false) }

    async fn start(&self) -> Result<(), String> {
        if self.is_running() { return Ok(()); }
        let port = self.runtime.read().await.port;
        let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port))).await
            .map_err(|error| format!("无法监听 127.0.0.1:{port}：{error}"))?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let mut guard = self.shutdown.lock().map_err(|_| "本地网关状态不可用".to_string())?;
        if guard.is_some() { return Ok(()); }
        *guard = Some(shutdown_tx);
        drop(guard);

        let app = Router::new()
            .route("/v1", any(gateway_proxy))
            .route("/v1/{*path}", any(gateway_proxy))
            .with_state(GatewayServiceState { runtime: self.runtime.clone(), client: self.client.clone() });
        tauri::async_runtime::spawn(async move {
            let _ = axum::serve(listener, app).with_graceful_shutdown(async { let _ = shutdown_rx.await; }).await;
        });
        Ok(())
    }

    fn stop(&self) {
        if let Ok(mut guard) = self.shutdown.lock() {
            if let Some(sender) = guard.take() { let _ = sender.send(()); }
        }
    }

    async fn set_port(&self, port: u16) { self.runtime.write().await.port = port; }
    async fn set_route(&self, route: GatewayRoute) { self.runtime.write().await.route = Some(route); }
    async fn clear_route(&self) { self.runtime.write().await.route = None; }
    async fn rotate_token(&self, token: String) { self.runtime.write().await.token = token; }
    async fn runtime_snapshot(&self) -> GatewayRuntime { self.runtime.read().await.clone() }
}

fn gateway_error(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (status, axum::Json(json!({ "error": { "message": message.into(), "type": "relayhub_gateway_error", "code": code } }))).into_response()
}

fn gateway_request_authorized(headers: &HeaderMap, token: &str) -> bool {
    headers.get(header::AUTHORIZATION).and_then(|value| value.to_str().ok()).is_some_and(|value| value.strip_prefix("Bearer ") == Some(token))
}

fn is_hop_by_hop_header(name: &HeaderName) -> bool {
    matches!(name.as_str().to_ascii_lowercase().as_str(), "connection" | "keep-alive" | "proxy-authenticate" | "proxy-authorization" | "te" | "trailer" | "transfer-encoding" | "upgrade")
}

fn gateway_upstream_url(upstream_base_url: &str, uri: &axum::http::Uri) -> Result<String, String> {
    let path_and_query = uri.path_and_query().map(|value| value.as_str()).unwrap_or("/v1");
    let suffix = path_and_query.strip_prefix("/v1").ok_or("网关仅支持 /v1 请求")?;
    let target = format!("{}{}", upstream_base_url.trim_end_matches('/'), suffix);
    Url::parse(&target).map_err(|_| "活跃路由的上游地址无效".to_string())?;
    Ok(target)
}

async fn gateway_proxy(
    AxumState(state): AxumState<GatewayServiceState>,
    OriginalUri(uri): OriginalUri,
    request: Request<Body>,
) -> Response {
    let (parts, body) = request.into_parts();
    let snapshot = state.runtime.read().await.clone();
    if !gateway_request_authorized(&parts.headers, &snapshot.token) {
        return gateway_error(StatusCode::UNAUTHORIZED, "invalid_api_key", "本地网关令牌无效或缺失");
    }
    let route = match snapshot.route {
        Some(route) => route,
        None => return gateway_error(StatusCode::SERVICE_UNAVAILABLE, "no_active_route", "尚未为本地网关选择活跃路由"),
    };
    let target = match gateway_upstream_url(&route.upstream_base_url, &uri) {
        Ok(target) => target,
        Err(error) => return gateway_error(StatusCode::SERVICE_UNAVAILABLE, "invalid_route", error),
    };
    let payload = match to_bytes(body, 64 * 1024 * 1024).await {
        Ok(payload) => payload,
        Err(_) => return gateway_error(StatusCode::PAYLOAD_TOO_LARGE, "request_too_large", "请求体超过本地网关 64 MB 限制"),
    };
    let mut outbound = state.client.request(parts.method, target).bearer_auth(route.api_key).body(payload);
    for (name, value) in &parts.headers {
        if name == header::AUTHORIZATION || name == header::HOST || name == header::CONTENT_LENGTH || is_hop_by_hop_header(name) { continue; }
        outbound = outbound.header(name.clone(), value.clone());
    }
    let upstream = match outbound.send().await {
        Ok(response) => response,
        Err(error) => return gateway_error(StatusCode::BAD_GATEWAY, "upstream_unavailable", format!("上游请求失败：{error}")),
    };
    let status = upstream.status();
    let headers = upstream.headers().clone();
    let mut response = Response::builder().status(status);
    if let Some(output_headers) = response.headers_mut() {
        for (name, value) in &headers {
            if name == header::CONTENT_LENGTH || is_hop_by_hop_header(name) { continue; }
            output_headers.append(name.clone(), value.clone());
        }
    }
    response.body(Body::from_stream(upstream.bytes_stream())).unwrap_or_else(|_| gateway_error(StatusCode::BAD_GATEWAY, "response_build_failed", "无法创建上游响应"))
}
fn title_from_html(html: &str) -> Option<String> {
    let lower = html.to_lowercase();
    let start = lower.find("<title")?;
    let content_start = lower[start..].find('>')? + start + 1;
    let end = lower[content_start..].find("</title>")? + content_start;
    let title = html[content_start..end].split_whitespace().collect::<Vec<_>>().join(" ");
    (!title.is_empty()).then_some(title)
}
fn endpoint(station: &Station, path: &str) -> String { format!("{}{}", base(&station.base_url), path) }
fn data(value: &Value) -> &Value { value.get("data").unwrap_or(value) }

async fn request(client: &Client, station: &Station, token: Option<&str>, newapi_user_id: Option<&str>, newapi_session: Option<&str>, method: Method, path: &str, body: Option<Value>) -> Result<Value, String> {
    let mut call = client.request(method, endpoint(station, path)).timeout(std::time::Duration::from_secs(15));
    if station.kind == "newapi" {
        if let Some(user_id) = newapi_user_id { call = call.header("New-Api-User", user_id); }
        if let Some(session) = newapi_session { call = call.header(header::COOKIE, session); }
    } else if let Some(token) = token { call = call.bearer_auth(token); }
    if let Some(body) = body { call = call.json(&body); }
    let response = call.send().await.map_err(|e| format!("请求失败：{}", e))?;
    let status = response.status();
    let value = response.json::<Value>().await.map_err(|_| format!("HTTP {status}: 站点返回了无法识别的数据"))?;
    if !status.is_success() || value.get("success") == Some(&Value::Bool(false)) || value.get("code") == Some(&json!(-1)) {
        return Err(format!("HTTP {status}: {}", value.get("message").and_then(Value::as_str).unwrap_or("站点拒绝了请求")));
    }
    Ok(value)
}

async fn detect_kind(client: &Client, url: &str) -> Result<String, String> {
    let temp = Station { id: String::new(), name: String::new(), base_url: base(url), kind: "auto".into(), status: String::new(), last_synced_at: None, last_error: None };
    if request(client, &temp, None, None, None, Method::GET, "/api/v1/settings/public", None).await.is_ok() { return Ok("sub2api".into()); }
    if request(client, &temp, None, None, None, Method::GET, "/api/status", None).await.is_ok() { return Ok("newapi".into()); }
    Err("未识别为 New API 或 Sub2API，请确认网址和站点可访问性".into())
}

#[tauri::command]
async fn probe_station(state: State<'_, AppState>, base_url: String) -> Result<StationProbe, String> {
    let parsed = Url::parse(&base_url).map_err(|_| "请输入有效站点地址")?;
    if parsed.scheme() != "https" { return Err("仅允许 HTTPS 站点地址".into()); }
    let fallback = parsed.host_str().unwrap_or("未命名站点").to_string();
    let page = state.client.get(base(&base_url)).timeout(std::time::Duration::from_secs(10)).send().await.ok();
    let name = match page {
        Some(response) => response.text().await.ok().and_then(|html| title_from_html(&html)).unwrap_or(fallback),
        None => fallback,
    };
    Ok(StationProbe { name, kind: detect_kind(&state.client, &base_url).await.ok() })
}

fn session_cookie(headers: &HeaderMap) -> Option<String> {
    headers.get_all(header::SET_COOKIE).iter().find_map(|value| {
        let cookie = value.to_str().ok()?.split(';').next()?.trim();
        cookie.starts_with("session=").then(|| cookie.to_string())
    })
}

async fn login_request(client: &Client, station: &Station, path: &str, body: Value) -> Result<(Value, Option<String>), String> {
    let response = client.post(endpoint(station, path)).timeout(std::time::Duration::from_secs(15)).json(&body).send().await.map_err(|e| format!("请求失败：{e}"))?;
    let status = response.status();
    let session = session_cookie(response.headers());
    let value = response.json::<Value>().await.map_err(|_| format!("站点返回了无法识别的数据 ({status})"))?;
    if !status.is_success() || value.get("success") == Some(&Value::Bool(false)) || value.get("code") == Some(&json!(-1)) {
        return Err(value.get("message").and_then(Value::as_str).unwrap_or("站点拒绝了请求").to_string());
    }
    Ok((value, session))
}

async fn authenticate(client: &Client, station: &Station, secret: &mut Secret, totp: Option<&str>) -> Result<(), String> {
    let adapter = StationAdapter::for_station(station)?;
    let (login, login_session) = login_request(client, station, adapter.login_path(), adapter.login_body(&secret.username, &secret.password)).await?;
    let (authentication, session) = if data(&login).get("require_2fa").and_then(Value::as_bool).unwrap_or(false) {
        let code = totp.ok_or("该站点需要 TOTP 验证码")?;
        let (verify, verify_session) = login_request(client, station, adapter.login_2fa_path(), json!({"flow_token": data(&login)["flow_token"], "code": code, "totp": code})).await?;
        (verify, verify_session.or(login_session))
    } else { (login, login_session) };
    let authentication_data = data(&authentication);
    copy_tokens(secret, authentication_data);
    if station.kind == "newapi" {
        secret.newapi_user_id = authentication_data.get("id").and_then(|id| id.as_str().map(str::to_string).or_else(|| id.as_i64().map(|id| id.to_string())));
        secret.newapi_session = session;
        if secret.newapi_user_id.is_none() { return Err("登录成功，但站点未返回用户标识".into()); }
        if secret.newapi_session.is_none() { return Err("登录成功，但站点未返回可保存的会话".into()); }
    } else if secret.access_token.is_none() { return Err("登录成功，但站点未返回可保存的登录令牌".into()); }
    Ok(())
}

async fn load_authenticated_secret(state: &AppState, station: &Station) -> Result<Secret, String> {
    let mut secret = load_secret(&station.id)?;
    if (station.kind == "newapi" && (secret.newapi_user_id.is_none() || secret.newapi_session.is_none())) || (station.kind != "newapi" && secret.access_token.is_none()) {
        refresh_session(state, station, &mut secret, None, false).await?;
    }
    Ok(secret)
}

fn is_unauthorized(error: &str) -> bool { error.starts_with("HTTP 401:") }

async fn refresh_session(state: &AppState, station: &Station, secret: &mut Secret, totp: Option<&str>, bypass_backoff: bool) -> Result<(), String> {
    if !bypass_backoff {
        if let Some(backoff) = state.auth_backoff.lock().map_err(|_| "认证状态不可用".to_string())?.get(&station.id) {
            if backoff.retry_after > now() { return Err(format!("自动登录暂缓 {} 秒", backoff.retry_after - now())); }
        }
    }
    match authenticate(&state.client, station, secret, totp).await {
        Ok(()) => {
            state.auth_backoff.lock().map_err(|_| "认证状态不可用".to_string())?.remove(&station.id);
            save_secret(&station.id, secret)
        }
        Err(error) => {
            let mut backoff = state.auth_backoff.lock().map_err(|_| "认证状态不可用".to_string())?;
            let attempts = backoff.get(&station.id).map(|value| value.attempts.saturating_add(1)).unwrap_or(1).min(6);
            let delay = 30_i64 * (1_i64 << (attempts - 1));
            backoff.insert(station.id.clone(), AuthBackoff { attempts, retry_after: now() + delay });
            Err(error)
        }
    }
}

async fn station_request(state: &AppState, station: &Station, secret: &mut Secret, method: Method, path: &str, body: Option<Value>) -> Result<Value, String> {
    let response = request(&state.client, station, secret.access_token.as_deref(), secret.newapi_user_id.as_deref(), secret.newapi_session.as_deref(), method.clone(), path, body.clone()).await;
    if station.kind == "newapi" && response.as_ref().err().is_some_and(|error| is_unauthorized(error)) {
        refresh_session(state, station, secret, None, false).await?;
        return request(&state.client, station, secret.access_token.as_deref(), secret.newapi_user_id.as_deref(), secret.newapi_session.as_deref(), method, path, body).await;
    }
    response
}

async fn fetch_all_pages(state: &AppState, station: &Station, secret: &mut Secret, adapter: StationAdapter, resource: PagedResource) -> Result<Value, String> {
    let page_size = 100_i64;
    let mut page = adapter.first_page();
    let mut items = Vec::new();
    loop {
        let path = adapter.paged_path(resource, page, page_size);
        let value = station_request(state, station, secret, Method::GET, &path, None).await?;
        let root = data(&value);
        let page_items = root.get("items").or_else(|| root.get("records")).and_then(Value::as_array).cloned().unwrap_or_default();
        let count = page_items.len();
        items.extend(page_items);
        let total = integer(root, &["total"]);
        if count == 0 || count < page_size as usize || total.is_some_and(|total| items.len() as i64 >= total) { break; }
        tokio::time::sleep(Duration::from_millis(100)).await;
        page += 1;
    }
    Ok(json!({"data": {"items": items}}))
}

fn copy_tokens(secret: &mut Secret, value: &Value) {
    secret.access_token = value.get("access_token").or_else(|| value.get("accessToken")).and_then(Value::as_str).map(str::to_string);
    secret.refresh_token = value.get("refresh_token").or_else(|| value.get("refreshToken")).and_then(Value::as_str).map(str::to_string);
}

fn number(value: &Value, names: &[&str]) -> Option<f64> { names.iter().find_map(|name| value.get(*name).and_then(Value::as_f64)) }
fn string(value: &Value, names: &[&str]) -> String { names.iter().find_map(|name| value.get(*name).and_then(Value::as_str)).unwrap_or_default().to_string() }
fn optional_string(value: &Value, names: &[&str]) -> Option<String> { names.iter().find_map(|name| value.get(*name).and_then(Value::as_str)).map(str::trim).filter(|value| !value.is_empty()).map(str::to_string) }
fn scalar_string(value: &Value, names: &[&str]) -> String {
    names.iter().find_map(|name| value.get(*name)).and_then(|value| match value {
        Value::String(value) => Some(value.clone()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }).unwrap_or_default()
}
fn optional_scalar_string(value: &Value, names: &[&str]) -> Option<String> {
    let value = scalar_string(value, names);
    (!value.trim().is_empty()).then_some(value)
}
fn integer(value: &Value, names: &[&str]) -> Option<i64> {
    names.iter().find_map(|name| value.get(*name).and_then(Value::as_i64).or_else(|| value.get(*name).and_then(Value::as_u64).and_then(|n| i64::try_from(n).ok())))
}

fn records(value: &Value) -> Vec<&Value> {
    let root = data(value);
    root.get("items").or_else(|| root.get("records")).or_else(|| root.get("logs")).or_else(|| root.get("data"))
        .and_then(Value::as_array).map(|items| items.iter()).into_iter().flatten().collect()
}

fn start_of_today() -> i64 {
    let local = Local::now();
    Local.with_ymd_and_hms(local.year(), local.month(), local.day(), 0, 0, 0).earliest().unwrap_or(local).timestamp()
}

fn timestamp(value: &Value) -> Option<i64> {
    integer(value, &["created_at", "createdAt", "timestamp", "time"]).map(|time| if time > 10_000_000_000 { time / 1_000 } else { time })
}

fn usage_from_profile(value: &Value) -> UsageStats {
    let profile = data(value);
    UsageStats {
        today_input_tokens: integer(profile, &["today_prompt_tokens", "today_input_tokens", "prompt_tokens_today"]),
        today_output_tokens: integer(profile, &["today_completion_tokens", "today_output_tokens", "completion_tokens_today"]),
        today_requests: integer(profile, &["today_request_count", "today_requests", "request_count_today"]),
        total_requests: integer(profile, &["request_count", "total_requests", "requests"]),
        today_spent: number(profile, &["today_used_quota", "today_spent", "today_usage"]),
        today_limit: number(profile, &["daily_quota", "today_quota", "today_limit"]),
        total_spent: number(profile, &["used_quota", "total_used_quota", "total_spent", "usage"]),
        total_limit: number(profile, &["total_quota", "quota_total", "total_limit"]),
    }
}

fn usage_from_logs(value: &Value, since: i64) -> UsageStats {
    let logs = records(value).into_iter().filter(|item| timestamp(item).is_some_and(|time| time >= since)).collect::<Vec<_>>();
    if logs.is_empty() { return UsageStats { today_requests: Some(0), ..Default::default() }; }
    let sum_tokens = |names: &[&str]| logs.iter().filter_map(|item| integer(item, names)).sum::<i64>();
    let sum_cost = |names: &[&str]| logs.iter().filter_map(|item| number(item, names)).sum::<f64>();
    let has_cost = logs.iter().any(|item| number(item, &["quota", "cost", "used_quota", "usage"]).is_some());
    UsageStats {
        today_input_tokens: Some(sum_tokens(&["prompt_tokens", "input_tokens", "promptTokens"])),
        today_output_tokens: Some(sum_tokens(&["completion_tokens", "output_tokens", "completionTokens"])),
        today_requests: Some(logs.len() as i64),
        today_spent: has_cost.then(|| sum_cost(&["quota", "cost", "used_quota", "usage"])),
        ..Default::default()
    }
}

fn normalized_group(item: &Value) -> Option<String> {
    optional_scalar_string(item, &["group", "group_name"])
        .or_else(|| item.get("group").and_then(|group| optional_scalar_string(group, &["name", "group_name", "group_id", "id"])))
}

fn parse_usage_logs(value: &Value, station: &Station) -> Vec<UsageLog> {
    records(value).into_iter().map(|item| UsageLog {
        id: format!("{}-{}", station.id, scalar_string(item, &["id", "log_id", "request_id"])),
        station_id: station.id.clone(),
        station_name: station.name.clone(),
        station_url: station.base_url.clone(),
        api_key_name: optional_string(item, &["api_key_name", "key_name", "token_name"]),
        group_name: normalized_group(item),
        endpoint: optional_string(item, &["inbound_endpoint", "endpoint", "path", "request_path"]),
        ip_address: optional_string(item, &["ip_address", "ip", "client_ip"]),
        reasoning_effort: optional_string(item, &["reasoning_effort"]),
        billing_type: optional_string(item, &["billing_type"]),
        billing_mode: optional_string(item, &["billing_mode"]),
        model: string(item, &["model", "model_name", "requested_model"]),
        input_tokens: integer(item, &["prompt_tokens", "input_tokens", "promptTokens"]).unwrap_or(0),
        output_tokens: integer(item, &["completion_tokens", "output_tokens", "completionTokens"]).unwrap_or(0),
        cache_creation_tokens: integer(item, &["cache_creation_tokens", "cache_write_tokens"]).unwrap_or(0),
        cache_read_tokens: integer(item, &["cache_read_tokens", "cache_tokens"]).unwrap_or(0),
        actual_cost: number(item, &["actual_cost", "quota", "cost", "used_quota", "usage"]).unwrap_or(0.0),
        request_type: string(item, &["request_type", "type"]),
        duration_ms: integer(item, &["duration_ms", "duration"]),
        created_at: timestamp(item).unwrap_or_default(),
    }).collect()
}

fn merge_usage(profile: UsageStats, logs: UsageStats) -> UsageStats {
    UsageStats {
        today_input_tokens: logs.today_input_tokens.or(profile.today_input_tokens), today_output_tokens: logs.today_output_tokens.or(profile.today_output_tokens),
        today_requests: logs.today_requests.or(profile.today_requests), total_requests: profile.total_requests,
        today_spent: logs.today_spent.or(profile.today_spent), today_limit: profile.today_limit,
        total_spent: profile.total_spent, total_limit: profile.total_limit,
    }
}

fn sum_i64(values: impl Iterator<Item = Option<i64>>) -> Option<i64> {
    let mut found = false; let total = values.flatten().inspect(|_| found = true).sum(); found.then_some(total)
}

fn sum_f64(values: impl Iterator<Item = Option<f64>>) -> Option<f64> {
    let mut found = false; let total = values.flatten().inspect(|_| found = true).sum(); found.then_some(total)
}

fn map_rates(value: &Value) -> Vec<GroupRate> {
    let mut output = Vec::new();
    if let Some(map) = value.as_object() {
        for (group, item) in map {
            if let Some(multiplier) = item.as_f64() { output.push(GroupRate { group: group.clone(), model: "全部模型".into(), multiplier, input_multiplier: None, output_multiplier: None }); }
            if let Some(models) = item.as_object() { for (model, rate) in models { if let Some(multiplier) = rate.as_f64() { output.push(GroupRate { group: group.clone(), model: model.clone(), multiplier, input_multiplier: None, output_multiplier: None }); } } }
        }
    }
    output
}

fn normalize_key_status(adapter: StationAdapter, item: &Value) -> String {
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

fn normalize_key_quota(adapter: StationAdapter, item: &Value) -> (Option<f64>, Option<f64>, Option<f64>, bool) {
    let used = number(item, &["quota_used", "used_quota", "usage", "used"]);
    match adapter {
        StationAdapter::Sub2Api => match number(item, &["quota", "total_quota"]) {
            Some(total) if total > 0.0 => (Some((total - used.unwrap_or(0.0)).max(0.0)), Some(total), used, false),
            _ => (None, None, used, true),
        },
        StationAdapter::NewApi => {
            let unlimited = item.get("unlimited_quota").and_then(Value::as_bool).unwrap_or(false);
            let remaining = (!unlimited).then(|| number(item, &["remain_quota", "remaining_quota"])).flatten();
            let total = remaining.zip(used).map(|(remaining, used)| remaining + used);
            (remaining, total, used, unlimited)
        }
    }
}

fn parse_keys(value: &Value, adapter: StationAdapter) -> Vec<ApiKeyInfo> {
    let items = value.get("items").or_else(|| value.get("data").and_then(|d| d.get("items"))).or_else(|| value.get("data")).and_then(Value::as_array).cloned().unwrap_or_default();
    items.into_iter().map(|item| {
        let (remaining_quota, total_quota, used_quota, unlimited_quota) = normalize_key_quota(adapter, &item);
        ApiKeyInfo {
        id: scalar_string(&item, &["id", "key_id"]), name: string(&item, &["name", "label"]), masked_key: mask_api_key(&string(&item, &["key", "masked_key", "prefix"])),
        group: normalized_group(&item), status: normalize_key_status(adapter, &item),
        remaining_quota, total_quota, unlimited_quota,
        current_concurrency: item.get("current_concurrency").or_else(|| item.get("concurrency")).or_else(|| item.get("concurrency_limit")).and_then(Value::as_i64),
        used_quota,
        today_spent: number(&item, &["today_used_quota", "today_spent", "today_usage"]),
        last_30_days_spent: number(&item, &["last_30_days_used_quota", "last_30_days_spent", "monthly_used_quota", "month_used_quota"]),
        expires_at: item.get("expired_time").or_else(|| item.get("expires_at")).and_then(Value::as_i64),
        created_at: item.get("created_time").or_else(|| item.get("created_at")).and_then(Value::as_i64),
    }}).collect()
}

fn mask_api_key(value: &str) -> String {
    if value.is_empty() { return String::new(); }
    if value.contains("...") { return value.to_string(); }
    if value.len() > 10 { return format!("{}...{}", &value[..5], &value[value.len() - 4..]); }
    "已隐藏".into()
}

fn parse_balance(value: &Value) -> Option<f64> { number(data(value), &["quota", "balance", "remain_quota", "remaining_quota"]) }

fn parse_account(value: &Value) -> AccountInfo {
    let profile = data(value);
    AccountInfo {
        id: scalar_string(profile, &["id", "user_id", "userId"]),
        username: scalar_string(profile, &["username", "user_name"]),
        display_name: scalar_string(profile, &["display_name", "displayName", "nickname", "name"]),
        email: optional_string(profile, &["email"]),
        group: optional_string(profile, &["group", "group_name", "groupName"]),
        role: scalar_string(profile, &["role", "role_name", "roleName"]),
        status: scalar_string(profile, &["status"]),
        balance: parse_balance(value),
    }
}

fn parse_offers(value: &Value, station: &Station) -> Vec<Offer> {
    let list = data(value).as_array().cloned().unwrap_or_else(|| vec![data(value).clone()]);
    list.into_iter().filter_map(|item| {
        let title = string(&item, &["title", "name"]);
        let summary = string(&item, &["content", "description", "notice"]);
        if title.is_empty() && summary.is_empty() { return None; }
        Some(Offer { id: if string(&item, &["id"]).is_empty() { hash(&(title.clone() + &summary)) } else { string(&item, &["id"]) }, title: if title.is_empty() { "站点公告".into() } else { title }, summary, source_url: station.base_url.clone(), published_at: item.get("created_at").or_else(|| item.get("published_at")).and_then(Value::as_i64) })
    }).collect()
}

fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.trim().is_empty() => Some(text.trim().to_string()),
        Value::Array(items) => items.iter().find_map(value_text),
        Value::Object(_) => value.get("text").or_else(|| value.get("value")).and_then(value_text),
        _ => None,
    }
}

fn model_response_text(value: &Value) -> Option<String> {
    value.get("output_text").and_then(value_text)
        .or_else(|| value.pointer("/choices/0/message/content").and_then(value_text))
        .or_else(|| value.get("content").and_then(value_text))
        .or_else(|| value.get("output").and_then(Value::as_array).and_then(|output| output.iter().find_map(|item| item.get("content").and_then(value_text))))
}

fn response_error_message(body: &str) -> String {
    serde_json::from_str::<Value>(body).ok()
        .and_then(|value| value.get("error").and_then(|error| error.get("message").or(Some(error))).or_else(|| value.get("message")).and_then(value_text))
        .unwrap_or_else(|| body.chars().take(240).collect())
}

fn hash<T: Serialize>(value: &T) -> String { let bytes = serde_json::to_vec(value).unwrap_or_default(); format!("{:x}", Sha256::digest(bytes)) }

async fn fetch_snapshot(state: &AppState, station: &Station, secret: &mut Secret) -> Result<StationSnapshot, String> {
    let mut snapshot = StationSnapshot::default();
    let adapter = StationAdapter::for_station(station)?;
    snapshot.capabilities = adapter.capabilities();
    if adapter == StationAdapter::Sub2Api {
        let value = station_request(state, station, secret, Method::GET, adapter.profile_path(), None).await?;
        snapshot.station_balance = parse_balance(&value);
        snapshot.account = parse_account(&value);
        snapshot.usage = usage_from_profile(&value);
        if let Ok(value) = fetch_all_pages(state, station, secret, adapter, PagedResource::Usage).await {
            snapshot.usage = merge_usage(snapshot.usage, usage_from_logs(&value, start_of_today()));
        }
        let groups = station_request(state, station, secret, Method::GET, "/api/v1/groups/rates", None).await;
        match groups { Ok(value) => snapshot.rates = map_rates(data(&value)), Err(_) => snapshot.unavailable.push("分组倍率未公开或当前账户无权限".into()) }
        match fetch_all_pages(state, station, secret, adapter, PagedResource::Keys).await { Ok(value) => snapshot.api_keys = parse_keys(&value, adapter), Err(_) => snapshot.unavailable.push("API 密钥列表不可获取".into()) }
        match station_request(state, station, secret, Method::GET, "/api/v1/announcements", None).await { Ok(value) => snapshot.offers = parse_offers(&value, station), Err(_) => snapshot.unavailable.push("优惠公告不可获取".into()) }
    } else {
        let value = station_request(state, station, secret, Method::GET, adapter.profile_path(), None).await?;
        snapshot.station_balance = parse_balance(&value);
        snapshot.account = parse_account(&value);
        snapshot.usage = usage_from_profile(&value);
        if let Ok(value) = fetch_all_pages(state, station, secret, adapter, PagedResource::Usage).await {
            snapshot.usage = merge_usage(snapshot.usage, usage_from_logs(&value, start_of_today()));
        }
        let pricing = station_request(state, station, secret, Method::GET, "/api/pricing", None).await;
        match pricing { Ok(value) => snapshot.rates = map_rates(&data(&value)["group_ratio"]), Err(_) => snapshot.unavailable.push("分组倍率未公开或当前账户无权限".into()) }
        match fetch_all_pages(state, station, secret, adapter, PagedResource::Keys).await { Ok(value) => snapshot.api_keys = parse_keys(&value, adapter), Err(_) => snapshot.unavailable.push("API 密钥列表不可获取".into()) }
        let notice = station_request(state, station, secret, Method::GET, "/api/notice", None).await;
        if let Ok(value) = notice { snapshot.offers = parse_offers(&value, station); } else { snapshot.unavailable.push("优惠公告不可获取".into()); }
    }
    Ok(snapshot)
}

fn describe_changes(old: Option<&StationSnapshot>, new: &StationSnapshot) -> Vec<String> {
    let Some(old) = old else { return vec!["已建立首个站点快照".into()]; };
    let mut changes = Vec::new();
    if old.rates != new.rates { changes.push(format!("倍率更新：{} 条记录", new.rates.len())); }
    if old.api_keys != new.api_keys { changes.push(format!("API 密钥状态更新：{} 个", new.api_keys.len())); }
    let old_offers = old.offers.iter().map(|offer| &offer.id).collect::<BTreeSet<_>>();
    let new_count = new.offers.iter().filter(|offer| !old_offers.contains(&offer.id)).count();
    if new_count > 0 { changes.push(format!("发现 {new_count} 条新公告或优惠")); }
    changes
}

async fn sync_one(state: &AppState, id: &str) -> Result<SyncResult, String> {
    let mut station = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.get_station(id)?;
    let mut secret = load_authenticated_secret(state, &station).await?;
    let snapshot = fetch_snapshot(state, &station, &mut secret).await?;
    let fingerprint = hash(&snapshot);
    let old = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.load_snapshot(id)?;
    let changed = old.as_ref().map(|(previous, _)| previous != &fingerprint).unwrap_or(true);
    let change_summary = if changed { describe_changes(old.as_ref().map(|(_, snapshot)| snapshot), &snapshot) } else { Vec::new() };
    station.status = if snapshot.unavailable.len() == 3 { "partial".into() } else { "online".into() };
    station.last_synced_at = Some(now()); station.last_error = None;
    let store = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?;
    store.save_station(&station)?;
    if changed { store.save_snapshot(id, &fingerprint, &snapshot, &change_summary)?; }
    Ok(SyncResult { station, snapshot, changed, change_summary })
}

fn record_station_audit(state: &AppState, station_id: &str, action: &str, detail: &str) {
    if let Ok(store) = state.store.lock() { let _ = store.record_audit(station_id, action, "success", detail); }
}

#[tauri::command]
async fn add_station(state: State<'_, AppState>, request: AddStationRequest) -> Result<StationSaveResult, String> {
    let parsed = Url::parse(&request.base_url).map_err(|_| "请输入有效站点地址")?;
    if parsed.scheme() != "https" { return Err("仅允许 HTTPS 站点地址".into()); }
    let kind = if request.kind == "auto" { detect_kind(&state.client, &request.base_url).await? } else { request.kind };
    if kind != "newapi" && kind != "sub2api" { return Err("仅支持 New API 和 Sub2API".into()); }
    let mut station = Station { id: Uuid::new_v4().to_string(), name: if request.name.trim().is_empty() { parsed.host_str().unwrap_or("未命名站点").to_string() } else { request.name.trim().to_string() }, base_url: base(&request.base_url), kind, status: "connecting".into(), last_synced_at: None, last_error: None };
    let mut secret = Secret { username: request.username, password: request.password, access_token: None, refresh_token: None, newapi_user_id: None, newapi_session: None };
    let connection = match authenticate(&state.client, &station, &mut secret, request.totp.as_deref()).await {
        Ok(()) => StationConnectionResult { success: true, status: "online".into(), reason: None },
        Err(reason) => {
            station.status = "error".into();
            return Ok(StationSaveResult { station, connection: StationConnectionResult { success: false, status: "error".into(), reason: Some(reason) } });
        }
    };
    save_secret(&station.id, &secret)?;
    station.status = "online".into();
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.save_station(&station)?;
    Ok(StationSaveResult { station, connection })
}

#[tauri::command]
fn list_stations(state: State<'_, AppState>) -> Result<Vec<Station>, String> { state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.list_stations() }

#[tauri::command]
fn list_login_profiles(state: State<'_, AppState>) -> Result<Vec<LoginProfile>, String> { state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.list_login_profiles() }

#[tauri::command]
fn get_login_profile(state: State<'_, AppState>, id: String) -> Result<LoginProfileSecret, String> {
    let profiles = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.list_login_profiles()?;
    if !profiles.iter().any(|profile| profile.id == id) { return Err("未找到该账号配置".into()); }
    load_login_profile_secret(&id)
}

#[tauri::command]
fn save_login_profile(state: State<'_, AppState>, request: LoginProfileRequest) -> Result<LoginProfile, String> {
    if request.name.trim().is_empty() || request.username.trim().is_empty() || request.password.is_empty() { return Err("账号名称、用户名和密码不能为空".into()); }
    let profile = LoginProfile { id: request.id.filter(|id| !id.trim().is_empty()).unwrap_or_else(|| Uuid::new_v4().to_string()), name: request.name.trim().to_string(), username: request.username.trim().to_string() };
    save_login_profile_secret(&profile.id, &profile.username, &request.password)?;
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.save_login_profile(&profile)?;
    Ok(profile)
}

#[tauri::command]
fn delete_login_profile(state: State<'_, AppState>, id: String) -> Result<(), String> {
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.delete_login_profile(&id)?;
    clear_login_profile_secret(&id);
    Ok(())
}

#[tauri::command]
fn list_remote_servers(state: State<'_, AppState>) -> Result<Vec<RemoteServer>, String> {
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.list_remote_servers()
}

#[tauri::command]
fn list_remote_sync_logs(state: State<'_, AppState>, server_id: String) -> Result<Vec<RemoteSyncLog>, String> {
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.list_remote_sync_logs(&server_id)
}

#[tauri::command]
fn cancel_remote_server_operation(state: State<'_, AppState>, id: String) -> Result<(), String> {
    cancel_remote_operation(&state, &id)
}

#[tauri::command]
fn install_or_update_remote_codex_command(state: State<'_, AppState>, id: String, action: String) -> Result<RemoteServer, String> {
    if !matches!(action.as_str(), "install" | "update") { return Err("不支持的 Codex 操作".into()); }
    let _operation = acquire_remote_operation(&state, &id)?;
    let mut server = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.get_remote_server(&id)?;
    if action == "update" && server.codex_version.is_none() { return Err("服务器尚未检测到 Codex，请先安装".into()); }
    if action == "update" && !server.codex_update_available { return Err("当前未检测到可用更新，请先测试 SSH 连接刷新版本状态".into()); }
    let snapshot = match install_or_update_remote_codex(&server, Some(&_operation)) {
        Ok(snapshot) => snapshot,
        Err(error) => { record_remote_failure(&state, &mut server, &action, &error); return Err(error); }
    };
    apply_remote_snapshot(&mut server, snapshot)?;
    server.connection_status = "online".into();
    server.connection_error = None;
    server.updated_at = now();
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.save_remote_server(&server)?;
    add_remote_sync_log(&state, &server, "success", &action, if action == "install" { "已安装 Codex CLI 并完成版本校验" } else { "已更新 Codex CLI 并完成版本校验" });
    Ok(server)
}

#[tauri::command]
fn choose_private_key_file() -> Result<Option<String>, String> {
    Ok(rfd::FileDialog::new()
        .set_title("选择 SSH密匙文件")
        .add_filter("SSH密匙文件", &["pem", "ppk", "key"])
        .pick_file()
        .map(|path| path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn add_remote_server(state: State<'_, AppState>, request: AddRemoteServerRequest) -> Result<RemoteServerSaveResult, String> {
    if request.host.trim().is_empty() || request.username.trim().is_empty() { return Err("服务器 IP 和用户名不能为空".into()); }
    if request.port == 0 { return Err("SSH 端口必须介于 1 和 65535 之间".into()); }
    if !matches!(request.auth_type.as_str(), "password" | "key") { return Err("不支持的登录方式".into()); }
    if request.auth_type == "password" && request.password.as_deref().unwrap_or_default().is_empty() { return Err("请输入服务器密码".into()); }
    if request.auth_type == "key" && request.private_key_path.as_deref().unwrap_or_default().trim().is_empty() { return Err("请输入或选择 SSH密匙".into()); }
    let id = Uuid::new_v4().to_string();
    let name = if request.name.trim().is_empty() {
        let next = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.list_remote_servers()?.len() + 1;
        format!("服务器{next}")
    } else {
        request.name.trim().to_string()
    };
    let mut server = RemoteServer {
        id, name, host: request.host.trim().to_string(), port: request.port, username: request.username.trim().to_string(),
        auth_type: request.auth_type, private_key_path: request.private_key_path.filter(|value| !value.trim().is_empty()), codex_version: None, codex_latest_version: None, codex_update_available: false, host_key_fingerprint: request.host_key_fingerprint.filter(|value| !value.trim().is_empty()), relay_url: None, relay_provider: request.relay_provider.filter(|value| !value.trim().is_empty()), relay_key_source: None, relay_key_masked: None, relay_config_fingerprint: None, connection_status: "warning".into(), connection_error: None, last_synced_at: None, last_sync_status: None, last_sync_error: None, updated_at: now(),
    };
    if server.host_key_fingerprint.is_none() {
        let fingerprint = probe_remote_host_key(&server)?;
        server.host_key_fingerprint = Some(fingerprint.clone());
        return Ok(RemoteServerSaveResult {
            server,
            connection: RemoteConnectionResult { success: false, status: "warning".into(), code: None, reason: Some("请确认 SSH 主机指纹后再保存服务器".into()), host_key_fingerprint: Some(fingerprint), requires_host_key_confirmation: true },
        });
    }
    if server.auth_type == "password" {
        remote_server_entry(&server.id)?.set_password(request.password.as_deref().unwrap_or_default()).map_err(|e| e.to_string())?;
    }
    if server.auth_type == "key" {
        if let Some(passphrase) = request.private_key_passphrase.filter(|value| !value.is_empty()) {
            remote_key_passphrase_entry(&server.id)?.set_password(&passphrase).map_err(|e| e.to_string())?;
        }
    }
    let (connection, relay) = test_and_read_remote_server(&server, None);
    server.connection_status = connection.status.clone();
    server.connection_error = connection.reason.clone().map(|reason| match connection.code { Some(code) => format!("错误代码 {code}: {reason}"), None => reason });
    if !connection.success {
        if server.auth_type == "password" {
            if let Ok(entry) = remote_server_entry(&server.id) { let _ = entry.delete_credential(); }
        }
        if server.auth_type == "key" {
            if let Ok(entry) = remote_key_passphrase_entry(&server.id) { let _ = entry.delete_credential(); }
        }
        return Ok(RemoteServerSaveResult { server, connection });
    }
    if let Some(snapshot) = relay { apply_remote_snapshot(&mut server, snapshot)?; }
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.save_remote_server(&server)?;
    Ok(RemoteServerSaveResult { server, connection })
}

#[tauri::command]
fn update_remote_server(state: State<'_, AppState>, request: UpdateRemoteServerRequest) -> Result<RemoteServerSaveResult, String> {
    if request.host.trim().is_empty() || request.username.trim().is_empty() { return Err("服务器 IP 和用户名不能为空".into()); }
    if request.port == 0 { return Err("SSH 端口必须介于 1 和 65535 之间".into()); }
    if !matches!(request.auth_type.as_str(), "password" | "key") { return Err("不支持的登录方式".into()); }
    let _operation = acquire_remote_operation(&state, &request.id)?;
    let mut server = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.get_remote_server(&request.id)?;
    let password = request.password.unwrap_or_default();
    let private_key_path = request.private_key_path.unwrap_or_default();
    let has_saved_password = remote_server_entry(&server.id)?.get_password().map(|value| !value.trim().is_empty()).unwrap_or(false);
    if request.auth_type == "password" && password.trim().is_empty() && (server.auth_type != "password" || !has_saved_password) { return Err("未保存服务器密码，请重新输入后保存".into()); }
    if request.auth_type == "key" && private_key_path.trim().is_empty() { return Err("请输入或选择 SSH密匙".into()); }
    if request.auth_type == "password" && !password.trim().is_empty() {
        remote_server_entry(&server.id)?.set_password(&password).map_err(|e| e.to_string())?;
    }
    if request.auth_type == "key" && server.auth_type != "key" { let _ = remote_server_entry(&server.id)?.delete_credential(); }
    if request.auth_type == "key" {
        if let Some(passphrase) = request.private_key_passphrase.filter(|value| !value.is_empty()) {
            remote_key_passphrase_entry(&server.id)?.set_password(&passphrase).map_err(|e| e.to_string())?;
        }
    } else if server.auth_type == "key" { let _ = remote_key_passphrase_entry(&server.id)?.delete_credential(); }
    server.name = if request.name.trim().is_empty() { request.host.trim().to_string() } else { request.name.trim().to_string() };
    server.host = request.host.trim().to_string();
    server.port = request.port;
    server.username = request.username.trim().to_string();
    server.auth_type = request.auth_type;
    server.private_key_path = if server.auth_type == "key" { Some(private_key_path) } else { None };
    server.relay_provider = request.relay_provider.filter(|value| !value.trim().is_empty());
    let (connection, relay) = test_and_read_remote_server(&server, Some(&_operation));
    server.connection_status = connection.status.clone();
    server.connection_error = connection.reason.clone().map(|reason| match connection.code { Some(code) => format!("错误代码 {code}: {reason}"), None => reason });
    if let Some(snapshot) = relay { apply_remote_snapshot(&mut server, snapshot)?; }
    server.updated_at = now();
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.save_remote_server(&server)?;
    add_remote_sync_log(&state, &server, if connection.success { "success" } else { "error" }, "update", if connection.success { "服务器配置已更新并完成读取" } else { server.connection_error.as_deref().unwrap_or("服务器连接失败") });
    Ok(RemoteServerSaveResult { server, connection })
}

#[tauri::command]
fn delete_remote_server(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let _operation = acquire_remote_operation(&state, &id)?;
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.delete_remote_server(&id)?;
    if let Ok(entry) = remote_server_entry(&id) { let _ = entry.delete_credential(); }
    if let Ok(entry) = remote_key_passphrase_entry(&id) { let _ = entry.delete_credential(); }
    if let Ok(entry) = remote_relay_key_entry(&id) { let _ = entry.delete_credential(); }
    Ok(())
}

#[tauri::command]
fn test_remote_server(state: State<'_, AppState>, id: String) -> Result<RemoteConnectionResult, String> {
    let _operation = acquire_remote_operation(&state, &id)?;
    let mut server = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.get_remote_server(&id)?;
    let (connection, relay) = test_and_read_remote_server(&server, Some(&_operation));
    server.connection_status = connection.status.clone();
    server.connection_error = connection.reason.clone().map(|reason| match connection.code { Some(code) => format!("错误代码 {code}: {reason}"), None => reason });
    if let Some(snapshot) = relay { apply_remote_snapshot(&mut server, snapshot)?; }
    server.updated_at = now();
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.save_remote_server(&server)?;
    add_remote_sync_log(&state, &server, if connection.success { "success" } else { "error" }, "test", if connection.success { "SSH 连接和 Codex 配置读取成功" } else { server.connection_error.as_deref().unwrap_or("SSH 连接失败") });
    Ok(connection)
}

#[tauri::command]
fn verify_remote_codex_session_command(state: State<'_, AppState>, id: String) -> Result<RemoteConnectionResult, String> {
    let _operation = acquire_remote_operation(&state, &id)?;
    let mut server = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.get_remote_server(&id)?;
    let result = verify_remote_codex_session(&server, Some(&_operation));
    server.connection_status = result.status.clone();
    server.connection_error = result.reason.clone();
    server.last_synced_at = Some(now());
    server.last_sync_status = Some(if result.success { "verified".into() } else { "error".into() });
    server.last_sync_error = result.reason.clone();
    server.updated_at = now();
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.save_remote_server(&server)?;
    add_remote_sync_log(&state, &server, if result.success { "success" } else { "error" }, "session", if result.success { "Codex CLI 实际会话验证成功" } else { "Codex CLI 实际会话验证失败（错误详情已脱敏）" });
    Ok(result)
}

#[tauri::command]
async fn assign_remote_relay_key(state: State<'_, AppState>, server_id: String, station_id: String, key_id: String) -> Result<RemoteServer, String> {
    let (station, key) = read_api_key(&state, &station_id, &key_id).await?;
    let _operation = acquire_remote_operation(&state, &server_id)?;
    let mut server = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.get_remote_server(&server_id)?;
    let relay_url = base(&station.base_url);
    let previous_key = match replace_remote_relay_key(&server.id, &key) {
        Ok(previous_key) => previous_key,
        Err(error) => { record_remote_failure(&state, &mut server, "switch", &error); return Err(error); }
    };
    let snapshot = match write_codex_relay_config(&server, &relay_url, &key, Some(&_operation)) {
        Ok(snapshot) => snapshot,
        Err(error) => { restore_remote_relay_key(&server.id, previous_key.as_deref()); record_remote_failure(&state, &mut server, "switch", &error); return Err(error); }
    };
    server.relay_url = Some(relay_url);
    server.relay_key_source = Some(format!("{} / {}", station.name, key_id));
    server.relay_key_masked = Some(mask_secret(&key));
    apply_remote_snapshot(&mut server, snapshot)?;
    server.updated_at = now();
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.save_remote_server(&server)?;
    add_remote_sync_log(&state, &server, "success", "switch", "已将本地中转站密钥写入服务器 Codex CLI");
    Ok(server)
}

#[tauri::command]
fn update_remote_relay(state: State<'_, AppState>, request: UpdateRemoteRelayRequest) -> Result<RemoteServer, String> {
    let relay_url = request.relay_url.trim();
    if !relay_url.is_empty() {
        let parsed = Url::parse(relay_url).map_err(|_| "请输入有效的中转站地址")?;
        if !matches!(parsed.scheme(), "http" | "https") { return Err("中转站地址仅支持 HTTP 或 HTTPS".into()); }
    }
    let _operation = acquire_remote_operation(&state, &request.server_id)?;
    let mut server = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.get_remote_server(&request.server_id)?;
    let relay_key = request.relay_key.filter(|key| !key.trim().is_empty()).map(|key| key.trim().to_string())
        .or_else(|| remote_relay_key_entry(&server.id).ok().and_then(|entry| entry.get_password().ok()));
    if relay_key.is_some() && relay_url.is_empty() { return Err("请先填写中转站地址，再同步中转站密钥".into()); }
    if relay_url.is_empty() { return Err("请输入中转站地址".into()); }
    server.relay_provider = request.relay_provider.filter(|value| !value.trim().is_empty());
    let relay_key = relay_key.ok_or("未保存中转站密钥，请输入新密钥后同步")?;
    let previous_key = match replace_remote_relay_key(&server.id, &relay_key) {
        Ok(previous_key) => previous_key,
        Err(error) => { record_remote_failure(&state, &mut server, "manual", &error); return Err(error); }
    };
    let snapshot = match write_codex_relay_config(&server, relay_url, &relay_key, Some(&_operation)) {
        Ok(snapshot) => snapshot,
        Err(error) => { restore_remote_relay_key(&server.id, previous_key.as_deref()); record_remote_failure(&state, &mut server, "manual", &error); return Err(error); }
    };
    server.relay_url = (!relay_url.is_empty()).then(|| relay_url.to_string());
    server.relay_key_masked = Some(mask_secret(&relay_key));
    server.relay_key_source = None;
    apply_remote_snapshot(&mut server, snapshot)?;
    server.updated_at = now();
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.save_remote_server(&server)?;
    add_remote_sync_log(&state, &server, "success", "manual", "已将手动中转配置写入服务器 Codex CLI");
    Ok(server)
}

#[tauri::command]
async fn refresh_station(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<SyncResult, String> {
    let result = sync_one(&state, &id).await?;
    if result.changed { let _ = app.notification().builder().title(&result.station.name).body(result.change_summary.join("；")).show(); }
    Ok(result)
}

#[tauri::command]
async fn reauthenticate_station(state: State<'_, AppState>, id: String, totp: Option<String>) -> Result<SyncResult, String> {
    let station = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.get_station(&id)?;
    let mut secret = load_secret(&id)?;
    refresh_session(&state, &station, &mut secret, totp.as_deref(), true).await?;
    sync_one(&state, &id).await
}

#[tauri::command]
fn clear_station_session(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let mut secret = load_secret(&id)?;
    secret.newapi_session = None;
    secret.newapi_user_id = None;
    save_secret(&id, &secret)?;
    state.auth_backoff.lock().map_err(|_| "认证状态不可用".to_string())?.remove(&id);
    Ok(())
}

#[tauri::command]
async fn refresh_all(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<SyncResult>, String> {
    let stations = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.list_stations()?;
    let cancelled = Arc::new(AtomicBool::new(false));
    state.sync_operations.lock().map_err(|_| "同步状态不可用".to_string())?.insert("all".into(), cancelled.clone());
    state.sync_progress.lock().map_err(|_| "同步状态不可用".to_string())?.insert("all".into(), SyncProgress { operation_id: "all".into(), completed: 0, total: stations.len(), current_station: None, status: "running".into() });
    let mut results = Vec::new();
    for station in stations { if cancelled.load(Ordering::Relaxed) { break; } if let Ok(mut progress) = state.sync_progress.lock() { if let Some(progress) = progress.get_mut("all") { progress.current_station = Some(station.name.clone()); } } match sync_one(&state, &station.id).await { Ok(result) => { if result.changed { let _ = app.notification().builder().title(&result.station.name).body(result.change_summary.join("；")).show(); } results.push(result); }, Err(error) => {
        let mut failed = station.clone(); failed.status = "error".into(); failed.last_error = Some(error); let _ = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.save_station(&failed);
    } } if let Ok(mut progress) = state.sync_progress.lock() { if let Some(progress) = progress.get_mut("all") { progress.completed += 1; } } }
    if let Ok(mut progress) = state.sync_progress.lock() { if let Some(progress) = progress.get_mut("all") { progress.current_station = None; progress.status = if cancelled.load(Ordering::Relaxed) { "cancelled".into() } else { "completed".into() }; } }
    if let Ok(mut operations) = state.sync_operations.lock() { operations.remove("all"); }
    Ok(results)
}

#[tauri::command]
fn get_sync_progress(state: State<'_, AppState>) -> Result<Option<SyncProgress>, String> { Ok(state.sync_progress.lock().map_err(|_| "同步状态不可用".to_string())?.get("all").cloned()) }

#[tauri::command]
fn cancel_sync(state: State<'_, AppState>) -> Result<(), String> {
    let operations = state.sync_operations.lock().map_err(|_| "同步状态不可用".to_string())?;
    operations.get("all").ok_or("当前没有可取消的同步任务")?.store(true, Ordering::Relaxed);
    Ok(())
}

#[tauri::command]
fn get_snapshot(state: State<'_, AppState>, id: String) -> Result<Option<StationSnapshot>, String> { Ok(state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.load_snapshot(&id)?.map(|(_, snapshot)| snapshot)) }

#[tauri::command]
fn get_usage_summary(state: State<'_, AppState>) -> Result<UsageSummary, String> {
    let store = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?;
    let snapshots = store.list_stations()?.into_iter().filter_map(|station| store.load_snapshot(&station.id).ok().flatten().map(|(_, snapshot)| snapshot)).collect::<Vec<_>>();
    let cost_sources = snapshots.iter().filter(|snapshot| snapshot.usage.today_spent.is_some() || snapshot.usage.total_spent.is_some()).count();
    let can_aggregate_cost = cost_sources <= 1;
    Ok(UsageSummary {
        today_input_tokens: sum_i64(snapshots.iter().map(|snapshot| snapshot.usage.today_input_tokens)),
        today_output_tokens: sum_i64(snapshots.iter().map(|snapshot| snapshot.usage.today_output_tokens)),
        today_requests: sum_i64(snapshots.iter().map(|snapshot| snapshot.usage.today_requests)),
        total_requests: sum_i64(snapshots.iter().map(|snapshot| snapshot.usage.total_requests)),
        today_spent: can_aggregate_cost.then(|| sum_f64(snapshots.iter().map(|snapshot| snapshot.usage.today_spent))).flatten(),
        today_limit: can_aggregate_cost.then(|| sum_f64(snapshots.iter().map(|snapshot| snapshot.usage.today_limit))).flatten(),
        total_spent: can_aggregate_cost.then(|| sum_f64(snapshots.iter().map(|snapshot| snapshot.usage.total_spent))).flatten(),
        total_limit: can_aggregate_cost.then(|| sum_f64(snapshots.iter().map(|snapshot| snapshot.usage.total_limit))).flatten(),
        costs_are_isolated: !can_aggregate_cost,
    })
}

#[tauri::command]
async fn list_usage_logs(state: State<'_, AppState>) -> Result<Vec<UsageLog>, String> {
    let stations = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.list_stations()?;
    let mut logs = Vec::new();
    for station in stations {
        let Ok(mut secret) = load_authenticated_secret(&state, &station).await else { continue; };
        let adapter = StationAdapter::for_station(&station)?;
        if let Ok(value) = fetch_all_pages(&state, &station, &mut secret, adapter, PagedResource::Usage).await {
            let station_logs = parse_usage_logs(&value, &station);
            if let Ok(mut store) = state.store.lock() { let _ = store.cache_usage_logs(&station_logs); }
            logs.extend(station_logs);
        } else if let Ok(store) = state.store.lock() {
            logs.extend(store.cached_usage_logs(&station.id)?);
        }
    }
    logs.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(logs)
}

#[tauri::command]
fn get_history(state: State<'_, AppState>, id: String) -> Result<Vec<Value>, String> { state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.history(&id) }

#[tauri::command]
fn list_key_rows(state: State<'_, AppState>) -> Result<Vec<KeyRow>, String> {
    let store = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?;
    let mut rows = Vec::new();
    for station in store.list_stations()? {
        if let Some((_, snapshot)) = store.load_snapshot(&station.id)? {
            let mut groups = Vec::new();
            for rate in &snapshot.rates {
                if groups.iter().any(|group: &GroupOption| group.name == rate.group) { continue; }
                groups.push(GroupOption { name: rate.group.clone(), multiplier: Some(rate.multiplier) });
            }
            groups.sort_by(|left, right| left.name.cmp(&right.name));
            for key in snapshot.api_keys {
                let group_models = snapshot.rates.iter().filter(|rate| key.group.as_deref().is_none_or(|group| rate.group == group)).map(|rate| rate.model.clone()).collect::<Vec<_>>();
                let model_source = if group_models.is_empty() { snapshot.rates.iter().map(|rate| rate.model.clone()).collect() } else { group_models };
                let mut models = model_source.into_iter().filter(|model| model != "全部模型").collect::<Vec<_>>();
                models.sort(); models.dedup();
                rows.push(KeyRow { station_id: station.id.clone(), station_name: station.name.clone(), station_url: station.base_url.clone(), station_balance: snapshot.station_balance, groups: groups.clone(), models, key });
            }
        }
    }
    Ok(rows)
}

#[tauri::command]
fn list_account_rows(state: State<'_, AppState>) -> Result<Vec<AccountRow>, String> {
    let store = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?;
    let mut rows = Vec::new();
    for station in store.list_stations()? {
        if let Some((_, snapshot)) = store.load_snapshot(&station.id)? {
            rows.push(AccountRow {
                station_id: station.id.clone(),
                station_name: station.name,
                station_url: station.base_url,
                kind: station.kind,
                sync_status: station.status,
                last_synced_at: station.last_synced_at,
                account: snapshot.account,
                usage: snapshot.usage,
            });
        }
    }
    Ok(rows)
}

#[tauri::command]
fn list_rate_rows(state: State<'_, AppState>) -> Result<Vec<RateRow>, String> {
    let store = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?;
    let mut rows = Vec::new();
    for station in store.list_stations()? {
        if let Some((_, snapshot)) = store.load_snapshot(&station.id)? {
            for rate in snapshot.rates {
                rows.push(RateRow { station_id: station.id.clone(), station_name: station.name.clone(), station_url: station.base_url.clone(), last_synced_at: station.last_synced_at, sync_status: station.status.clone(), rate });
            }
        }
    }
    Ok(rows)
}

#[tauri::command]
fn list_station_groups(state: State<'_, AppState>, station_id: String) -> Result<Vec<GroupOption>, String> {
    let store = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?;
    let snapshot = store.load_snapshot(&station_id)?.map(|(_, snapshot)| snapshot).ok_or("请先同步该站点以获取可见分组")?;
    let mut groups = Vec::new();
    for rate in snapshot.rates {
        if groups.iter().any(|group: &GroupOption| group.name == rate.group) { continue; }
        groups.push(GroupOption { name: rate.group, multiplier: Some(rate.multiplier) });
    }
    groups.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(groups)
}

#[tauri::command]
async fn update_key_group(state: State<'_, AppState>, station_id: String, key_id: String, group: String) -> Result<SyncResult, String> {
    if group.trim().is_empty() { return Err("请选择一个分组".into()); }
    let station = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.get_station(&station_id)?;
    let mut secret = load_authenticated_secret(&state, &station).await?;
    match StationAdapter::for_station(&station)? {
        StationAdapter::Sub2Api => {
            let path = format!("/api/v1/keys/{key_id}");
            if station_request(&state, &station, &mut secret, Method::PATCH, &path, Some(json!({"group": group}))).await.is_err() {
                station_request(&state, &station, &mut secret, Method::PUT, &path, Some(json!({"group": group}))).await?;
            }
        }
        StationAdapter::NewApi => {
            let current = read_newapi_token(&state, &station, &mut secret, &key_id).await?;
            let mut request = empty_key_mutation(&station_id, Some(key_id));
            request.group = Some(group);
            update_newapi_token(&state, &station, &mut secret, &current, &request).await?;
        }
    }
    record_station_audit(&state, &station_id, "key.group.update", "API key group updated");
    sync_one(&state, &station_id).await
}

fn empty_key_mutation(station_id: &str, key_id: Option<String>) -> ApiKeyMutationRequest {
    ApiKeyMutationRequest { station_id: station_id.into(), key_id, name: None, group: None, custom_key: None, quota: None, expires_in_days: None, status: None, ip_whitelist: None, ip_blacklist: None, rate_limit_5h: None, rate_limit_1d: None, rate_limit_7d: None, reset_quota: None, reset_rate_limit_usage: None }
}

fn sub2_key_payload(request: &ApiKeyMutationRequest, include_id: bool) -> Value {
    let mut payload = serde_json::Map::new();
    if let Some(name) = request.name.as_ref().filter(|value| !value.trim().is_empty()) { payload.insert("name".into(), Value::String(name.trim().into())); }
    if let Some(group) = request.group.as_ref().filter(|value| !value.trim().is_empty()) { payload.insert("group".into(), Value::String(group.trim().into())); }
    if let Some(value) = request.custom_key.as_ref().filter(|value| !value.trim().is_empty()) { payload.insert("custom_key".into(), Value::String(value.trim().into())); }
    if let Some(value) = request.quota { payload.insert("quota".into(), Value::from(value)); }
    if let Some(value) = request.expires_in_days.filter(|value| *value > 0) { payload.insert("expires_in_days".into(), Value::from(value)); }
    if let Some(value) = request.status.as_ref().filter(|value| matches!(value.as_str(), "active" | "inactive")) { payload.insert("status".into(), Value::String(value.clone())); }
    if let Some(value) = request.ip_whitelist.as_ref() { payload.insert("ip_whitelist".into(), json!(value)); }
    if let Some(value) = request.ip_blacklist.as_ref() { payload.insert("ip_blacklist".into(), json!(value)); }
    if let Some(value) = request.rate_limit_5h { payload.insert("rate_limit_5h".into(), Value::from(value)); }
    if let Some(value) = request.rate_limit_1d { payload.insert("rate_limit_1d".into(), Value::from(value)); }
    if let Some(value) = request.rate_limit_7d { payload.insert("rate_limit_7d".into(), Value::from(value)); }
    if let Some(value) = request.reset_quota { payload.insert("reset_quota".into(), Value::Bool(value)); }
    if let Some(value) = request.reset_rate_limit_usage { payload.insert("reset_rate_limit_usage".into(), Value::Bool(value)); }
    let mut payload = Value::Object(payload);
    if include_id {
        payload["id"] = Value::String(request.key_id.clone().unwrap_or_default());
    }
    payload
}

fn validate_newapi_mutation(request: &ApiKeyMutationRequest) -> Result<(), String> {
    if request.custom_key.as_deref().is_some_and(|value| !value.trim().is_empty()) { return Err("NewAPI 不支持自定义密钥值".into()); }
    if request.ip_blacklist.as_ref().is_some_and(|values| !values.is_empty()) { return Err("NewAPI 不支持 IP 黑名单；可使用 IP 白名单".into()); }
    if request.rate_limit_5h.is_some() || request.rate_limit_1d.is_some() || request.rate_limit_7d.is_some() { return Err("NewAPI 不支持 Sub2API 的费率限额字段".into()); }
    if request.reset_quota == Some(true) || request.reset_rate_limit_usage == Some(true) { return Err("NewAPI 不支持该重置操作".into()); }
    Ok(())
}

fn newapi_allow_ips(values: &Option<Vec<String>>) -> Option<Value> {
    values.as_ref().map(|values| Value::String(values.iter().map(|value| value.trim()).filter(|value| !value.is_empty()).collect::<Vec<_>>().join("\n")))
}

fn newapi_create_payload(request: &ApiKeyMutationRequest) -> Result<Value, String> {
    validate_newapi_mutation(request)?;
    let name = request.name.as_deref().map(str::trim).filter(|value| !value.is_empty()).ok_or("请输入密钥名称")?;
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
    if let Some(group) = request.group.as_deref().map(str::trim).filter(|value| !value.is_empty()) { payload["group"] = Value::String(group.into()); }
    if let Some(allow_ips) = newapi_allow_ips(&request.ip_whitelist) { payload["allow_ips"] = allow_ips; }
    Ok(payload)
}

async fn read_newapi_token(state: &AppState, station: &Station, secret: &mut Secret, key_id: &str) -> Result<Value, String> {
    let value = station_request(state, station, secret, Method::GET, &format!("/api/token/{key_id}"), None).await?;
    data(&value).as_object().cloned().map(Value::Object).ok_or("NewAPI 未返回完整密钥配置".into())
}

fn newapi_has_content_changes(request: &ApiKeyMutationRequest) -> bool {
    request.name.is_some() || request.group.is_some() || request.quota.is_some() || request.expires_in_days.is_some() || request.ip_whitelist.is_some()
}

fn newapi_update_payload(current: &Value, request: &ApiKeyMutationRequest) -> Result<Value, String> {
    validate_newapi_mutation(request)?;
    let mut payload = current.as_object().cloned().map(Value::Object).ok_or("NewAPI 密钥配置格式无效")?;
    if let Some(name) = request.name.as_deref().map(str::trim).filter(|value| !value.is_empty()) { payload["name"] = Value::String(name.into()); }
    if let Some(group) = request.group.as_deref() { payload["group"] = Value::String(group.trim().into()); }
    if let Some(quota) = request.quota {
        payload["unlimited_quota"] = Value::Bool(quota <= 0.0);
        if quota > 0.0 {
            let used = number(current, &["used_quota"]).unwrap_or(0.0);
            payload["remain_quota"] = Value::from((quota - used).max(0.0));
        }
    }
    if let Some(days) = request.expires_in_days.filter(|days| *days > 0) { payload["expired_time"] = Value::from(now() + days * 86_400); }
    if let Some(allow_ips) = newapi_allow_ips(&request.ip_whitelist) { payload["allow_ips"] = allow_ips; }
    Ok(payload)
}

async fn update_newapi_token(state: &AppState, station: &Station, secret: &mut Secret, current: &Value, request: &ApiKeyMutationRequest) -> Result<(), String> {
    if newapi_has_content_changes(request) {
        station_request(state, station, secret, Method::PUT, "/api/token/", Some(newapi_update_payload(current, request)?)).await?;
    } else {
        validate_newapi_mutation(request)?;
    }
    if let Some(status) = request.status.as_deref() {
        let status = match status { "active" => 1, "inactive" => 2, _ => return Err("密钥状态仅支持 active 或 inactive".into()) };
        let id = current.get("id").cloned().unwrap_or_else(|| Value::String(request.key_id.clone().unwrap_or_default()));
        station_request(state, station, secret, Method::PUT, "/api/token/?status_only=true", Some(json!({"id": id, "status": status}))).await?;
    }
    Ok(())
}

#[tauri::command]
async fn create_api_key(state: State<'_, AppState>, request: ApiKeyMutationRequest) -> Result<SyncResult, String> {
    if request.name.as_deref().unwrap_or_default().trim().is_empty() { return Err("请输入密钥名称".into()); }
    let station = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.get_station(&request.station_id)?;
    let mut secret = load_authenticated_secret(&state, &station).await?;
    let adapter = StationAdapter::for_station(&station)?;
    let existing_key_ids = if adapter == StationAdapter::NewApi {
        let value = fetch_all_pages(&state, &station, &mut secret, adapter, PagedResource::Keys).await?;
        parse_keys(&value, adapter).into_iter().map(|key| key.id).collect::<BTreeSet<_>>()
    } else { BTreeSet::new() };
    match adapter {
        StationAdapter::Sub2Api => station_request(&state, &station, &mut secret, Method::POST, "/api/v1/keys", Some(sub2_key_payload(&request, false))).await?,
        StationAdapter::NewApi => station_request(&state, &station, &mut secret, Method::POST, "/api/token/", Some(newapi_create_payload(&request)?)).await?,
    };
    record_station_audit(&state, &request.station_id, "key.create", "API key created");
    let mut result = sync_one(&state, &request.station_id).await?;
    if adapter == StationAdapter::NewApi {
        let name = request.name.as_deref().map(str::trim).unwrap_or_default();
        let created = result.snapshot.api_keys.iter().find(|key| !existing_key_ids.contains(&key.id) && key.name == name)
            .or_else(|| result.snapshot.api_keys.iter().find(|key| !existing_key_ids.contains(&key.id)));
        let created = created.ok_or("NewAPI 已接受创建请求，但未能在刷新后的密钥列表中定位新密钥")?;
        result.change_summary.push(format!("已定位新建 NewAPI 密钥：{}", created.name));
    }
    Ok(result)
}

#[tauri::command]
async fn update_api_key(state: State<'_, AppState>, request: ApiKeyMutationRequest) -> Result<SyncResult, String> {
    let key_id = request.key_id.as_deref().filter(|id| !id.trim().is_empty()).ok_or("缺少密钥标识")?;
    let station = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.get_station(&request.station_id)?;
    let mut secret = load_authenticated_secret(&state, &station).await?;
    match StationAdapter::for_station(&station)? {
        StationAdapter::Sub2Api => {
            let path = format!("/api/v1/keys/{key_id}");
            let payload = sub2_key_payload(&request, false);
            if station_request(&state, &station, &mut secret, Method::PATCH, &path, Some(payload.clone())).await.is_err() {
                station_request(&state, &station, &mut secret, Method::PUT, &path, Some(payload)).await?;
            }
        }
        StationAdapter::NewApi => {
            let current = read_newapi_token(&state, &station, &mut secret, key_id).await?;
            update_newapi_token(&state, &station, &mut secret, &current, &request).await?;
        }
    }
    record_station_audit(&state, &request.station_id, "key.update", "API key updated");
    sync_one(&state, &request.station_id).await
}

#[tauri::command]
async fn delete_api_key(state: State<'_, AppState>, station_id: String, key_id: String) -> Result<SyncResult, String> {
    let station = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.get_station(&station_id)?;
    let mut secret = load_authenticated_secret(&state, &station).await?;
    let path = match StationAdapter::for_station(&station)? { StationAdapter::Sub2Api => format!("/api/v1/keys/{key_id}"), StationAdapter::NewApi => format!("/api/token/{key_id}/") };
    station_request(&state, &station, &mut secret, Method::DELETE, &path, None).await?;
    record_station_audit(&state, &station_id, "key.delete", "API key deleted");
    sync_one(&state, &station_id).await
}

#[tauri::command]
async fn read_api_key(state: &AppState, station_id: &str, key_id: &str) -> Result<(Station, String), String> {
    let station = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.get_station(&station_id)?;
    let mut secret = load_authenticated_secret(state, &station).await?;
    let (path, method) = match StationAdapter::for_station(&station)? {
        StationAdapter::Sub2Api => (format!("/api/v1/keys/{key_id}"), Method::GET),
        StationAdapter::NewApi => (format!("/api/token/{key_id}/key"), Method::POST),
    };
    let result = station_request(state, &station, &mut secret, method, &path, None).await?;
    let key = data(&result).get("key").or_else(|| data(&result).get("api_key")).and_then(Value::as_str).map(str::to_string).ok_or("站点未返回密钥明文")?;
    Ok((station, key))
}

#[tauri::command]
async fn reveal_key(state: State<'_, AppState>, station_id: String, key_id: String) -> Result<String, String> {
    let key = read_api_key(&state, &station_id, &key_id).await?.1;
    record_station_audit(&state, &station_id, "key.reveal", "API key revealed to local user");
    Ok(key)
}

#[tauri::command]
async fn get_gateway_status(state: State<'_, AppState>) -> Result<GatewayStatus, String> {
    let mode = current_routing_mode(&state)?;
    let runtime = state.gateway.runtime_snapshot().await;
    Ok(GatewayStatus {
        mode,
        running: state.gateway.is_running(),
        port: runtime.port,
        base_url: gateway_base_url(runtime.port),
        active_station_id: runtime.route.as_ref().map(|route| route.station_id.clone()),
        active_key_id: runtime.route.as_ref().map(|route| route.key_id.clone()),
        has_active_route: runtime.route.is_some(),
    })
}

async fn restore_persisted_gateway_route(state: &AppState) -> Result<(), String> {
    let (station_id, key_id) = {
        let store = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?;
        (store.setting("activeGatewayStationId")?, store.setting("activeGatewayKeyId")?)
    };
    let (Some(station_id), Some(key_id)) = (station_id, key_id) else { return Ok(()); };
    let (station, api_key) = read_api_key(state, &station_id, &key_id).await?;
    state.gateway.set_route(GatewayRoute { station_id, key_id, upstream_base_url: api_base_url(&station.base_url), api_key }).await;
    Ok(())
}

#[tauri::command]
async fn set_routing_mode(state: State<'_, AppState>, mode: RoutingMode) -> Result<GatewayStatus, String> {
    match mode {
        RoutingMode::CcSwitch => {
            state.gateway.stop();
            state.gateway.clear_route().await;
        }
        RoutingMode::LocalGateway => {
            if state.gateway.runtime_snapshot().await.route.is_none() { let _ = restore_persisted_gateway_route(&state).await; }
            state.gateway.start().await?;
        }
    }
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.save_setting("routingMode", routing_mode_setting(&mode))?;
    get_gateway_status(state).await
}

#[tauri::command]
async fn set_gateway_port(state: State<'_, AppState>, port: u16) -> Result<GatewayStatus, String> {
    if port == 0 { return Err("本地网关端口必须在 1 到 65535 之间".into()); }
    let was_running = state.gateway.is_running();
    if was_running { state.gateway.stop(); }
    state.gateway.set_port(port).await;
    state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.save_setting("gatewayPort", &port.to_string())?;
    if was_running && current_routing_mode(&state)? == RoutingMode::LocalGateway { state.gateway.start().await?; }
    get_gateway_status(state).await
}

#[tauri::command]
async fn start_gateway(state: State<'_, AppState>) -> Result<GatewayStatus, String> {
    if current_routing_mode(&state)? != RoutingMode::LocalGateway { return Err("请先切换到本地稳定入口模式".into()); }
    state.gateway.start().await?;
    get_gateway_status(state).await
}

#[tauri::command]
async fn stop_gateway(state: State<'_, AppState>) -> Result<GatewayStatus, String> {
    state.gateway.stop();
    get_gateway_status(state).await
}

#[tauri::command]
async fn set_active_gateway_route(state: State<'_, AppState>, station_id: String, key_id: String) -> Result<GatewayStatus, String> {
    set_gateway_route(&state, station_id, key_id).await?;
    get_gateway_status(state).await
}

#[tauri::command]
async fn get_gateway_credentials(state: State<'_, AppState>) -> Result<GatewayCredentials, String> {
    if current_routing_mode(&state)? != RoutingMode::LocalGateway { return Err("请先切换到本地稳定入口模式".into()); }
    let runtime = state.gateway.runtime_snapshot().await;
    Ok(GatewayCredentials { base_url: gateway_base_url(runtime.port), token: runtime.token })
}

#[tauri::command]
async fn rotate_gateway_token(state: State<'_, AppState>) -> Result<GatewayCredentials, String> {
    if current_routing_mode(&state)? != RoutingMode::LocalGateway { return Err("请先切换到本地稳定入口模式".into()); }
    let token = format!("rh-{}", Uuid::new_v4().simple());
    credential_entry(GATEWAY_TOKEN_ID)?.set_password(&token).map_err(|error| error.to_string())?;
    state.gateway.rotate_token(token.clone()).await;
    let port = state.gateway.runtime_snapshot().await.port;
    Ok(GatewayCredentials { base_url: gateway_base_url(port), token })
}

#[tauri::command]
async fn import_to_cc_switch(app: AppHandle, state: State<'_, AppState>, station_id: String, key_id: String, target_app: String) -> Result<(), String> {
    if current_routing_mode(&state)? != RoutingMode::CcSwitch { return Err("本地稳定入口模式下不能导入 CC Switch".into()); }
    if !matches!(target_app.as_str(), "claude" | "codex" | "gemini") { return Err("CC Switch 目标仅支持 Claude、Codex 或 Gemini".into()); }
    let (station, key) = read_api_key(&state, &station_id, &key_id).await?;
    let mut link = Url::parse("ccswitch://v1/import").map_err(|e| e.to_string())?;
    let api_base = api_base_url(&station.base_url);
    link.query_pairs_mut().append_pair("resource", "provider").append_pair("app", &target_app).append_pair("name", &format!("{} - {}", station.name, key_id)).append_pair("endpoint", &api_base).append_pair("homepage", &station.base_url).append_pair("apiKey", &key);
    app.opener().open_url(link.as_str(), None::<&str>).map_err(|e| format!("无法启动 CC Switch：{e}"))
}

async fn test_model(client: &Client, station: &Station, key: &str, model: &str, test_mode: &str) -> Result<ModelTestResult, String> {
    let model = model.trim();
    if !matches!(test_mode, "chat" | "responses") { return Err("不支持的测试模式".into()); }
    let (path, body) = if test_mode == "chat" {
        ("chat/completions", json!({"model": model, "messages": [{"role": "user", "content": "hi"}], "max_tokens": 32, "temperature": 0}))
    } else {
        ("responses", json!({"model": model, "input": "hi", "max_output_tokens": 32}))
    };
    let started = Instant::now();
    let response = client.post(format!("{}/{}", api_base_url(&station.base_url), path)).bearer_auth(key).json(&body).timeout(std::time::Duration::from_secs(20)).send().await.map_err(|error| format!("模型测试请求失败：{error}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| format!("读取模型响应失败：{error}"))?;
    if !status.is_success() { return Err(format!("模型测试失败 ({status})：{}", response_error_message(&body))); }
    let value = serde_json::from_str::<Value>(&body).map_err(|_| "模型测试成功，但站点未返回 JSON 响应".to_string())?;
    Ok(ModelTestResult { model: model.to_string(), response: Some(model_response_text(&value).unwrap_or_else(|| "请求成功，但未返回可显示的文本内容。".into())), error: None, elapsed_ms: started.elapsed().as_millis() as u64 })
}

#[tauri::command]
async fn test_api_models(state: State<'_, AppState>, station_id: String, key_id: String, models: Vec<String>, test_mode: String) -> Result<Vec<ModelTestResult>, String> {
    if models.is_empty() || models.len() > 50 { return Err("请选择 1 至 50 个要测试的模型".into()); }
    if models.iter().any(|model| model.trim().is_empty()) { return Err("模型名称不能为空".into()); }
    if !matches!(test_mode.as_str(), "chat" | "responses") { return Err("不支持的测试模式".into()); }
    let (station, key) = read_api_key(&state, &station_id, &key_id).await?;
    let mut results = Vec::with_capacity(models.len());
    for model in models {
        let started = Instant::now();
        match test_model(&state.client, &station, &key, &model, &test_mode).await {
            Ok(result) => results.push(result),
            Err(error) => results.push(ModelTestResult { model, response: None, error: Some(error), elapsed_ms: started.elapsed().as_millis() as u64 }),
        }
    }
    Ok(results)
}

async fn detection_request(client: &Client, endpoint: &str, api_key: &str, model: &str, protocol: &str, prompt: &str) -> Result<(Value, String), String> {
    let base_url = api_base_url(endpoint);
    let request = if protocol == "anthropic" {
        client.post(format!("{base_url}/messages"))
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&json!({"model": model, "max_tokens": 96, "temperature": 0, "messages": [{"role": "user", "content": prompt}]}))
    } else {
        client.post(format!("{base_url}/chat/completions"))
            .bearer_auth(api_key)
            .json(&json!({"model": model, "max_tokens": 96, "temperature": 0, "messages": [{"role": "user", "content": prompt}]}))
    };
    let response = request.timeout(Duration::from_secs(30)).send().await.map_err(|error| format!("请求失败：{error}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|error| format!("读取响应失败：{error}"))?;
    if !status.is_success() { return Err(format!("HTTP {status}：{}", response_error_message(&body))); }
    let value = serde_json::from_str::<Value>(&body).map_err(|_| "接口返回的不是 JSON 响应".to_string())?;
    let text = model_response_text(&value).ok_or("接口成功响应，但未找到模型输出文本".to_string())?;
    Ok((value, text))
}

fn detection_check(name: &str, status: &str, detail: impl Into<String>, trace: Option<String>) -> ModelDetectionCheck {
    ModelDetectionCheck { name: name.into(), status: status.into(), detail: detail.into(), trace }
}

fn detection_usage(value: &Value) -> (i64, i64, i64) {
    let usage = value.get("usage").unwrap_or(value);
    let count = |names: &[&str]| names.iter().find_map(|name| usage.get(*name).and_then(Value::as_i64)).unwrap_or(0);
    let cache_read = usage.get("prompt_tokens_details")
        .and_then(|details| details.get("cached_tokens"))
        .and_then(Value::as_i64)
        .unwrap_or_else(|| count(&["cache_read_input_tokens", "cache_read_tokens"]));
    (count(&["input_tokens", "prompt_tokens"]), count(&["output_tokens", "completion_tokens"]), cache_read)
}

fn detection_score(checks: &[ModelDetectionCheck]) -> u8 {
    checks.iter().map(|check| match check.status.as_str() { "pass" => 25, "warning" => 13, _ => 0 }).sum()
}

#[tauri::command]
async fn detect_model_authenticity(state: State<'_, AppState>, request: ModelDetectionRequest) -> Result<ModelDetectionResult, String> {
    let (endpoint, api_key) = match (request.station_id.as_deref(), request.key_id.as_deref()) {
        (Some(station_id), Some(key_id)) => {
            let (station, key) = read_api_key(&state, station_id, key_id).await?;
            (station.base_url, key)
        }
        (None, None) => (request.endpoint, request.api_key),
        _ => return Err("已保存的 API Key 需要同时提供站点和密钥标识".into()),
    };
    let endpoint = endpoint.trim();
    let api_key = api_key.trim();
    let model = request.model.trim();
    if endpoint.is_empty() || api_key.is_empty() || model.is_empty() { return Err("请填写接口地址、API Key 和目标模型".into()); }
    if endpoint.len() > 2048 || api_key.len() > 4096 || model.len() > 256 { return Err("检测参数长度不正确".into()); }
    let parsed = Url::parse(endpoint).map_err(|_| "接口地址必须是完整的 http(s) URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") { return Err("接口地址仅支持 http 或 https".into()); }
    if !matches!(request.protocol.as_str(), "openai" | "anthropic") { return Err("不支持的接口协议".into()); }

    let started = Instant::now();
    let mut checks = Vec::with_capacity(4);
    let mut input_tokens = 0;
    let mut output_tokens = 0;
    let mut cache_read_tokens = 0;
    let protocol_prompt = "Reply with exactly this text and nothing else: relayhub-probe-ok";
    let first = detection_request(&state.client, endpoint, api_key, model, &request.protocol, protocol_prompt).await;
    let first_text = match first {
        Ok((response, text)) => {
            let (input, output, cache_read) = detection_usage(&response);
            input_tokens += input;
            output_tokens += output;
            cache_read_tokens += cache_read;
            let status = if text.trim().eq_ignore_ascii_case("relayhub-probe-ok") { "pass" } else { "warning" };
            checks.push(detection_check("协议响应", status, if status == "pass" { "请求格式与受支持协议一致" } else { "接口可响应，但未严格遵循探针格式" }, Some(text.chars().take(300).collect())));
            text
        }
        Err(error) => {
            checks.push(detection_check("协议响应", "fail", "接口请求未完成", Some(error)));
            return Ok(ModelDetectionResult { score: 0, checks, elapsed_ms: started.elapsed().as_millis() as u64, tokens_per_second: 0.0, input_tokens, output_tokens, cache_read_tokens });
        }
    };

    let structure_prompt = "Return exactly one JSON object with these values: {\"service\":\"relayhub\",\"value\":17}. Do not use markdown.";
    match detection_request(&state.client, endpoint, api_key, model, &request.protocol, structure_prompt).await {
        Ok((response, text)) => {
            let (input, output, cache_read) = detection_usage(&response);
            input_tokens += input;
            output_tokens += output;
            cache_read_tokens += cache_read;
            let valid = serde_json::from_str::<Value>(text.trim()).ok().is_some_and(|value| value.get("service").and_then(Value::as_str) == Some("relayhub") && value.get("value").and_then(Value::as_i64) == Some(17));
            checks.push(detection_check("结构一致性", if valid { "pass" } else { "warning" }, if valid { "受控 JSON 响应符合预期" } else { "响应有效，但未严格匹配受控结构" }, Some(text.chars().take(300).collect())));
        }
        Err(error) => checks.push(detection_check("结构一致性", "fail", "结构探针失败", Some(error))),
    }

    let identity_prompt = "State the model family you are serving in one short phrase. Do not make up a provider name.";
    match detection_request(&state.client, endpoint, api_key, model, &request.protocol, identity_prompt).await {
        Ok((response, text)) => {
            let (input, output, cache_read) = detection_usage(&response);
            input_tokens += input;
            output_tokens += output;
            cache_read_tokens += cache_read;
            let expected = model.to_ascii_lowercase();
            let family = ["claude", "gpt", "gemini", "deepseek", "qwen", "llama"].iter().find(|name| expected.contains(**name));
            let matches = family.is_some_and(|name| text.to_ascii_lowercase().contains(name));
            checks.push(detection_check("身份信号", if matches { "pass" } else { "warning" }, if matches { "模型自述与目标模型家族一致" } else { "模型自述无法确认目标家族" }, Some(text.chars().take(300).collect())));
        }
        Err(error) => checks.push(detection_check("身份信号", "fail", "身份探针失败", Some(error))),
    }

    let stability_prompt = "Reply with exactly this text and nothing else: relayhub-stable-42";
    match detection_request(&state.client, endpoint, api_key, model, &request.protocol, stability_prompt).await {
        Ok((response, text)) => {
            let (input, output, cache_read) = detection_usage(&response);
            input_tokens += input;
            output_tokens += output;
            cache_read_tokens += cache_read;
            let stable = first_text.trim().eq_ignore_ascii_case("relayhub-probe-ok") && text.trim().eq_ignore_ascii_case("relayhub-stable-42");
            checks.push(detection_check("受控输出", if stable { "pass" } else { "warning" }, if stable { "两次确定性探针均符合预期" } else { "模型可用，但受控输出不稳定" }, Some(text.chars().take(300).collect())));
        }
        Err(error) => checks.push(detection_check("受控输出", "fail", "稳定性探针失败", Some(error))),
    }

    let score = detection_score(&checks);
    let elapsed_ms = started.elapsed().as_millis() as u64;
    let tokens_per_second = if elapsed_ms == 0 { 0.0 } else { output_tokens as f64 / (elapsed_ms as f64 / 1000.0) };
    Ok(ModelDetectionResult { score, checks, elapsed_ms, tokens_per_second, input_tokens, output_tokens, cache_read_tokens })
}

#[tauri::command]
fn delete_station(state: State<'_, AppState>, id: String) -> Result<(), String> { state.store.lock().map_err(|_| "本地数据库不可用".to_string())?.delete_station(&id)?; clear_secret(&id); Ok(()) }

#[tauri::command]
fn backup_database(state: State<'_, AppState>, destination: String) -> Result<(), String> {
    let store = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?;
    let destination = std::path::PathBuf::from(destination);
    if destination == store.path { return Err("备份文件不能覆盖当前数据库".into()); }
    let _ = store.connection.execute_batch("PRAGMA wal_checkpoint(FULL)");
    fs::copy(&store.path, &destination).map_err(|e| e.to_string())?;
    Store::open(destination).map(|_| ()).map_err(|e| format!("备份校验失败：{e}"))
}

#[cfg(windows)]
fn sync_caption_colors(window: &tauri::WebviewWindow) {
    use std::{ffi::c_void, mem::size_of};
    use windows_sys::Win32::{
        Graphics::{
            Dwm::{DwmSetWindowAttribute, DWMWA_CAPTION_COLOR, DWMWA_TEXT_COLOR},
        },
    };

    let Ok(hwnd) = window.hwnd() else { return; };
    let (caption, text) = match window.theme() {
        Ok(tauri::Theme::Dark) => (0x001c1c1c_u32, 0x00f5f5f5_u32),
        _ => (0x00f8f7fb_u32, 0x002a170f_u32),
    };
    unsafe {
        let _ = DwmSetWindowAttribute(hwnd.0, DWMWA_CAPTION_COLOR as u32, &caption as *const _ as *const c_void, size_of::<u32>() as u32);
        let _ = DwmSetWindowAttribute(hwnd.0, DWMWA_TEXT_COLOR as u32, &text as *const _ as *const c_void, size_of::<u32>() as u32);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            #[cfg(desktop)]
            app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            let directory = app.path().app_data_dir().map_err(|e| e.to_string())?;
            fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
            let store = Store::open(directory.join("api-assistant.sqlite"))?;
            let client = Client::builder().user_agent("RelayHub/0.1").build().map_err(|e| e.to_string())?;
            let (mode, port) = load_gateway_settings(&store)?;
            let token = load_or_create_gateway_token()?;
            let gateway = GatewayController::new(client.clone(), token, port);
            app.manage(AppState { store: Mutex::new(store), client, gateway, auth_backoff: Mutex::new(HashMap::new()), remote_operations: Arc::new(Mutex::new(HashMap::new())), sync_operations: Arc::new(Mutex::new(HashMap::new())), sync_progress: Mutex::new(HashMap::new()) });
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                sync_caption_colors(&window);
            }
            if mode == RoutingMode::LocalGateway {
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_handle.state::<AppState>();
                    let _ = restore_persisted_gateway_route(&state).await;
                    let _ = state.gateway.start().await;
                });
            }
            let is_local_gateway = mode == RoutingMode::LocalGateway;
            let gateway_running = app.state::<AppState>().gateway.is_running();
            let (tray_stations, active_station_id, active_key_id) = {
                let state = app.state::<AppState>();
                let store = state.store.lock().map_err(|_| "本地数据库不可用".to_string())?;
                let active_station_id = store.setting("activeGatewayStationId")?;
                let active_key_id = store.setting("activeGatewayKeyId")?;
                let stations = store.list_stations()?;
                let stations = stations.into_iter().map(|station| {
                    let snapshot = store.load_snapshot(&station.id)?.map(|(_, snapshot)| snapshot);
                    Ok((station, snapshot))
                }).collect::<Result<Vec<_>, String>>()?;
                (stations, active_station_id, active_key_id)
            };
            let dashboard = MenuItem::with_id(app, "show", "仪表板", true, None::<&str>)?;
            let stations_menu = Submenu::new(app, "站点", true)?;
            if tray_stations.is_empty() {
                let empty_stations = MenuItem::new(app, "还没有已同步的站点", false, None::<&str>)?;
                stations_menu.append(&empty_stations)?;
            } else {
                for (station, snapshot) in tray_stations {
                    let station_menu = Submenu::new(app, format!("{} · {}", station.name, station.status), true)?;
                    let balance = MenuItem::new(app, snapshot.as_ref().map(|snapshot| tray_balance_label(snapshot.station_balance)).unwrap_or_else(|| "余额 · --".into()), false, None::<&str>)?;
                    station_menu.append(&balance)?;
                    let separator = PredefinedMenuItem::separator(app)?;
                    station_menu.append(&separator)?;
                    let groups_menu = Submenu::new(app, "分组与倍率", true)?;
                    match snapshot {
                        Some(snapshot) => {
                            let mut groups = BTreeSet::new();
                            for rate in &snapshot.rates { groups.insert(rate.group.clone()); }
                            for key in &snapshot.api_keys { groups.insert(key.group.clone().unwrap_or_else(|| "默认分组".into())); }
                            if groups.is_empty() {
                                let empty_groups = MenuItem::new(app, "暂无分组或倍率数据", false, None::<&str>)?;
                                groups_menu.append(&empty_groups)?;
                            }
                            for group in groups {
                                let group_menu = Submenu::new(app, &group, true)?;
                                let group_keys = snapshot.api_keys.iter().filter(|key| key.group.as_deref().unwrap_or("默认分组") == group).collect::<Vec<_>>();
                                if group_keys.is_empty() {
                                    let no_keys = MenuItem::new(app, "暂无可选密钥", false, None::<&str>)?;
                                    group_menu.append(&no_keys)?;
                                } else {
                                    for key in group_keys {
                                        let is_active = active_station_id.as_deref() == Some(station.id.as_str()) && active_key_id.as_deref() == Some(key.id.as_str());
                                        let key_label = format!("{}{} · {}", if is_active { "● " } else { "" }, key.name, key.masked_key);
                                        let key_item = MenuItem::with_id(app, format!("gateway-route:{}:{}", station.id, key.id), key_label, is_local_gateway, None::<&str>)?;
                                        group_menu.append(&key_item)?;
                                    }
                                }
                                let group_rates = snapshot.rates.iter().filter(|rate| rate.group == group).take(20).collect::<Vec<_>>();
                                if !group_rates.is_empty() {
                                    let separator = PredefinedMenuItem::separator(app)?;
                                    group_menu.append(&separator)?;
                                    for rate in group_rates {
                                        let rate_item = MenuItem::new(app, tray_rate_label(rate), false, None::<&str>)?;
                                        group_menu.append(&rate_item)?;
                                    }
                                }
                                groups_menu.append(&group_menu)?;
                            }
                        }
                        None => {
                            let stale = MenuItem::new(app, "站点尚未同步", false, None::<&str>)?;
                            groups_menu.append(&stale)?;
                        }
                    }
                    station_menu.append(&groups_menu)?;
                    stations_menu.append(&station_menu)?;
                }
            }
            let separator_primary = PredefinedMenuItem::separator(app)?;
            let cc_switch = CheckMenuItem::with_id(app, "mode-cc-switch", "CC Switch", true, !is_local_gateway, None::<&str>)?;
            let local_gateway = CheckMenuItem::with_id(app, "mode-local-gateway", "本地稳定入口", true, is_local_gateway, None::<&str>)?;
            let routing_mode = Submenu::with_items(app, "中转模式", true, &[&cc_switch, &local_gateway])?;
            let gateway_status = MenuItem::with_id(
                app,
                "gateway-status",
                if is_local_gateway {
                    if gateway_running { format!("本地网关 · 运行中 · 127.0.0.1:{port}") } else { format!("本地网关 · 未运行 · 127.0.0.1:{port}") }
                } else {
                    "本地网关 · 已暂停（CC Switch 模式）".into()
                },
                false,
                None::<&str>,
            )?;
            let separator_gateway = PredefinedMenuItem::separator(app)?;
            let start_gateway = MenuItem::with_id(app, "gateway-start", "启动本地网关", is_local_gateway && !gateway_running, None::<&str>)?;
            let stop_gateway = MenuItem::with_id(app, "gateway-stop", "停止本地网关", is_local_gateway && gateway_running, None::<&str>)?;
            let gateway_menu = Submenu::with_items(app, "本地网关", true, &[&gateway_status, &separator_gateway, &start_gateway, &stop_gateway])?;
            let separator_quit = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "退出 RelayHub", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&dashboard, &stations_menu, &separator_primary, &routing_mode, &gateway_menu, &separator_quit, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .menu(&menu)
                .tooltip("RelayHub");
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    id if id.starts_with("gateway-route:") => {
                        let mut ids = id.trim_start_matches("gateway-route:").splitn(2, ':');
                        let station_id = ids.next().unwrap_or_default().to_string();
                        let key_id = ids.next().unwrap_or_default().to_string();
                        if !station_id.is_empty() && !key_id.is_empty() {
                            let app = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let state = app.state::<AppState>();
                                let _ = set_gateway_route(&state, station_id, key_id).await;
                            });
                        }
                    }
                    "show" => if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); },
                    "mode-cc-switch" => {
                        let _ = cc_switch.set_checked(true);
                        let _ = local_gateway.set_checked(false);
                        let _ = gateway_status.set_text("本地网关 · 已暂停（CC Switch 模式）");
                        let _ = start_gateway.set_enabled(false);
                        let _ = stop_gateway.set_enabled(false);
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move { let _ = set_tray_routing_mode(app, RoutingMode::CcSwitch).await; });
                    }
                    "mode-local-gateway" => {
                        let _ = cc_switch.set_checked(false);
                        let _ = local_gateway.set_checked(true);
                        let _ = gateway_status.set_text(format!("本地网关 · 正在启动 · 127.0.0.1:{port}"));
                        let _ = start_gateway.set_enabled(false);
                        let _ = stop_gateway.set_enabled(true);
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move { let _ = set_tray_routing_mode(app, RoutingMode::LocalGateway).await; });
                    }
                    "gateway-start" => {
                        let _ = gateway_status.set_text(format!("本地网关 · 正在启动 · 127.0.0.1:{port}"));
                        let _ = start_gateway.set_enabled(false);
                        let _ = stop_gateway.set_enabled(true);
                        let app = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = app.state::<AppState>();
                            if state.gateway.runtime_snapshot().await.route.is_none() { let _ = restore_persisted_gateway_route(&state).await; }
                            let _ = state.gateway.start().await;
                        });
                    }
                    "gateway-stop" => {
                        let state = app.state::<AppState>();
                        state.gateway.stop();
                        let _ = gateway_status.set_text(format!("本地网关 · 未运行 · 127.0.0.1:{port}"));
                        let _ = start_gateway.set_enabled(true);
                        let _ = stop_gateway.set_enabled(false);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .invoke_handler(tauri::generate_handler![probe_station, add_station, list_stations, list_login_profiles, get_login_profile, save_login_profile, delete_login_profile, list_remote_servers, list_remote_sync_logs, cancel_remote_server_operation, install_or_update_remote_codex_command, choose_private_key_file, add_remote_server, update_remote_server, delete_remote_server, test_remote_server, verify_remote_codex_session_command, assign_remote_relay_key, update_remote_relay, refresh_station, reauthenticate_station, clear_station_session, refresh_all, get_sync_progress, cancel_sync, get_snapshot, get_usage_summary, list_usage_logs, get_history, list_key_rows, list_account_rows, list_rate_rows, list_station_groups, update_key_group, create_api_key, update_api_key, delete_api_key, reveal_key, get_gateway_status, set_routing_mode, set_gateway_port, start_gateway, stop_gateway, set_active_gateway_route, get_gateway_credentials, rotate_gateway_token, import_to_cc_switch, test_api_models, detect_model_authenticity, delete_station, backup_database])
        .run(tauri::generate_context!())
        .expect("error while running RelayHub");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_public_tauri_command_contract_complete() {
        assert_eq!(command_contract::COMMAND_NAMES.len(), 51);
        assert!(command_contract::COMMAND_NAMES.contains(&"detect_model_authenticity"));
        assert!(command_contract::COMMAND_NAMES.contains(&"backup_database"));
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
    fn builds_source_specific_login_fields() {
        let sub2 = StationAdapter::Sub2Api.login_body("user@example.com", "secret");
        let newapi = StationAdapter::NewApi.login_body("KitQQ", "secret");
        assert_eq!(sub2["email"], "user@example.com");
        assert!(sub2.get("username").is_none());
        assert_eq!(newapi["username"], "KitQQ");
    }

    #[test]
    fn builds_actual_pagination_paths_for_each_adapter() {
        assert_eq!(StationAdapter::Sub2Api.paged_path(PagedResource::Keys, 1, 100), "/api/v1/keys?page=1&page_size=100");
        assert_eq!(StationAdapter::NewApi.paged_path(PagedResource::Usage, 0, 100), "/api/log/self?p=0&page_size=100");
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
    fn newapi_update_keeps_unedited_token_fields() {
        let current = json!({"id": 7, "name": "old", "group": "default", "status": 1, "remain_quota": 50.0, "used_quota": 10.0, "model_limits_enabled": true, "model_limits": "gpt-4", "allow_ips": "127.0.0.1", "cross_group_retry": true});
        let mut request = empty_key_mutation("station", Some("7".into()));
        request.name = Some("renamed".into());
        let payload = newapi_update_payload(&current, &request).unwrap();
        assert_eq!(payload["name"], "renamed");
        assert_eq!(payload["model_limits"], "gpt-4");
        assert_eq!(payload["cross_group_retry"], true);
        assert_eq!(payload["remain_quota"], 50.0);
    }

    #[test]
    fn rejects_newapi_fields_without_a_real_mapping() {
        let mut request = empty_key_mutation("station", None);
        request.ip_blacklist = Some(vec!["10.0.0.1".into()]);
        assert!(validate_newapi_mutation(&request).is_err());
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
        let old = StationSnapshot { offers: vec![Offer { id: "one".into(), title: String::new(), summary: String::new(), source_url: String::new(), published_at: None }], ..Default::default() };
        let new = StationSnapshot { offers: vec![Offer { id: "one".into(), title: String::new(), summary: String::new(), source_url: String::new(), published_at: None }, Offer { id: "two".into(), title: String::new(), summary: String::new(), source_url: String::new(), published_at: None }], ..Default::default() };
        assert!(describe_changes(Some(&old), &new).iter().any(|entry| entry.contains("新公告")));
    }

    #[test]
    fn extracts_chat_and_responses_text() {
        assert_eq!(model_response_text(&json!({"choices": [{"message": {"content": "hello"}}]})), Some("hello".into()));
        assert_eq!(model_response_text(&json!({"output": [{"content": [{"type": "output_text", "text": "hello"}]}]})), Some("hello".into()));
        assert_eq!(model_response_text(&json!({"content": [{"type": "text", "text": "hello"}]})), Some("hello".into()));
    }

    #[test]
    fn scores_detection_checks_consistently() {
        let checks = vec![
            detection_check("one", "pass", "", None),
            detection_check("two", "warning", "", None),
            detection_check("three", "fail", "", None),
        ];
        assert_eq!(detection_score(&checks), 38);
    }

    #[test]
    fn accepts_saved_key_detection_without_manual_secret_fields() {
        let request = serde_json::from_value::<ModelDetectionRequest>(json!({
            "model": "gpt-4o",
            "protocol": "openai",
            "stationId": "station-1",
            "keyId": "key-1"
        })).expect("saved key request should deserialize");
        assert!(request.endpoint.is_empty());
        assert!(request.api_key.is_empty());
        assert_eq!(request.station_id.as_deref(), Some("station-1"));
        assert_eq!(request.key_id.as_deref(), Some("key-1"));
    }

    #[test]
    fn extracts_only_the_session_cookie() {
        let mut headers = HeaderMap::new();
        headers.append(header::SET_COOKIE, "csrf=ignore; Path=/".parse().unwrap());
        headers.append(header::SET_COOKIE, "session=authenticated; Path=/; HttpOnly; Secure".parse().unwrap());
        assert_eq!(session_cookie(&headers).as_deref(), Some("session=authenticated"));
    }

    #[test]
    fn redacts_unmasked_api_keys_and_detects_expired_sessions() {
        assert_eq!(mask_api_key("sk-1234567890abcdef"), "sk-12...cdef");
        assert_eq!(mask_api_key("sk-12...cdef"), "sk-12...cdef");
        assert!(is_unauthorized("HTTP 401: Unauthorized"));
        assert!(!is_unauthorized("HTTP 403: Forbidden"));
    }

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
        assert_eq!(base("https://relay.example.com/"), "https://relay.example.com");
        assert_eq!(base("https://relay.example.com/v1"), "https://relay.example.com/v1");
    }

    #[test]
    fn removes_only_the_relayhub_bashrc_block() {
        let source = "before\n# >>> RelayHub Codex >>>\nsource relayhub.env\n# <<< RelayHub Codex <<<\nafter\n";
        assert_eq!(remove_bashrc_relay_source(Some(source)).as_deref(), Some("before\n\nafter\n"));
        assert_eq!(remove_bashrc_relay_source(Some("export PATH=/bin\n")), None);
    }

    #[test]
    fn patches_only_the_selected_codex_provider() {
        let source = "# keep this comment\nmodel_provider = \"custom\"\n\n[model_providers.custom]\nbase_url = \"https://old.example/v1\"\napi_key = \"$CUSTOM_KEY\"\n\n[model_providers.other]\nbase_url = \"https://other.example/v1\"\n";
        let (patched, provider) = patch_codex_config(source, Some("custom"), "https://new.example", "sk-relay-token").expect("config should be patchable");

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
    fn migrates_existing_remote_server_storage_and_preserves_sync_logs() {
        let database = tempfile::NamedTempFile::new().expect("temporary database should be created");
        let connection = Connection::open(database.path()).expect("temporary database should open");
        connection.execute_batch("CREATE TABLE remote_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, username TEXT NOT NULL, auth_type TEXT NOT NULL, private_key_path TEXT, relay_url TEXT, relay_key_source TEXT, relay_key_masked TEXT, connection_status TEXT NOT NULL DEFAULT 'warning', connection_error TEXT, updated_at INTEGER NOT NULL);").expect("old remote server schema should be created");
        drop(connection);

        let store = Store::open(database.path().to_path_buf()).expect("existing storage should migrate");
        let columns = store.connection.prepare("PRAGMA table_info(remote_servers)").expect("table info should prepare")
            .query_map([], |row| row.get::<_, String>(1)).expect("table info should query")
            .collect::<Result<Vec<_>, _>>().expect("table info should collect");
        for column in ["port", "codex_version", "codex_latest_version", "codex_update_available", "host_key_fingerprint", "relay_provider", "relay_config_fingerprint", "last_sync_status"] {
            assert!(columns.iter().any(|value| value == column), "missing migrated column {column}");
        }
        store.add_remote_sync_log("server-1", "success", "test", "read complete", Some("sha256:test")).expect("sync log should save");
        let logs = store.list_remote_sync_logs("server-1").expect("sync logs should list");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].config_fingerprint.as_deref(), Some("sha256:test"));
    }

    #[test]
    fn remote_operation_guard_releases_and_honors_cancellation() {
        let operations = Arc::new(Mutex::new(HashMap::new()));
        let cancelled = Arc::new(AtomicBool::new(false));
        operations.lock().unwrap().insert("server-1".into(), cancelled.clone());
        let guard = RemoteOperationGuard { id: "server-1".into(), operations: operations.clone(), cancelled };
        assert!(ensure_remote_operation_active(Some(&guard)).is_ok());
        guard.cancelled.store(true, Ordering::Relaxed);
        assert_eq!(ensure_remote_operation_active(Some(&guard)).unwrap_err(), "操作已取消");
        drop(guard);
        assert!(!operations.lock().unwrap().contains_key("server-1"));
    }

    #[test]
    fn identifies_codex_updates_from_semantic_versions() {
        assert!(codex_update_available(Some("codex-cli 0.92.1"), Some("0.93.0")));
        assert!(!codex_update_available(Some("codex-cli 0.93.0"), Some("0.93.0")));
        assert!(!codex_update_available(Some("codex-cli 1.0.0"), Some("0.99.9")));
        assert!(!codex_update_available(Some("unknown"), Some("0.93.0")));
    }

    #[test]
    #[ignore = "requires RELAYHUB_E2E_SSH_HOST, RELAYHUB_E2E_SSH_USERNAME, and RELAYHUB_E2E_SSH_PASSWORD"]
    fn syncs_remote_codex_relay_configuration() {
        let server = RemoteServer {
            id: format!("relayhub-e2e-{}", Uuid::new_v4()),
            name: "RelayHub E2E".into(),
            host: std::env::var("RELAYHUB_E2E_SSH_HOST").expect("missing SSH host"),
            port: DEFAULT_SSH_PORT,
            username: std::env::var("RELAYHUB_E2E_SSH_USERNAME").expect("missing SSH username"),
            auth_type: "password".into(),
            private_key_path: None,
            codex_version: None,
            codex_latest_version: None,
            codex_update_available: false,
            host_key_fingerprint: None,
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
        let password = std::env::var("RELAYHUB_E2E_SSH_PASSWORD").expect("missing SSH password");
        remote_server_entry(&server.id).unwrap().set_password(&password).unwrap();
        assert_eq!(remote_server_entry(&server.id).unwrap().get_password().expect("password should be available from the credential store"), password);

        let session = remote_session(&server, None).expect("password SSH authentication should succeed");
        let home = remote_home(&session).expect("remote home should be available");
        let config_path = format!("{home}/.codex/config.toml");
        let auth_path = format!("{home}/.codex/auth.json");
        let env_path = format!("{home}/.codex/relayhub.env");
        let bashrc_path = format!("{home}/.bashrc");
        let original_config = read_remote_file(&session, &config_path).expect("config should be readable");
        let original_auth = read_remote_file(&session, &auth_path).expect("auth should be readable");
        let original_env = read_remote_file(&session, &env_path).expect("relay environment should be readable");
        let original_bashrc = read_remote_file(&session, &bashrc_path).expect("bashrc should be readable");
        drop(session);

        let relay_url = format!("https://relayhub-e2e-{}.example/v1", Uuid::new_v4());
        let relay_key = format!("sk-relayhub-e2e-{}", Uuid::new_v4());
        let result = (|| -> Result<(), String> {
            write_codex_relay_config(&server, &relay_url, &relay_key, None)?;
            let relay = fetch_codex_relay_config(&server, None)?.relay.ok_or("写入后未读取到 Codex 中转配置")?;
            if relay.url != relay_url || relay.key != relay_key { return Err("写入后的 Codex 中转配置与预期不一致".into()); }
            Ok(())
        })();

        let restore = (|| -> Result<(), String> {
            let session = remote_session(&server, None)?;
            match original_config.as_deref() {
                Some(config) => write_remote_file(&session, &config_path, config)?,
                None => { remote_command(&session, &format!("rm -f -- {}", shell_quote(&config_path)))?; }
            }
            match original_auth.as_deref() {
                Some(auth) => write_remote_file(&session, &auth_path, auth)?,
                None => { remote_command(&session, &format!("rm -f -- {}", shell_quote(&auth_path)))?; }
            }
            restore_remote_file(&session, &env_path, original_env.as_deref())?;
            restore_remote_file(&session, &bashrc_path, original_bashrc.as_deref())?;
            if read_remote_file(&session, &config_path)? != original_config || read_remote_file(&session, &auth_path)? != original_auth || read_remote_file(&session, &env_path)? != original_env || read_remote_file(&session, &bashrc_path)? != original_bashrc {
                return Err("恢复后的 Codex 配置与原始内容不一致".into());
            }
            Ok(())
        })();
        let _ = remote_server_entry(&server.id).and_then(|entry| entry.delete_credential().map_err(|error| error.to_string()));
        restore.expect("original Codex configuration should be restored");
        result.expect("remote Codex relay sync should succeed");
    }

    #[test]
    #[ignore = "requires relay URL/key, SSH host/username, and either RELAYHUB_E2E_SSH_PASSWORD or RELAYHUB_E2E_SSH_KEY_PATH"]
    fn configures_remote_relay_and_runs_codex_session() {
        let password = std::env::var("RELAYHUB_E2E_SSH_PASSWORD").ok().filter(|value| !value.is_empty());
        let private_key_path = std::env::var("RELAYHUB_E2E_SSH_KEY_PATH").ok().filter(|value| !value.is_empty());
        if password.is_none() && private_key_path.is_none() { panic!("missing SSH password or key path"); }
        let server = RemoteServer {
            id: format!("relayhub-session-{}", Uuid::new_v4()),
            name: "RelayHub Codex session E2E".into(),
            host: std::env::var("RELAYHUB_E2E_SSH_HOST").expect("missing SSH host"),
            port: DEFAULT_SSH_PORT,
            username: std::env::var("RELAYHUB_E2E_SSH_USERNAME").expect("missing SSH username"),
            auth_type: if password.is_some() { "password".into() } else { "key".into() },
            private_key_path,
            codex_version: None,
            codex_latest_version: None,
            codex_update_available: false,
            host_key_fingerprint: None,
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
        let relay_url = std::env::var("RELAYHUB_E2E_RELAY_URL").expect("missing relay URL");
        let relay_key = std::env::var("RELAYHUB_E2E_RELAY_KEY").expect("missing relay key");
        if let Some(password) = &password { remote_server_entry(&server.id).unwrap().set_password(password).unwrap(); }
        let session = remote_session(&server, None).expect("SSH authentication should succeed");
        let home = remote_home(&session).expect("remote home should be available");
        let config_path = format!("{home}/.codex/config.toml");
        let auth_path = format!("{home}/.codex/auth.json");
        let env_path = format!("{home}/.codex/relayhub.env");
        let bashrc_path = format!("{home}/.bashrc");
        let original_config = read_remote_file(&session, &config_path).expect("config should be readable");
        let original_auth = read_remote_file(&session, &auth_path).expect("auth should be readable");
        let original_env = read_remote_file(&session, &env_path).expect("relay environment should be readable");
        let original_bashrc = read_remote_file(&session, &bashrc_path).expect("bashrc should be readable");
        drop(session);

        let result = (|| -> Result<(), String> {
            let snapshot = write_codex_relay_config(&server, &relay_url, &relay_key, None)?;
            let relay = snapshot.relay.ok_or("写入后未读取到完整 Codex 中转配置")?;
            if relay.url != relay_url || relay.key != relay_key { return Err("远端 Codex 中转配置与预期不一致".into()); }

            let session = remote_session(&server, None)?;
            let config = read_remote_file(&session, &config_path)?.ok_or("远端 config.toml 未创建")?;
            let config = config.parse::<toml::Value>().map_err(|_| "远端 config.toml 写入后格式无效")?;
            let provider = config.get("model_providers").and_then(toml::Value::as_table)
                .and_then(|providers| providers.get("custom")).and_then(toml::Value::as_table)
                .ok_or("远端 config.toml 未写入 custom Provider")?;
            if config.get("model_provider").and_then(toml::Value::as_str) != Some("custom")
                || provider.get("wire_api").and_then(toml::Value::as_str) != Some("responses")
                || provider.get("requires_openai_auth").and_then(toml::Value::as_bool) != Some(true)
                || provider.get("experimental_bearer_token").and_then(toml::Value::as_str) != Some(relay_key.as_str()) {
                return Err("远端 config.toml 与本地 Codex 中转格式不一致".into());
            }
            let auth = read_remote_file(&session, &auth_path)?.ok_or("远端 auth.json 未创建")?;
            let auth = serde_json::from_str::<Value>(&auth).map_err(|_| "远端 auth.json 写入后格式无效")?;
            if auth.get("OPENAI_API_KEY").and_then(Value::as_str) != Some(relay_key.as_str()) {
                return Err("远端 auth.json 未同步 OPENAI_API_KEY".into());
            }
            if read_remote_file(&session, &env_path)?.is_some() { return Err("远端 relayhub.env 未清理".into()); }
            if read_remote_file(&session, &bashrc_path)?.as_deref().is_some_and(|bashrc| bashrc.contains("# >>> RelayHub Codex >>>")) { return Err("远端 .bashrc RelayHub 注入未清理".into()); }
            let session_result = verify_remote_codex_session(&server, None);
            if !session_result.success { return Err(session_result.reason.unwrap_or_else(|| "Codex CLI 会话验证失败".into())); }
            Ok(())
        })();

        if let Err(error) = result {
            let restore = (|| -> Result<(), String> {
                let session = remote_session(&server, None)?;
                restore_remote_file(&session, &config_path, original_config.as_deref())?;
                restore_remote_file(&session, &auth_path, original_auth.as_deref())?;
                restore_remote_file(&session, &env_path, original_env.as_deref())?;
                restore_remote_file(&session, &bashrc_path, original_bashrc.as_deref())?;
                Ok(())
            })();
            let _ = remote_relay_key_entry(&server.id).and_then(|entry| entry.delete_credential().map_err(|entry_error| entry_error.to_string()));
            let _ = remote_server_entry(&server.id).and_then(|entry| entry.delete_credential().map_err(|entry_error| entry_error.to_string()));
            if let Err(restore_error) = restore { panic!("{}; 恢复远端配置失败: {}", error, restore_error); }
            panic!("{}", error);
        }
        let _ = remote_relay_key_entry(&server.id).and_then(|entry| entry.delete_credential().map_err(|entry_error| entry_error.to_string()));
        let _ = remote_server_entry(&server.id).and_then(|entry| entry.delete_credential().map_err(|entry_error| entry_error.to_string()));
    }

    #[test]
    #[ignore = "requires RELAYHUB_E2E_SSH_HOST, RELAYHUB_E2E_SSH_USERNAME, and RELAYHUB_E2E_SSH_KEY_PATH"]
    fn authenticates_remote_ed25519_private_key() {
        let server = RemoteServer {
            id: format!("relayhub-key-auth-{}", Uuid::new_v4()),
            name: "RelayHub SSH key authentication E2E".into(),
            host: std::env::var("RELAYHUB_E2E_SSH_HOST").expect("missing SSH host"),
            port: DEFAULT_SSH_PORT,
            username: std::env::var("RELAYHUB_E2E_SSH_USERNAME").expect("missing SSH username"),
            auth_type: "key".into(),
            private_key_path: Some(std::env::var("RELAYHUB_E2E_SSH_KEY_PATH").expect("missing SSH key path")),
            codex_version: None,
            codex_latest_version: None,
            codex_update_available: false,
            host_key_fingerprint: None,
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
        let session = remote_session(&server, None).expect("ED25519 private-key SSH authentication should succeed");
        assert!(!remote_home(&session).expect("remote home should be available").trim().is_empty());
    }
}
