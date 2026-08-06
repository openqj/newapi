use std::collections::VecDeque;
use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    pin::Pin,
    sync::{Arc, Mutex},
    task::{Context, Poll},
    time::{Duration, Instant},
};

use axum::{
    body::{to_bytes, Body, Bytes},
    extract::{OriginalUri, State as AxumState},
    http::{header, HeaderMap, HeaderName, HeaderValue, Request, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
    Router,
};
use chrono::Utc;
use futures_util::{stream, Stream, StreamExt};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::{oneshot, RwLock};
use url::Url;
use uuid::Uuid;

use crate::{
    keyring_store::credential_entry,
    local_usage_store::LocalUsageRecord,
    services::api_keys::read_api_key,
    services::{chat_protocol, codex_config},
    settings_store::SettingsStore,
    station_snapshot_store::StationSnapshotStore,
    station_store::StationStore,
    store::Store,
    support::{api_base_url, station_base},
    AppState,
};

pub(crate) const DEFAULT_GATEWAY_PORT: u16 = 18765;
pub(crate) const GATEWAY_TOKEN_ID: &str = "local-gateway-token";
const ACTIVE_GATEWAY_ROUTES_SETTING: &str = "activeGatewayRoutes";
const DIRECT_GATEWAY_ROUTE_SETTING: &str = "directGatewayRoute";
const DIRECT_GATEWAY_CONFIG_FINGERPRINT_SETTING: &str = "directGatewayConfigFingerprint";
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD: u32 = 4;
const DEFAULT_CIRCUIT_SUCCESS_THRESHOLD: u32 = 2;
const DEFAULT_CIRCUIT_RECOVERY: Duration = Duration::from_secs(60);
const DEFAULT_CIRCUIT_ERROR_RATE_THRESHOLD: f64 = 0.6;
const DEFAULT_CIRCUIT_MIN_REQUESTS: u32 = 10;
const GATEWAY_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const MAX_GATEWAY_REQUEST_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RoutingMode {
    CcSwitch,
    LocalGateway,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GatewayStatus {
    pub(crate) mode: RoutingMode,
    pub(crate) running: bool,
    pub(crate) port: u16,
    pub(crate) base_url: String,
    pub(crate) active_station_id: Option<String>,
    pub(crate) active_key_id: Option<String>,
    pub(crate) has_active_route: bool,
    pub(crate) route_queue: Vec<GatewayRouteSelection>,
    pub(crate) route_health: Vec<GatewayRouteHealth>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GatewayCredentials {
    pub(crate) base_url: String,
    pub(crate) token: String,
}

#[derive(Clone, Debug)]
pub(crate) struct GatewayRoute {
    pub(crate) station_id: String,
    pub(crate) key_id: String,
    pub(crate) provider_name: String,
    pub(crate) upstream_base_url: String,
    pub(crate) api_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GatewayRouteSelection {
    pub(crate) station_id: String,
    pub(crate) key_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GatewayRouteHealth {
    pub(crate) station_id: String,
    pub(crate) key_id: String,
    pub(crate) state: String,
    pub(crate) consecutive_failures: u32,
    pub(crate) total_requests: u32,
    pub(crate) failed_requests: u32,
    pub(crate) cooldown_remaining_ms: u64,
    pub(crate) last_failure_at: Option<String>,
}

#[derive(Clone, Debug)]
pub(crate) struct GatewayRuntime {
    pub(crate) token: String,
    pub(crate) port: u16,
    /// The currently successful route, retained for compatibility with existing callers.
    pub(crate) route: Option<GatewayRoute>,
    /// Ordered failover queue. The gateway tries these routes in order for each request.
    pub(crate) routes: Vec<GatewayRoute>,
}

#[derive(Clone)]
struct GatewayServiceState {
    runtime: Arc<RwLock<GatewayRuntime>>,
    client: Client,
    local_store: Option<Arc<Mutex<Store>>>,
    circuit_breakers: Arc<Mutex<HashMap<String, GatewayCircuitBreaker>>>,
    circuit_config: GatewayCircuitConfig,
}

pub(crate) struct GatewayController {
    runtime: Arc<RwLock<GatewayRuntime>>,
    client: Client,
    local_store: Option<Arc<Mutex<Store>>>,
    circuit_breakers: Arc<Mutex<HashMap<String, GatewayCircuitBreaker>>>,
    circuit_config: GatewayCircuitConfig,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
}

#[derive(Clone, Copy, Debug)]
struct GatewayCircuitConfig {
    failure_threshold: u32,
    success_threshold: u32,
    recovery_after: Duration,
    error_rate_threshold: f64,
    min_requests: u32,
}

impl Default for GatewayCircuitConfig {
    fn default() -> Self {
        Self {
            failure_threshold: DEFAULT_CIRCUIT_FAILURE_THRESHOLD,
            success_threshold: DEFAULT_CIRCUIT_SUCCESS_THRESHOLD,
            recovery_after: DEFAULT_CIRCUIT_RECOVERY,
            error_rate_threshold: DEFAULT_CIRCUIT_ERROR_RATE_THRESHOLD,
            min_requests: DEFAULT_CIRCUIT_MIN_REQUESTS,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum GatewayCircuitState {
    Closed,
    Open,
    HalfOpen,
}

#[derive(Clone, Debug)]
struct GatewayCircuitBreaker {
    state: GatewayCircuitState,
    consecutive_failures: u32,
    consecutive_successes: u32,
    total_requests: u32,
    failed_requests: u32,
    opened_at: Option<Instant>,
    half_open_probe_in_flight: bool,
    last_failure_at: Option<String>,
}

impl GatewayCircuitBreaker {
    fn new() -> Self {
        Self {
            state: GatewayCircuitState::Closed,
            consecutive_failures: 0,
            consecutive_successes: 0,
            total_requests: 0,
            failed_requests: 0,
            opened_at: None,
            half_open_probe_in_flight: false,
            last_failure_at: None,
        }
    }

    fn allow_request(&mut self, config: GatewayCircuitConfig) -> Option<bool> {
        match self.state {
            GatewayCircuitState::Closed => Some(false),
            GatewayCircuitState::Open => {
                let recovered = self
                    .opened_at
                    .is_some_and(|opened_at| opened_at.elapsed() >= config.recovery_after);
                if !recovered {
                    return None;
                }
                self.state = GatewayCircuitState::HalfOpen;
                self.consecutive_successes = 0;
                self.half_open_probe_in_flight = false;
                self.allow_request(config)
            }
            GatewayCircuitState::HalfOpen => {
                if self.half_open_probe_in_flight {
                    return None;
                }
                self.half_open_probe_in_flight = true;
                Some(true)
            }
        }
    }

    fn record_success(&mut self, used_half_open_probe: bool, config: GatewayCircuitConfig) {
        if used_half_open_probe {
            self.half_open_probe_in_flight = false;
        }
        self.total_requests = self.total_requests.saturating_add(1);
        self.consecutive_failures = 0;

        if self.state == GatewayCircuitState::HalfOpen {
            self.consecutive_successes = self.consecutive_successes.saturating_add(1);
            if self.consecutive_successes >= config.success_threshold {
                self.close();
            }
        }
    }

    fn record_failure(&mut self, used_half_open_probe: bool, config: GatewayCircuitConfig) {
        if used_half_open_probe {
            self.half_open_probe_in_flight = false;
        }
        self.total_requests = self.total_requests.saturating_add(1);
        self.failed_requests = self.failed_requests.saturating_add(1);
        self.consecutive_successes = 0;
        self.last_failure_at = Some(Utc::now().to_rfc3339());

        if self.state == GatewayCircuitState::HalfOpen {
            self.open();
            return;
        }

        self.consecutive_failures = self.consecutive_failures.saturating_add(1);
        let error_rate = self.failed_requests as f64 / self.total_requests.max(1) as f64;
        if self.consecutive_failures >= config.failure_threshold
            || (self.total_requests >= config.min_requests
                && error_rate >= config.error_rate_threshold)
        {
            self.open();
        }
    }

    fn record_rate_limited(&mut self, used_half_open_probe: bool) {
        if used_half_open_probe {
            // A 429 proves that the route is reachable. Do not leave a
            // half-open probe stuck or treat temporary capacity pressure as
            // a dead route.
            self.close();
        }
    }

    fn open(&mut self) {
        self.state = GatewayCircuitState::Open;
        self.opened_at = Some(Instant::now());
        self.consecutive_failures = 0;
        self.consecutive_successes = 0;
        self.half_open_probe_in_flight = false;
    }

    fn close(&mut self) {
        self.state = GatewayCircuitState::Closed;
        self.opened_at = None;
        self.consecutive_failures = 0;
        self.consecutive_successes = 0;
        self.total_requests = 0;
        self.failed_requests = 0;
        self.half_open_probe_in_flight = false;
    }

    fn route_health(
        &self,
        route: &GatewayRoute,
        config: GatewayCircuitConfig,
    ) -> GatewayRouteHealth {
        let cooldown_remaining_ms = if self.state == GatewayCircuitState::Open {
            self.opened_at
                .map(|opened_at| {
                    u64::try_from(
                        config
                            .recovery_after
                            .saturating_sub(opened_at.elapsed())
                            .as_millis(),
                    )
                    .unwrap_or(u64::MAX)
                })
                .unwrap_or(0)
        } else {
            0
        };
        GatewayRouteHealth {
            station_id: route.station_id.clone(),
            key_id: route.key_id.clone(),
            state: match self.state {
                GatewayCircuitState::Closed => "closed",
                GatewayCircuitState::Open => "open",
                GatewayCircuitState::HalfOpen => "halfOpen",
            }
            .to_string(),
            consecutive_failures: self.consecutive_failures,
            total_requests: self.total_requests,
            failed_requests: self.failed_requests,
            cooldown_remaining_ms,
            last_failure_at: self.last_failure_at.clone(),
        }
    }
}

impl GatewayRouteHealth {
    fn healthy(route: &GatewayRoute) -> Self {
        Self {
            station_id: route.station_id.clone(),
            key_id: route.key_id.clone(),
            state: "closed".into(),
            consecutive_failures: 0,
            total_requests: 0,
            failed_requests: 0,
            cooldown_remaining_ms: 0,
            last_failure_at: None,
        }
    }
}

pub(crate) fn load_or_create_gateway_token() -> Result<String, String> {
    if let Ok(token) = credential_entry(GATEWAY_TOKEN_ID)?.get_password() {
        if !token.trim().is_empty() {
            return Ok(token);
        }
    }
    let token = format!("rh-{}", Uuid::new_v4().simple());
    credential_entry(GATEWAY_TOKEN_ID)?
        .set_password(&token)
        .map_err(|error| error.to_string())?;
    Ok(token)
}

pub(crate) fn gateway_base_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/v1")
}

fn routing_mode_from_setting(value: Option<String>) -> RoutingMode {
    if value.as_deref() == Some("localGateway") {
        RoutingMode::LocalGateway
    } else {
        RoutingMode::CcSwitch
    }
}

pub(crate) fn routing_mode_setting(mode: &RoutingMode) -> &'static str {
    match mode {
        RoutingMode::CcSwitch => "ccSwitch",
        RoutingMode::LocalGateway => "localGateway",
    }
}

pub(crate) fn load_gateway_settings(store: &Store) -> Result<(RoutingMode, u16), String> {
    let mode = routing_mode_from_setting(store.setting("routingMode")?);
    let port = store
        .setting("gatewayPort")?
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(DEFAULT_GATEWAY_PORT);
    store.save_setting("routingMode", routing_mode_setting(&mode))?;
    store.save_setting("gatewayPort", &port.to_string())?;
    Ok((mode, port))
}

pub(crate) fn current_routing_mode(state: &AppState) -> Result<RoutingMode, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?;
    Ok(routing_mode_from_setting(store.setting("routingMode")?))
}

fn route_selection_key(selection: &GatewayRouteSelection) -> String {
    format!("{}\u{0}{}", selection.station_id, selection.key_id)
}

fn normalize_route_selections(
    selections: Vec<GatewayRouteSelection>,
) -> Result<Vec<GatewayRouteSelection>, String> {
    let mut seen = HashSet::new();
    let mut normalized = Vec::with_capacity(selections.len());
    for mut selection in selections {
        selection.station_id = selection.station_id.trim().to_string();
        selection.key_id = selection.key_id.trim().to_string();
        if selection.station_id.is_empty() || selection.key_id.is_empty() {
            return Err("本地网关路由必须同时包含中转站和 API 密钥".into());
        }
        if seen.insert(route_selection_key(&selection)) {
            normalized.push(selection);
        }
    }
    Ok(normalized)
}

fn load_persisted_route_selections(store: &Store) -> Result<Vec<GatewayRouteSelection>, String> {
    if let Some(raw) = store.setting(ACTIVE_GATEWAY_ROUTES_SETTING)? {
        if let Ok(selections) = serde_json::from_str::<Vec<GatewayRouteSelection>>(&raw) {
            return normalize_route_selections(selections);
        }
    }

    let legacy = match (
        store.setting("activeGatewayStationId")?,
        store.setting("activeGatewayKeyId")?,
    ) {
        (Some(station_id), Some(key_id))
            if !station_id.trim().is_empty() && !key_id.trim().is_empty() =>
        {
            vec![GatewayRouteSelection { station_id, key_id }]
        }
        _ => Vec::new(),
    };
    normalize_route_selections(legacy)
}

fn persist_route_selections(
    store: &Store,
    selections: &[GatewayRouteSelection],
) -> Result<(), String> {
    let serialized = serde_json::to_string(selections).map_err(|error| error.to_string())?;
    store.save_setting(ACTIVE_GATEWAY_ROUTES_SETTING, &serialized)?;
    if let Some(first) = selections.first() {
        store.save_setting("activeGatewayStationId", &first.station_id)?;
        store.save_setting("activeGatewayKeyId", &first.key_id)?;
    } else {
        store.save_setting("activeGatewayStationId", "")?;
        store.save_setting("activeGatewayKeyId", "")?;
    }
    Ok(())
}

fn load_direct_route(store: &Store) -> Result<Option<GatewayRouteSelection>, String> {
    let Some(raw) = store.setting(DIRECT_GATEWAY_ROUTE_SETTING)? else {
        return Ok(None);
    };
    let selection = serde_json::from_str::<GatewayRouteSelection>(&raw).ok();
    selection
        .map(|selection| {
            normalize_route_selections(vec![selection])?
                .into_iter()
                .next()
                .ok_or("直转路由配置为空".to_string())
        })
        .transpose()
}

fn persist_direct_route(store: &Store, selection: &GatewayRouteSelection) -> Result<(), String> {
    let serialized = serde_json::to_string(selection).map_err(|error| error.to_string())?;
    store.save_setting(DIRECT_GATEWAY_ROUTE_SETTING, &serialized)
}

fn direct_config_fingerprint(credentials: Option<(&str, Option<&str>)>) -> String {
    let input = match credentials {
        Some((url, Some(key))) => format!("{}\u{0}{key}", station_base(url)),
        Some((url, None)) => format!("{}\u{0}<missing>", station_base(url)),
        None => "<none>".into(),
    };
    format!("sha256:{:x}", Sha256::digest(input.as_bytes()))
}

fn live_direct_route_candidates(
    state: &AppState,
    relay_url: &str,
) -> Result<(Vec<GatewayRouteSelection>, bool, bool), String> {
    let relay_root = station_base(relay_url);
    let store = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?;
    let mut candidates = Vec::new();
    let mut station_found = false;
    let mut snapshot_loaded = false;
    for station in store.list_stations()? {
        if station_base(&station.base_url) != relay_root {
            continue;
        }
        station_found = true;
        if let Some((_, snapshot)) = store.load_snapshot(&station.id)? {
            snapshot_loaded = true;
            candidates.extend(
                snapshot
                    .api_keys
                    .into_iter()
                    .map(|key| GatewayRouteSelection {
                        station_id: station.id.clone(),
                        key_id: key.id,
                    }),
            );
        }
    }
    Ok((candidates, station_found, snapshot_loaded))
}

async fn sync_direct_route_with_codex_config(
    state: &AppState,
) -> Result<Option<GatewayRouteSelection>, String> {
    let current = codex_config::current_relay_credentials()?;
    let fingerprint = direct_config_fingerprint(
        current
            .as_ref()
            .map(|(url, key)| (url.as_str(), key.as_deref())),
    );
    let (stored_fingerprint, stored_route) = {
        let store = state
            .store
            .lock()
            .map_err(|_| "Local database is unavailable".to_string())?;
        (
            store.setting(DIRECT_GATEWAY_CONFIG_FINGERPRINT_SETTING)?,
            load_direct_route(&store)?,
        )
    };
    if stored_fingerprint.as_deref() == Some(fingerprint.as_str()) {
        return Ok(stored_route);
    }

    let Some((relay_url, Some(relay_key))) = current.as_ref() else {
        let store = state
            .store
            .lock()
            .map_err(|_| "Local database is unavailable".to_string())?;
        store.save_setting(DIRECT_GATEWAY_ROUTE_SETTING, "")?;
        store.save_setting(DIRECT_GATEWAY_CONFIG_FINGERPRINT_SETTING, &fingerprint)?;
        return Ok(None);
    };
    let (candidates, station_found, snapshot_loaded) =
        live_direct_route_candidates(state, relay_url)?;
    if candidates.is_empty() {
        if station_found && !snapshot_loaded {
            return Ok(stored_route);
        }
        let store = state
            .store
            .lock()
            .map_err(|_| "Local database is unavailable".to_string())?;
        store.save_setting(DIRECT_GATEWAY_ROUTE_SETTING, "")?;
        store.save_setting(DIRECT_GATEWAY_CONFIG_FINGERPRINT_SETTING, &fingerprint)?;
        return Ok(None);
    }

    let mut inspected = false;
    let mut matched = None;
    for candidate in candidates {
        if let Ok((station, api_key)) =
            read_api_key(state, &candidate.station_id, &candidate.key_id).await
        {
            inspected = true;
            if station_base(&station.base_url) == station_base(relay_url)
                && api_key.trim() == relay_key.trim()
            {
                matched = Some(candidate);
                break;
            }
        }
    }

    // Keep the last known route when the station cannot currently reveal any
    // candidate key. A temporary login/network failure must not look like an
    // external configuration change.
    if matched.is_none() && !inspected {
        return Ok(stored_route);
    }

    let store = state
        .store
        .lock()
        .map_err(|_| "Local database is unavailable".to_string())?;
    if let Some(route) = matched.as_ref() {
        persist_direct_route(&store, route)?;
    } else {
        store.save_setting(DIRECT_GATEWAY_ROUTE_SETTING, "")?;
    }
    store.save_setting(DIRECT_GATEWAY_CONFIG_FINGERPRINT_SETTING, &fingerprint)?;
    Ok(matched)
}

async fn resolve_route_selections(
    state: &AppState,
    selections: &[GatewayRouteSelection],
) -> Result<Vec<GatewayRoute>, String> {
    let mut routes = Vec::with_capacity(selections.len());
    for selection in selections {
        let (station, api_key) =
            read_api_key(state, &selection.station_id, &selection.key_id).await?;
        if api_key.trim().is_empty() {
            return Err(format!(
                "API 密钥 {} 为空，无法启用本地网关",
                selection.key_id
            ));
        }
        routes.push(GatewayRoute {
            station_id: selection.station_id.clone(),
            key_id: selection.key_id.clone(),
            provider_name: station.name.clone(),
            upstream_base_url: api_base_url(&station.base_url),
            api_key,
        });
    }
    Ok(routes)
}

pub(crate) async fn set_tray_routing_mode(app: AppHandle, mode: RoutingMode) -> Result<(), String> {
    let state = app.state::<AppState>();
    set_routing_mode(&state, mode).await.map(|_| ())
}

pub(crate) async fn set_gateway_route(
    state: &AppState,
    station_id: String,
    key_id: String,
) -> Result<(), String> {
    let selection = normalize_route_selections(vec![GatewayRouteSelection { station_id, key_id }])?
        .into_iter()
        .next()
        .ok_or("至少需要启用一个 API 密钥作为路由")?;
    if current_routing_mode(state)? == RoutingMode::LocalGateway {
        set_gateway_routes(state, vec![selection]).await?;
        return Ok(());
    }

    let route = resolve_route_selections(state, std::slice::from_ref(&selection))
        .await?
        .into_iter()
        .next()
        .ok_or("无法解析直转路由")?;
    {
        let store = state
            .store
            .lock()
            .map_err(|_| "本地数据库不可用".to_string())?;
        persist_direct_route(&store, &selection)?;
    }
    state.gateway.clear_route().await;
    codex_config::activate_direct_route(
        state,
        &route.provider_name,
        &route.upstream_base_url,
        &route.api_key,
        RoutingMode::CcSwitch,
    )?;
    Ok(())
}

pub(crate) async fn set_gateway_routes(
    state: &AppState,
    selections: Vec<GatewayRouteSelection>,
) -> Result<(), String> {
    if current_routing_mode(state)? != RoutingMode::LocalGateway {
        return Err("请先切换到本地网关模式".into());
    }
    let selections = normalize_route_selections(selections)?;
    if selections.is_empty() {
        return Err("至少需要启用一个 API 密钥作为本地网关路由".into());
    }
    let routes = resolve_route_selections(state, &selections).await?;
    state.gateway.set_routes(routes).await;
    {
        let store = state
            .store
            .lock()
            .map_err(|_| "本地数据库不可用".to_string())?;
        persist_route_selections(&store, &selections)?;
        persist_direct_route(&store, &selections[0])?;
    }
    let runtime = state.gateway.runtime_snapshot().await;
    codex_config::activate_local_gateway(state, &gateway_base_url(runtime.port), &runtime.token)?;
    state.gateway.start().await
}

pub(crate) async fn get_status(state: &AppState) -> Result<GatewayStatus, String> {
    let mode = current_routing_mode(state)?;
    let runtime = state.gateway.runtime_snapshot().await;
    let (route_queue, direct_route) = if runtime.routes.is_empty() {
        let store = state
            .store
            .lock()
            .map_err(|_| "本地数据库不可用".to_string())?;
        (
            load_persisted_route_selections(&store)?,
            load_direct_route(&store)?,
        )
    } else {
        (
            runtime
                .routes
                .iter()
                .map(|route| GatewayRouteSelection {
                    station_id: route.station_id.clone(),
                    key_id: route.key_id.clone(),
                })
                .collect(),
            None,
        )
    };
    let direct_route = if mode == RoutingMode::CcSwitch {
        sync_direct_route_with_codex_config(state).await?
    } else {
        direct_route
    };
    let active_route = if mode == RoutingMode::CcSwitch {
        direct_route
    } else {
        runtime.route.as_ref().map(|route| GatewayRouteSelection {
            station_id: route.station_id.clone(),
            key_id: route.key_id.clone(),
        })
    };
    Ok(GatewayStatus {
        mode,
        running: state.gateway.is_running(),
        port: runtime.port,
        base_url: gateway_base_url(runtime.port),
        active_station_id: active_route.as_ref().map(|route| route.station_id.clone()),
        active_key_id: active_route.as_ref().map(|route| route.key_id.clone()),
        has_active_route: active_route.is_some(),
        route_queue,
        route_health: state.gateway.route_health().await,
    })
}

pub(crate) async fn stop(state: &AppState) -> Result<GatewayStatus, String> {
    state.gateway.stop();
    get_status(state).await
}

pub(crate) async fn credentials(state: &AppState) -> Result<GatewayCredentials, String> {
    if current_routing_mode(state)? != RoutingMode::LocalGateway {
        return Err("请先切换到本地网关模式".into());
    }
    let runtime = state.gateway.runtime_snapshot().await;
    Ok(GatewayCredentials {
        base_url: gateway_base_url(runtime.port),
        token: runtime.token,
    })
}

async fn restore_gateway_runtime(
    state: &AppState,
    previous_runtime: &GatewayRuntime,
    was_running: bool,
) -> Result<(), String> {
    state.gateway.stop();
    state.gateway.clear_route().await;
    let routes = if previous_runtime.routes.is_empty() {
        previous_runtime
            .route
            .clone()
            .into_iter()
            .collect::<Vec<_>>()
    } else {
        previous_runtime.routes.clone()
    };
    if !routes.is_empty() {
        state.gateway.set_routes(routes).await;
    }
    if was_running {
        state.gateway.start().await?;
    }
    Ok(())
}

fn restore_direct_route_setting(
    state: &AppState,
    previous_value: Option<&str>,
) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "鏈湴鏁版嵁搴撲笉鍙敤".to_string())?
        .save_setting(
            DIRECT_GATEWAY_ROUTE_SETTING,
            previous_value.unwrap_or_default(),
        )
}

fn transition_error(error: String, rollback: Result<(), String>) -> String {
    match rollback {
        Ok(()) => error,
        Err(rollback_error) => format!("{error}；状态回滚失败：{rollback_error}"),
    }
}

async fn rollback_to_local_gateway(
    state: &AppState,
    previous_runtime: &GatewayRuntime,
    was_running: bool,
) -> Result<(), String> {
    codex_config::activate_local_gateway(
        state,
        &gateway_base_url(previous_runtime.port),
        &previous_runtime.token,
    )?;
    restore_gateway_runtime(state, previous_runtime, was_running).await
}

async fn rollback_to_direct_route(
    state: &AppState,
    previous_runtime: &GatewayRuntime,
    was_running: bool,
) -> Result<(), String> {
    codex_config::restore_local_gateway(state)?;
    restore_gateway_runtime(state, previous_runtime, was_running).await
}

pub(crate) async fn set_routing_mode(
    state: &AppState,
    mode: RoutingMode,
) -> Result<GatewayStatus, String> {
    let previous_mode = current_routing_mode(state)?;
    if previous_mode == mode {
        return get_status(state).await;
    }
    let previous_runtime = state.gateway.runtime_snapshot().await;
    let was_running = state.gateway.is_running();
    let previous_direct_route_setting = {
        let store = state
            .store
            .lock()
            .map_err(|_| "鏈湴鏁版嵁搴撲笉鍙敤".to_string())?;
        store.setting(DIRECT_GATEWAY_ROUTE_SETTING)?
    };

    match mode {
        RoutingMode::CcSwitch => {
            let selection = {
                let store = state
                    .store
                    .lock()
                    .map_err(|_| "本地数据库不可用".to_string())?;
                load_direct_route(&store)?.or_else(|| {
                    load_persisted_route_selections(&store)
                        .ok()
                        .and_then(|items| items.into_iter().next())
                })
            }
            .ok_or("直转至少需要一条站点 / API 密钥")?;
            let route = resolve_route_selections(state, std::slice::from_ref(&selection))
                .await?
                .into_iter()
                .next()
                .ok_or("无法解析直转路由")?;
            {
                let store = state
                    .store
                    .lock()
                    .map_err(|_| "本地数据库不可用".to_string())?;
                if let Err(error) = persist_direct_route(&store, &selection) {
                    let rollback = restore_direct_route_setting(
                        state,
                        previous_direct_route_setting.as_deref(),
                    );
                    return Err(transition_error(error, rollback));
                }
            }
            if let Err(error) = codex_config::restore_local_gateway(state) {
                let rollback =
                    restore_direct_route_setting(state, previous_direct_route_setting.as_deref());
                return Err(transition_error(error, rollback));
            }
            state.gateway.stop();
            state.gateway.clear_route().await;
            if let Err(error) = codex_config::activate_direct_route(
                state,
                &route.provider_name,
                &route.upstream_base_url,
                &route.api_key,
                RoutingMode::CcSwitch,
            ) {
                let rollback =
                    rollback_to_local_gateway(state, &previous_runtime, was_running).await;
                let rollback = rollback.and_then(|()| {
                    restore_direct_route_setting(state, previous_direct_route_setting.as_deref())
                });
                return Err(transition_error(error, rollback));
            }
        }
        RoutingMode::LocalGateway => {
            if state.gateway.runtime_snapshot().await.routes.is_empty() {
                restore_persisted_gateway_route(state).await?;
            }
            let runtime = state.gateway.runtime_snapshot().await;
            if runtime.routes.is_empty() {
                return Err("本地路由至少需要一条站点 / API 密钥".into());
            }
            if let Err(error) = codex_config::activate_local_gateway(
                state,
                &gateway_base_url(runtime.port),
                &runtime.token,
            ) {
                let rollback = restore_gateway_runtime(state, &previous_runtime, was_running).await;
                return Err(transition_error(error, rollback));
            }
            if let Err(error) = state.gateway.start().await {
                let rollback =
                    rollback_to_direct_route(state, &previous_runtime, was_running).await;
                return Err(transition_error(error, rollback));
            }
        }
    }
    let mode_save = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_setting("routingMode", routing_mode_setting(&mode));
    if let Err(error) = mode_save {
        let rollback = match mode {
            RoutingMode::CcSwitch => {
                let rollback =
                    rollback_to_local_gateway(state, &previous_runtime, was_running).await;
                rollback.and_then(|()| {
                    restore_direct_route_setting(state, previous_direct_route_setting.as_deref())
                })
            }
            RoutingMode::LocalGateway => {
                rollback_to_direct_route(state, &previous_runtime, was_running).await
            }
        };
        return Err(transition_error(error, rollback));
    }
    get_status(state).await
}

pub(crate) async fn set_port(state: &AppState, port: u16) -> Result<GatewayStatus, String> {
    if port == 0 {
        return Err("本地网关端口必须在 1 到 65535 之间".into());
    }
    let was_running = state.gateway.is_running();
    if was_running {
        state.gateway.stop();
    }
    state.gateway.set_port(port).await;
    if current_routing_mode(state)? == RoutingMode::LocalGateway {
        let runtime = state.gateway.runtime_snapshot().await;
        codex_config::activate_local_gateway(
            state,
            &gateway_base_url(runtime.port),
            &runtime.token,
        )?;
    }
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_setting("gatewayPort", &port.to_string())?;
    if was_running && current_routing_mode(state)? == RoutingMode::LocalGateway {
        state.gateway.start().await?;
    }
    get_status(state).await
}

pub(crate) async fn start(state: &AppState) -> Result<GatewayStatus, String> {
    if current_routing_mode(state)? != RoutingMode::LocalGateway {
        return Err("请先切换到本地路由模式".into());
    }
    if state.gateway.runtime_snapshot().await.routes.is_empty() {
        restore_persisted_gateway_route(state).await?;
    }
    let runtime = state.gateway.runtime_snapshot().await;
    if runtime.routes.is_empty() {
        return Err("本地路由至少需要一条站点 / API 密钥".into());
    }
    codex_config::activate_local_gateway(state, &gateway_base_url(runtime.port), &runtime.token)?;
    state.gateway.start().await?;
    get_status(state).await
}

pub(crate) async fn rotate_token(state: &AppState) -> Result<GatewayCredentials, String> {
    if current_routing_mode(state)? != RoutingMode::LocalGateway {
        return Err("请先切换到本地路由模式".into());
    }
    let token = format!("rh-{}", Uuid::new_v4().simple());
    let old_token = state.gateway.runtime_snapshot().await.token;
    let port = state.gateway.runtime_snapshot().await.port;
    codex_config::activate_local_gateway(state, &gateway_base_url(port), &token)?;
    credential_entry(GATEWAY_TOKEN_ID)?
        .set_password(&token)
        .map_err(|error| {
            let _ =
                codex_config::activate_local_gateway(state, &gateway_base_url(port), &old_token);
            error.to_string()
        })?;
    state.gateway.rotate_token(token.clone()).await;
    Ok(GatewayCredentials {
        base_url: gateway_base_url(port),
        token,
    })
}

pub(crate) async fn import_to_cc_switch(
    app: AppHandle,
    state: &AppState,
    station_id: String,
    key_id: String,
    target_app: String,
) -> Result<(), String> {
    if current_routing_mode(state)? != RoutingMode::CcSwitch {
        return Err("本地路由模式下不能导出外部配置".into());
    }
    if !matches!(target_app.as_str(), "claude" | "codex" | "gemini") {
        return Err("外部配置目标仅支持 Claude、Codex 或 Gemini".into());
    }
    let (station, key) = read_api_key(state, &station_id, &key_id).await?;
    let mut link = Url::parse("ccswitch://v1/import").map_err(|error| error.to_string())?;
    let api_base = api_base_url(&station.base_url);
    link.query_pairs_mut()
        .append_pair("resource", "provider")
        .append_pair("app", &target_app)
        .append_pair("name", &format!("{} - {}", station.name, key_id))
        .append_pair("endpoint", &api_base)
        .append_pair("homepage", &station.base_url)
        .append_pair("apiKey", &key);
    app.opener()
        .open_url(link.as_str(), None::<&str>)
        .map_err(|error| format!("无法打开外部配置导入：{error}"))
}

impl GatewayController {
    pub(crate) fn new(
        client: Client,
        token: String,
        port: u16,
        local_store: Arc<Mutex<Store>>,
    ) -> Self {
        Self::new_with_circuit_config(
            client,
            token,
            port,
            GatewayCircuitConfig::default(),
            Some(local_store),
        )
    }

    fn new_with_circuit_config(
        client: Client,
        token: String,
        port: u16,
        circuit_config: GatewayCircuitConfig,
        local_store: Option<Arc<Mutex<Store>>>,
    ) -> Self {
        Self {
            runtime: Arc::new(RwLock::new(GatewayRuntime {
                token,
                port,
                route: None,
                routes: Vec::new(),
            })),
            client,
            local_store,
            circuit_breakers: Arc::new(Mutex::new(HashMap::new())),
            circuit_config,
            shutdown: Mutex::new(None),
        }
    }

    pub(crate) fn is_running(&self) -> bool {
        self.shutdown
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or(false)
    }

    pub(crate) async fn start(&self) -> Result<(), String> {
        if self.is_running() {
            return Ok(());
        }
        let port = self.runtime.read().await.port;
        let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port)))
            .await
            .map_err(|error| format!("无法监听 127.0.0.1:{port}：{error}"))?;
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        let mut guard = self
            .shutdown
            .lock()
            .map_err(|_| "本地网关状态不可用".to_string())?;
        if guard.is_some() {
            return Ok(());
        }
        *guard = Some(shutdown_tx);
        drop(guard);

        let app = Router::new()
            .route("/v1", any(gateway_proxy))
            .route("/v1/{*path}", any(gateway_proxy))
            .with_state(GatewayServiceState {
                runtime: self.runtime.clone(),
                client: self.client.clone(),
                local_store: self.local_store.clone(),
                circuit_breakers: self.circuit_breakers.clone(),
                circuit_config: self.circuit_config,
            });
        tauri::async_runtime::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await;
        });
        Ok(())
    }

    pub(crate) fn stop(&self) {
        if let Ok(mut guard) = self.shutdown.lock() {
            if let Some(sender) = guard.take() {
                let _ = sender.send(());
            }
        }
    }

    pub(crate) async fn set_port(&self, port: u16) {
        self.runtime.write().await.port = port;
    }

    pub(crate) async fn set_routes(&self, routes: Vec<GatewayRoute>) {
        if let Ok(mut breakers) = self.circuit_breakers.lock() {
            breakers.clear();
        }
        let active = routes.first().cloned();
        let mut runtime = self.runtime.write().await;
        runtime.route = active;
        runtime.routes = routes;
    }

    pub(crate) async fn route_health(&self) -> Vec<GatewayRouteHealth> {
        let routes = self.runtime.read().await.routes.clone();
        let breakers = self.circuit_breakers.lock().ok();
        routes
            .iter()
            .map(|route| {
                breakers
                    .as_ref()
                    .and_then(|items| items.get(&gateway_route_key(route)))
                    .map(|breaker| breaker.route_health(route, self.circuit_config))
                    .unwrap_or_else(|| GatewayRouteHealth::healthy(route))
            })
            .collect()
    }

    pub(crate) async fn reset_route_health(
        &self,
        station_id: &str,
        key_id: &str,
    ) -> Result<(), String> {
        let route_key = format!("{}\u{0}{}", station_id.trim(), key_id.trim());
        let routes = self.runtime.read().await.routes.clone();
        if !routes
            .iter()
            .any(|route| gateway_route_key(route) == route_key)
        {
            return Err("指定的路由不在当前 Gateway 路由池中".into());
        }
        let mut breakers = self
            .circuit_breakers
            .lock()
            .map_err(|_| "Gateway 熔断状态不可用".to_string())?;
        breakers.remove(&route_key);
        Ok(())
    }

    pub(crate) async fn clear_route(&self) {
        if let Ok(mut breakers) = self.circuit_breakers.lock() {
            breakers.clear();
        }
        let mut runtime = self.runtime.write().await;
        runtime.route = None;
        runtime.routes.clear();
    }

    pub(crate) async fn rotate_token(&self, token: String) {
        self.runtime.write().await.token = token;
    }

    pub(crate) async fn runtime_snapshot(&self) -> GatewayRuntime {
        self.runtime.read().await.clone()
    }
}

fn gateway_error(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (
        status,
        axum::Json(json!({
            "error": {
                "message": message.into(),
                "type": "relayhub_gateway_error",
                "code": code,
            }
        })),
    )
        .into_response()
}

fn gateway_request_authorized(headers: &HeaderMap, token: &str) -> bool {
    headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.strip_prefix("Bearer ") == Some(token))
}

fn forwarded_request_headers(headers: &HeaderMap) -> HeaderMap {
    let mut forwarded = HeaderMap::new();
    for (name, value) in headers {
        if name == header::AUTHORIZATION
            || name == header::HOST
            || name == header::CONTENT_LENGTH
            || is_hop_by_hop_header(name)
        {
            continue;
        }
        forwarded.append(name.clone(), value.clone());
    }
    forwarded
}

fn can_stream_request(headers: &HeaderMap, route_count: usize, is_responses_request: bool) -> bool {
    if is_responses_request || route_count != 1 {
        return false;
    }
    headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|length| length <= MAX_GATEWAY_REQUEST_BYTES as u64)
}

fn is_hop_by_hop_header(name: &HeaderName) -> bool {
    matches!(
        name.as_str().to_ascii_lowercase().as_str(),
        "connection"
            | "keep-alive"
            | "proxy-authenticate"
            | "proxy-authorization"
            | "te"
            | "trailer"
            | "transfer-encoding"
            | "upgrade"
    )
}

fn gateway_upstream_url(
    upstream_base_url: &str,
    uri: &axum::http::Uri,
    replacement_path: Option<&str>,
) -> Result<String, String> {
    let path = replacement_path.unwrap_or(uri.path());
    let suffix = path.strip_prefix("/v1").ok_or("网关仅支持 /v1 请求")?;
    let query = uri
        .query()
        .map(|value| format!("?{value}"))
        .unwrap_or_default();
    let target = format!(
        "{}{}{}",
        upstream_base_url.trim_end_matches('/'),
        suffix,
        query
    );
    Url::parse(&target).map_err(|_| "活动路由的上游地址无效".to_string())?;
    Ok(target)
}

#[derive(Debug)]
struct BufferedGatewayResponse {
    status: StatusCode,
    headers: HeaderMap,
    body: Bytes,
    route: GatewayRoute,
}

fn gateway_route_label(route: &GatewayRoute) -> String {
    format!(
        "station_id={} key_id={} provider={} upstream={}",
        route.station_id, route.key_id, route.provider_name, route.upstream_base_url
    )
}

fn gateway_log(request_id: Option<&str>, message: impl std::fmt::Display) {
    if let Some(request_id) = request_id {
        eprintln!("[local-gateway][request={request_id}] {message}");
    } else {
        eprintln!("[local-gateway] {message}");
    }
}

fn gateway_reqwest_error_kind(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "timeout"
    } else if error.is_connect() {
        "connect"
    } else if error.is_request() {
        "request"
    } else if error.is_body() {
        "body"
    } else if error.is_decode() {
        "decode"
    } else {
        "other"
    }
}

fn log_gateway_upstream_response(
    request_id: &str,
    route: &GatewayRoute,
    status: StatusCode,
    latency_ms: i64,
    action: &str,
) {
    gateway_log(
        Some(request_id),
        format_args!(
            "upstream response route={} status={} latency_ms={} action={action}",
            gateway_route_label(route),
            status.as_u16(),
            latency_ms,
        ),
    );
}

fn log_gateway_upstream_error(
    request_id: &str,
    route: &GatewayRoute,
    stage: &str,
    error: &reqwest::Error,
) {
    gateway_log(
        Some(request_id),
        format_args!(
            "upstream error route={} stage={stage} kind={}",
            gateway_route_label(route),
            gateway_reqwest_error_kind(error),
        ),
    );
}

fn log_gateway_request_finished(
    request_id: &str,
    started_at: Instant,
    status: StatusCode,
    outcome: &str,
) {
    gateway_log(
        Some(request_id),
        format_args!(
            "request finished status={} duration_ms={} outcome={outcome}",
            status.as_u16(),
            elapsed_ms(started_at),
        ),
    );
}

fn log_gateway_circuit_transition(
    route: &GatewayRoute,
    before: GatewayCircuitState,
    after: GatewayCircuitState,
    breaker: &GatewayCircuitBreaker,
) {
    if before != after {
        gateway_log(
            None,
            format_args!(
                "circuit transition route={} from={before:?} to={after:?} consecutive_failures={} total_requests={} failed_requests={}",
                gateway_route_label(route),
                breaker.consecutive_failures,
                breaker.total_requests,
                breaker.failed_requests,
            ),
        );
    }
}

fn gateway_route_key(route: &GatewayRoute) -> String {
    format!("{}\u{0}{}", route.station_id, route.key_id)
}

fn allow_gateway_route(state: &GatewayServiceState, route: &GatewayRoute) -> Option<bool> {
    let key = gateway_route_key(route);
    let mut breakers = state.circuit_breakers.lock().ok()?;
    let breaker = breakers
        .entry(key)
        .or_insert_with(GatewayCircuitBreaker::new);
    breaker.allow_request(state.circuit_config)
}

fn record_gateway_route_result(
    state: &GatewayServiceState,
    route: &GatewayRoute,
    used_half_open_probe: bool,
    success: bool,
) {
    let key = gateway_route_key(route);
    if let Ok(mut breakers) = state.circuit_breakers.lock() {
        let breaker = breakers
            .entry(key)
            .or_insert_with(GatewayCircuitBreaker::new);
        let before = breaker.state;
        if success {
            breaker.record_success(used_half_open_probe, state.circuit_config);
        } else {
            breaker.record_failure(used_half_open_probe, state.circuit_config);
        }
        log_gateway_circuit_transition(route, before, breaker.state, breaker);
    }
}

fn record_gateway_route_rate_limit(
    state: &GatewayServiceState,
    route: &GatewayRoute,
    used_half_open_probe: bool,
) {
    let key = gateway_route_key(route);
    if let Ok(mut breakers) = state.circuit_breakers.lock() {
        let breaker = breakers
            .entry(key)
            .or_insert_with(GatewayCircuitBreaker::new);
        let before = breaker.state;
        breaker.record_rate_limited(used_half_open_probe);
        log_gateway_circuit_transition(route, before, breaker.state, breaker);
    }
}

fn record_gateway_route_response(
    state: &GatewayServiceState,
    route: &GatewayRoute,
    used_half_open_probe: bool,
    status: StatusCode,
) {
    if status == StatusCode::TOO_MANY_REQUESTS {
        record_gateway_route_rate_limit(state, route, used_half_open_probe);
    } else {
        record_gateway_route_result(state, route, used_half_open_probe, false);
    }
}

fn is_retryable_upstream_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::UNAUTHORIZED
            | StatusCode::FORBIDDEN
            | StatusCode::REQUEST_TIMEOUT
            | StatusCode::TOO_MANY_REQUESTS
    ) || status.is_server_error()
}

fn build_gateway_response(status: StatusCode, headers: &HeaderMap, body: Body) -> Response {
    let mut response = Response::builder().status(status);
    if let Some(output_headers) = response.headers_mut() {
        for (name, value) in headers {
            if name == header::CONTENT_LENGTH || is_hop_by_hop_header(name) {
                continue;
            }
            output_headers.append(name.clone(), value.clone());
        }
    }
    response.body(body).unwrap_or_else(|_| {
        gateway_error(
            StatusCode::BAD_GATEWAY,
            "response_build_failed",
            "无法创建上游响应",
        )
    })
}

#[derive(Default)]
struct ParsedLocalUsage {
    input_tokens: u64,
    output_tokens: u64,
    cache_read_tokens: u64,
    cache_creation_tokens: u64,
    model: Option<String>,
}

fn json_integer(value: &Value) -> Option<u64> {
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|value| u64::try_from(value).ok()))
        .or_else(|| value.as_f64().map(|value| value.max(0.0) as u64))
        .or_else(|| value.as_str().and_then(|value| value.parse::<u64>().ok()))
}

fn json_field(value: &Value, names: &[&str]) -> Option<u64> {
    names
        .iter()
        .find_map(|name| value.get(*name).and_then(json_integer))
}

fn json_path_field(value: &Value, paths: &[&[&str]]) -> Option<u64> {
    paths.iter().find_map(|path| {
        let mut current = value;
        for key in *path {
            current = current.get(*key)?;
        }
        json_integer(current)
    })
}

fn collect_usage_values<'a>(value: &'a Value, output: &mut Vec<&'a Value>) {
    match value {
        Value::Object(fields) => {
            for (key, child) in fields {
                if matches!(
                    key.to_ascii_lowercase().as_str(),
                    "usage" | "usagemetadata" | "usage_metadata" | "token_usage"
                ) {
                    output.push(child);
                }
                collect_usage_values(child, output);
            }
        }
        Value::Array(items) => {
            for item in items {
                collect_usage_values(item, output);
            }
        }
        _ => {}
    }
}

fn merge_usage_value(usage: &mut ParsedLocalUsage, value: &Value) {
    let input = json_field(
        value,
        &[
            "input_tokens",
            "inputTokens",
            "prompt_tokens",
            "promptTokenCount",
        ],
    );
    let output = json_field(
        value,
        &[
            "output_tokens",
            "outputTokens",
            "completion_tokens",
            "candidatesTokenCount",
        ],
    );
    let cache_read = json_field(
        value,
        &[
            "cache_read_input_tokens",
            "cache_read_tokens",
            "cached_tokens",
            "cachedContentTokenCount",
        ],
    )
    .or_else(|| {
        json_path_field(
            value,
            &[
                &["input_tokens_details", "cached_tokens"],
                &["prompt_tokens_details", "cached_tokens"],
                &["input_tokens_details", "cache_read_tokens"],
                &["prompt_tokens_details", "cache_read_tokens"],
            ],
        )
    });
    let cache_creation = json_field(
        value,
        &[
            "cache_creation_input_tokens",
            "cache_creation_tokens",
            "cache_write_tokens",
        ],
    )
    .or_else(|| {
        json_path_field(
            value,
            &[
                &["input_tokens_details", "cache_write_tokens"],
                &["prompt_tokens_details", "cache_write_tokens"],
            ],
        )
    });
    if let Some(value) = input {
        usage.input_tokens = usage.input_tokens.max(value);
    }
    if let Some(value) = output {
        usage.output_tokens = usage.output_tokens.max(value);
    }
    if let Some(value) = cache_read {
        usage.cache_read_tokens = usage.cache_read_tokens.max(value);
    }
    if let Some(value) = cache_creation {
        usage.cache_creation_tokens = usage.cache_creation_tokens.max(value);
    }
}

fn find_model(value: &Value) -> Option<String> {
    match value {
        Value::Object(fields) => fields
            .get("model")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .or_else(|| fields.values().find_map(find_model)),
        Value::Array(items) => items.iter().find_map(find_model),
        _ => None,
    }
}

fn merge_local_usage_value(usage: &mut ParsedLocalUsage, value: &Value) {
    if usage.model.is_none() {
        usage.model = find_model(value);
    }
    let mut usage_values = Vec::new();
    collect_usage_values(value, &mut usage_values);
    for value in usage_values {
        merge_usage_value(usage, value);
    }
}

fn parse_local_usage(body: &[u8]) -> ParsedLocalUsage {
    let mut values = Vec::new();
    if let Ok(value) = serde_json::from_slice::<Value>(body) {
        values.push(value);
    } else {
        for line in String::from_utf8_lossy(body).lines() {
            let Some(data) = line.trim().strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(data) {
                values.push(value);
            }
        }
    }
    let mut usage = ParsedLocalUsage::default();
    for value in &values {
        merge_local_usage_value(&mut usage, value);
    }
    usage
}

#[derive(Default)]
struct LocalUsageAccumulator {
    pending: Vec<u8>,
    usage: ParsedLocalUsage,
}

impl LocalUsageAccumulator {
    fn push(&mut self, chunk: &[u8]) {
        self.pending.extend_from_slice(chunk);
        while let Some(newline) = self.pending.iter().position(|byte| *byte == b'\n') {
            let line = self.pending.drain(..=newline).collect::<Vec<_>>();
            self.process_line(&line);
        }
    }

    fn finish(&mut self) -> ParsedLocalUsage {
        if !self.pending.is_empty() {
            let line = std::mem::take(&mut self.pending);
            self.process_line(&line);
        }
        std::mem::take(&mut self.usage)
    }

    fn process_line(&mut self, line: &[u8]) {
        let line = String::from_utf8_lossy(line);
        let Some(data) = line.trim().strip_prefix("data:").map(str::trim) else {
            return;
        };
        if data.is_empty() || data == "[DONE]" {
            return;
        }
        if let Ok(value) = serde_json::from_str::<Value>(data) {
            merge_local_usage_value(&mut self.usage, &value);
        }
    }
}

fn request_model_from_value(value: &Value) -> Option<String> {
    value
        .get("model")
        .and_then(Value::as_str)
        .map(str::to_string)
        .filter(|value| !value.trim().is_empty())
}

fn request_model(payload: &[u8]) -> Option<String> {
    serde_json::from_slice::<Value>(payload)
        .ok()
        .and_then(|value| request_model_from_value(&value))
}

fn gateway_app_type(uri: &axum::http::Uri, headers: &HeaderMap) -> String {
    let marker = headers
        .get("x-cc-switch-app")
        .or_else(|| headers.get("x-relayhub-app"))
        .and_then(|value| value.to_str().ok())
        .map(str::to_ascii_lowercase);
    let path = uri.path().to_ascii_lowercase();
    let user_agent = headers
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let candidate = marker.as_deref().unwrap_or_default();
    if candidate.contains("claude") || path.contains("messages") || user_agent.contains("claude") {
        "claude".into()
    } else if candidate.contains("gemini")
        || path.contains("generatecontent")
        || user_agent.contains("gemini")
    {
        "gemini".into()
    } else if candidate.contains("grok") {
        "grokbuild".into()
    } else if candidate.contains("codex")
        || path.contains("responses")
        || user_agent.contains("codex")
    {
        "codex".into()
    } else {
        "openai".into()
    }
}

fn cache_inclusive_app(app_type: &str) -> bool {
    matches!(app_type, "codex" | "gemini" | "grokbuild" | "openai")
}

fn elapsed_ms(started_at: Instant) -> i64 {
    started_at.elapsed().as_millis().min(i64::MAX as u128) as i64
}

fn record_local_usage(
    local_store: Option<&Arc<Mutex<Store>>>,
    route: &GatewayRoute,
    uri: &axum::http::Uri,
    app_type: &str,
    request_model: Option<&str>,
    response_body: &[u8],
    status: StatusCode,
    latency_ms: i64,
    duration_ms: Option<i64>,
    first_token_ms: Option<i64>,
    is_streaming: bool,
    error_message: Option<String>,
) {
    let parsed = parse_local_usage(response_body);
    record_local_usage_parsed(
        local_store,
        route,
        uri,
        app_type,
        request_model,
        parsed,
        status,
        latency_ms,
        duration_ms,
        first_token_ms,
        is_streaming,
        error_message,
    );
}

fn record_local_usage_parsed(
    local_store: Option<&Arc<Mutex<Store>>>,
    route: &GatewayRoute,
    uri: &axum::http::Uri,
    app_type: &str,
    request_model: Option<&str>,
    parsed: ParsedLocalUsage,
    status: StatusCode,
    latency_ms: i64,
    duration_ms: Option<i64>,
    first_token_ms: Option<i64>,
    is_streaming: bool,
    error_message: Option<String>,
) {
    let Some(local_store) = local_store else {
        return;
    };
    let requested_model = request_model
        .filter(|value| !value.trim().is_empty())
        .map(str::to_string);
    let model = parsed
        .model
        .filter(|value| !value.trim().is_empty())
        .or_else(|| requested_model.clone())
        .unwrap_or_else(|| "unknown".into());
    let status_error = if status.as_u16() >= 400 {
        Some(format!("上游返回 HTTP {}", status.as_u16()))
    } else {
        None
    };
    let record = LocalUsageRecord {
        request_id: Uuid::new_v4().to_string(),
        provider_id: route.station_id.clone(),
        provider_name: route.provider_name.clone(),
        app_type: app_type.to_string(),
        model,
        request_model: requested_model,
        input_tokens: parsed.input_tokens.min(i64::MAX as u64) as i64,
        output_tokens: parsed.output_tokens.min(i64::MAX as u64) as i64,
        cache_read_tokens: parsed.cache_read_tokens.min(i64::MAX as u64) as i64,
        cache_creation_tokens: parsed.cache_creation_tokens.min(i64::MAX as u64) as i64,
        input_token_semantics: if cache_inclusive_app(app_type) { 1 } else { 0 },
        latency_ms,
        first_token_ms,
        duration_ms,
        status_code: status.as_u16(),
        error_message: error_message.or(status_error),
        is_streaming,
        endpoint: Some(uri.path().to_string()),
        key_id: Some(route.key_id.clone()),
        created_at: Utc::now().timestamp(),
    };
    if let Ok(store) = local_store.lock() {
        let _ = store.record_local_usage(&record);
    }
}

struct LoggingResponseMeta {
    request_id: String,
    local_store: Option<Arc<Mutex<Store>>>,
    route: GatewayRoute,
    uri: axum::http::Uri,
    app_type: String,
    request_model: Option<String>,
    status: StatusCode,
    latency_ms: i64,
    started_at: Instant,
}

struct LoggingResponseStream<E> {
    inner: Pin<Box<dyn Stream<Item = Result<Bytes, E>> + Send>>,
    usage: LocalUsageAccumulator,
    meta: LoggingResponseMeta,
    completed: bool,
}

impl<E> LoggingResponseStream<E> {
    fn new(
        stream: impl Stream<Item = Result<Bytes, E>> + Send + 'static,
        meta: LoggingResponseMeta,
    ) -> Self {
        Self {
            inner: Box::pin(stream),
            usage: LocalUsageAccumulator::default(),
            meta,
            completed: false,
        }
    }

    fn finish(&mut self, error_message: Option<String>) {
        if self.completed {
            return;
        }
        self.completed = true;
        let parsed = self.usage.finish();
        let duration_ms = elapsed_ms(self.meta.started_at);
        let outcome = if error_message.is_some() {
            "error"
        } else {
            "success"
        };
        gateway_log(
            Some(&self.meta.request_id),
            format_args!(
                "stream finished route={} status={} duration_ms={} outcome={outcome}",
                gateway_route_label(&self.meta.route),
                self.meta.status.as_u16(),
                duration_ms,
            ),
        );
        record_local_usage_parsed(
            self.meta.local_store.as_ref(),
            &self.meta.route,
            &self.meta.uri,
            &self.meta.app_type,
            self.meta.request_model.as_deref(),
            parsed,
            self.meta.status,
            self.meta.latency_ms,
            Some(duration_ms),
            Some(self.meta.latency_ms),
            true,
            error_message,
        );
    }
}

impl<E> Stream for LoggingResponseStream<E>
where
    E: std::error::Error + Send + Sync + 'static,
{
    type Item = Result<Bytes, E>;

    fn poll_next(mut self: Pin<&mut Self>, context: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        let this = self.as_mut().get_mut();
        match this.inner.as_mut().poll_next(context) {
            Poll::Ready(Some(Ok(chunk))) => {
                this.usage.push(&chunk);
                Poll::Ready(Some(Ok(chunk)))
            }
            Poll::Ready(Some(Err(error))) => {
                this.finish(Some(format!("流式响应读取失败：{error}")));
                Poll::Ready(Some(Err(error)))
            }
            Poll::Ready(None) => {
                this.finish(None);
                Poll::Ready(None)
            }
            Poll::Pending => Poll::Pending,
        }
    }
}

impl<E> Drop for LoggingResponseStream<E> {
    fn drop(&mut self) {
        self.finish(Some("流式响应未完整结束".into()));
    }
}

fn protocol_error_body(body: &[u8]) -> Vec<u8> {
    let value = serde_json::from_slice::<Value>(body).ok().or_else(|| {
        String::from_utf8_lossy(body).lines().find_map(|line| {
            let data = line.trim().strip_prefix("data:")?.trim();
            (data != "[DONE]").then(|| serde_json::from_str::<Value>(data).ok())?
        })
    });
    serde_json::to_vec(&chat_protocol::chat_error_to_response(value.as_ref())).unwrap_or_else(|_| {
        br#"{"error":{"message":"Upstream Chat Completions request failed","type":"upstream_error"}}"#
            .to_vec()
    })
}

fn protocol_response_headers(headers: &HeaderMap, streaming: bool) -> HeaderMap {
    let mut output = headers.clone();
    output.remove(header::CONTENT_LENGTH);
    if streaming {
        output.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("text/event-stream"),
        );
    } else {
        output.insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
    }
    output
}

fn convert_chat_stream(
    upstream: impl Stream<Item = Result<Bytes, reqwest::Error>> + Send + 'static,
    context: chat_protocol::ChatProtocolContext,
) -> impl Stream<Item = Result<Bytes, std::io::Error>> + Send {
    let upstream: Pin<Box<dyn Stream<Item = Result<Bytes, reqwest::Error>> + Send>> =
        Box::pin(upstream);
    stream::unfold(
        (
            upstream,
            chat_protocol::ChatSseConverter::new(context),
            VecDeque::<Bytes>::new(),
            false,
        ),
        |(mut upstream, mut converter, mut pending, mut finished)| async move {
            loop {
                if let Some(chunk) = pending.pop_front() {
                    return Some((Ok(chunk), (upstream, converter, pending, finished)));
                }
                if finished {
                    return None;
                }
                match upstream.as_mut().next().await {
                    Some(Ok(chunk)) => {
                        for event in converter.push(&chunk) {
                            pending.push_back(Bytes::from(event));
                        }
                        finished = converter.is_finished();
                    }
                    Some(Err(error)) => {
                        for event in converter.fail(format!("上游流式响应读取失败：{error}"))
                        {
                            pending.push_back(Bytes::from(event));
                        }
                        finished = true;
                    }
                    None => {
                        for event in converter.finish() {
                            pending.push_back(Bytes::from(event));
                        }
                        finished = true;
                    }
                }
            }
        },
    )
}

async fn gateway_proxy_streaming_request(
    state: GatewayServiceState,
    request_id: String,
    uri: axum::http::Uri,
    parts: axum::http::request::Parts,
    body: Body,
    route: GatewayRoute,
) -> Response {
    let request_started_at = Instant::now();
    let Some(used_half_open_probe) = allow_gateway_route(&state, &route) else {
        gateway_log(
            Some(&request_id),
            format_args!(
                "route skipped route={} reason=circuit_open_or_state_unavailable",
                gateway_route_label(&route),
            ),
        );
        log_gateway_request_finished(
            &request_id,
            request_started_at,
            StatusCode::SERVICE_UNAVAILABLE,
            "all_routes_circuit_open",
        );
        return gateway_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "all_routes_circuit_open",
            "所有本地网关路由均处于熔断状态",
        );
    };
    gateway_log(
        Some(&request_id),
        format_args!(
            "route attempt route={} half_open_probe={used_half_open_probe}",
            gateway_route_label(&route),
        ),
    );

    let target = match gateway_upstream_url(&route.upstream_base_url, &uri, None) {
        Ok(target) => target,
        Err(error) => {
            record_gateway_route_result(&state, &route, used_half_open_probe, false);
            gateway_log(
                Some(&request_id),
                format_args!(
                    "route failed route={} stage=build_upstream_url reason={error}",
                    gateway_route_label(&route),
                ),
            );
            log_gateway_request_finished(
                &request_id,
                request_started_at,
                StatusCode::BAD_GATEWAY,
                "invalid_upstream",
            );
            return gateway_error(StatusCode::BAD_GATEWAY, "invalid_upstream", error);
        }
    };

    let app_type = gateway_app_type(&uri, &parts.headers);
    let forwarded_headers = forwarded_request_headers(&parts.headers);
    let mut outbound = state
        .client
        .request(parts.method, target)
        .timeout(GATEWAY_REQUEST_TIMEOUT)
        .bearer_auth(&route.api_key)
        .body(reqwest::Body::wrap_stream(body.into_data_stream()));
    for (name, value) in &forwarded_headers {
        outbound = outbound.header(name.clone(), value.clone());
    }

    let upstream = match outbound.send().await {
        Ok(response) => response,
        Err(error) => {
            record_gateway_route_result(&state, &route, used_half_open_probe, false);
            log_gateway_upstream_error(&request_id, &route, "send", &error);
            log_gateway_request_finished(
                &request_id,
                request_started_at,
                StatusCode::BAD_GATEWAY,
                "upstream_request_failed",
            );
            return gateway_error(
                StatusCode::BAD_GATEWAY,
                "upstream_request_failed",
                format!("上游请求失败：{error}"),
            );
        }
    };

    let status = upstream.status();
    let upstream_headers = upstream.headers().clone();
    let response_latency_ms = elapsed_ms(request_started_at);
    let response_action = if is_retryable_upstream_status(status) {
        "return_retryable_status_no_fallback_streaming"
    } else {
        "return"
    };
    log_gateway_upstream_response(
        &request_id,
        &route,
        status,
        response_latency_ms,
        response_action,
    );
    if is_retryable_upstream_status(status) {
        match upstream.bytes().await {
            Ok(body) => {
                record_gateway_route_response(&state, &route, used_half_open_probe, status);
                record_local_usage(
                    state.local_store.as_ref(),
                    &route,
                    &uri,
                    &app_type,
                    None,
                    &body,
                    status,
                    response_latency_ms,
                    Some(elapsed_ms(request_started_at)),
                    None,
                    false,
                    None,
                );
                log_gateway_request_finished(
                    &request_id,
                    request_started_at,
                    status,
                    "upstream_retryable_response",
                );
                return build_gateway_response(status, &upstream_headers, Body::from(body));
            }
            Err(error) => {
                record_gateway_route_result(&state, &route, used_half_open_probe, false);
                log_gateway_upstream_error(&request_id, &route, "read_retryable_response", &error);
                log_gateway_request_finished(
                    &request_id,
                    request_started_at,
                    StatusCode::BAD_GATEWAY,
                    "upstream_response_read_failed",
                );
                record_local_usage(
                    state.local_store.as_ref(),
                    &route,
                    &uri,
                    &app_type,
                    None,
                    &[],
                    status,
                    response_latency_ms,
                    Some(elapsed_ms(request_started_at)),
                    None,
                    false,
                    Some(format!("上游响应读取失败：{error}")),
                );
                return gateway_error(
                    StatusCode::BAD_GATEWAY,
                    "upstream_response_read_failed",
                    "上游响应读取失败",
                );
            }
        }
    }

    record_gateway_route_result(&state, &route, used_half_open_probe, true);
    gateway_log(
        Some(&request_id),
        format_args!(
            "route succeeded route={} status={} latency_ms={response_latency_ms}",
            gateway_route_label(&route),
            status.as_u16(),
        ),
    );
    state.runtime.write().await.route = Some(route.clone());
    let is_streaming = upstream_headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.to_ascii_lowercase().contains("text/event-stream"));
    if is_streaming {
        let response_body = Body::from_stream(LoggingResponseStream::new(
            upstream.bytes_stream(),
            LoggingResponseMeta {
                request_id: request_id.clone(),
                local_store: state.local_store.clone(),
                route,
                uri,
                app_type,
                request_model: None,
                status,
                latency_ms: response_latency_ms,
                started_at: request_started_at,
            },
        ));
        log_gateway_request_finished(
            &request_id,
            request_started_at,
            status,
            "stream_headers_sent",
        );
        return build_gateway_response(status, &upstream_headers, response_body);
    }

    match upstream.bytes().await {
        Ok(body) => {
            record_local_usage(
                state.local_store.as_ref(),
                &route,
                &uri,
                &app_type,
                None,
                &body,
                status,
                response_latency_ms,
                Some(elapsed_ms(request_started_at)),
                None,
                false,
                None,
            );
            log_gateway_request_finished(&request_id, request_started_at, status, "response_sent");
            build_gateway_response(status, &upstream_headers, Body::from(body))
        }
        Err(error) => {
            log_gateway_upstream_error(&request_id, &route, "read_response", &error);
            log_gateway_request_finished(
                &request_id,
                request_started_at,
                StatusCode::BAD_GATEWAY,
                "upstream_response_read_failed",
            );
            record_local_usage(
                state.local_store.as_ref(),
                &route,
                &uri,
                &app_type,
                None,
                &[],
                status,
                response_latency_ms,
                Some(elapsed_ms(request_started_at)),
                None,
                false,
                Some(format!("上游响应读取失败：{error}")),
            );
            gateway_error(
                StatusCode::BAD_GATEWAY,
                "upstream_response_read_failed",
                "上游响应读取失败",
            )
        }
    }
}

async fn gateway_proxy(
    AxumState(state): AxumState<GatewayServiceState>,
    OriginalUri(uri): OriginalUri,
    request: Request<Body>,
) -> Response {
    let (parts, body) = request.into_parts();
    let request_id = Uuid::new_v4().simple().to_string();
    let request_started_at = Instant::now();
    gateway_log(
        Some(&request_id),
        format_args!(
            "request started method={} path={}",
            parts.method,
            uri.path(),
        ),
    );
    let snapshot = state.runtime.read().await.clone();
    if !gateway_request_authorized(&parts.headers, &snapshot.token) {
        gateway_log(Some(&request_id), "request rejected reason=invalid_api_key");
        log_gateway_request_finished(
            &request_id,
            request_started_at,
            StatusCode::UNAUTHORIZED,
            "invalid_api_key",
        );
        return gateway_error(
            StatusCode::UNAUTHORIZED,
            "invalid_api_key",
            "本地网关令牌无效或缺失",
        );
    }

    let routes = if snapshot.routes.is_empty() {
        snapshot.route.into_iter().collect()
    } else {
        snapshot.routes
    };
    if routes.is_empty() {
        gateway_log(Some(&request_id), "request rejected reason=no_active_route");
        log_gateway_request_finished(
            &request_id,
            request_started_at,
            StatusCode::SERVICE_UNAVAILABLE,
            "no_active_route",
        );
        return gateway_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "no_active_route",
            "尚未为本地网关选择活动路由",
        );
    }

    let is_responses_request = chat_protocol::is_responses_path(uri.path());
    if can_stream_request(&parts.headers, routes.len(), is_responses_request) {
        let Some(route) = routes.first().cloned() else {
            gateway_log(Some(&request_id), "request rejected reason=no_active_route");
            log_gateway_request_finished(
                &request_id,
                request_started_at,
                StatusCode::SERVICE_UNAVAILABLE,
                "no_active_route",
            );
            return gateway_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "no_active_route",
                "没有可用的本地网关路由",
            );
        };
        return gateway_proxy_streaming_request(state, request_id, uri, parts, body, route).await;
    }

    let payload = match to_bytes(body, MAX_GATEWAY_REQUEST_BYTES).await {
        Ok(payload) => payload,
        Err(_) => {
            gateway_log(
                Some(&request_id),
                "request rejected reason=request_too_large",
            );
            log_gateway_request_finished(
                &request_id,
                request_started_at,
                StatusCode::PAYLOAD_TOO_LARGE,
                "request_too_large",
            );
            return gateway_error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "request_too_large",
                "请求体超过本地网关 64 MB 限制",
            );
        }
    };

    let (outbound_payload, protocol_context, replacement_path, request_model) =
        if chat_protocol::is_responses_path(uri.path())
            && !chat_protocol::is_responses_compact_path(uri.path())
        {
            let body = match serde_json::from_slice::<Value>(&payload) {
                Ok(body) => body,
                Err(error) => {
                    gateway_log(
                        Some(&request_id),
                        format_args!("request rejected reason=invalid_json detail={error}"),
                    );
                    log_gateway_request_finished(
                        &request_id,
                        request_started_at,
                        StatusCode::BAD_REQUEST,
                        "invalid_json",
                    );
                    return gateway_error(
                        StatusCode::BAD_REQUEST,
                        "invalid_json",
                        format!("Responses 请求体不是有效 JSON：{error}"),
                    );
                }
            };
            let request_model = request_model_from_value(&body);
            let (chat_body, context) = match chat_protocol::responses_request_to_chat(body) {
                Ok(result) => result,
                Err(error) => {
                    gateway_log(
                        Some(&request_id),
                        format_args!(
                            "request rejected reason=responses_transform_failed detail={error}"
                        ),
                    );
                    log_gateway_request_finished(
                        &request_id,
                        request_started_at,
                        StatusCode::BAD_REQUEST,
                        "responses_transform_failed",
                    );
                    return gateway_error(
                        StatusCode::BAD_REQUEST,
                        "responses_transform_failed",
                        error,
                    );
                }
            };
            let payload = match serde_json::to_vec(&chat_body) {
                Ok(payload) => Bytes::from(payload),
                Err(error) => {
                    gateway_log(
                        Some(&request_id),
                        format_args!(
                            "request rejected reason=responses_transform_failed detail={error}"
                        ),
                    );
                    log_gateway_request_finished(
                        &request_id,
                        request_started_at,
                        StatusCode::BAD_REQUEST,
                        "responses_transform_failed",
                    );
                    return gateway_error(
                        StatusCode::BAD_REQUEST,
                        "responses_transform_failed",
                        format!("无法创建 Chat Completions 请求：{error}"),
                    );
                }
            };
            (
                payload,
                Some(context),
                Some(chat_protocol::chat_completions_path(uri.path())),
                request_model,
            )
        } else {
            let request_model = request_model(&payload);
            (payload, None, None, request_model)
        };
    let app_type = gateway_app_type(&uri, &parts.headers);
    let forwarded_headers = forwarded_request_headers(&parts.headers);

    let mut attempted = false;
    let mut last_error = None;
    let mut last_response = None;
    let mut last_route = None;

    for route in routes {
        let Some(used_half_open_probe) = allow_gateway_route(&state, &route) else {
            gateway_log(
                Some(&request_id),
                format_args!(
                    "route skipped route={} reason=circuit_open_or_state_unavailable",
                    gateway_route_label(&route),
                ),
            );
            continue;
        };
        attempted = true;
        last_route = Some(route.clone());
        gateway_log(
            Some(&request_id),
            format_args!(
                "route attempt route={} half_open_probe={used_half_open_probe}",
                gateway_route_label(&route),
            ),
        );

        let target = match gateway_upstream_url(&route.upstream_base_url, &uri, replacement_path) {
            Ok(target) => target,
            Err(error) => {
                record_gateway_route_result(&state, &route, used_half_open_probe, false);
                gateway_log(
                    Some(&request_id),
                    format_args!(
                        "route failed route={} stage=build_upstream_url reason={error}",
                        gateway_route_label(&route),
                    ),
                );
                last_error = Some(error);
                continue;
            }
        };

        let mut outbound = state
            .client
            .request(parts.method.clone(), target)
            .timeout(GATEWAY_REQUEST_TIMEOUT)
            .bearer_auth(&route.api_key)
            .body(outbound_payload.clone());
        for (name, value) in &forwarded_headers {
            outbound = outbound.header(name.clone(), value.clone());
        }

        let upstream = match outbound.send().await {
            Ok(response) => response,
            Err(error) => {
                record_gateway_route_result(&state, &route, used_half_open_probe, false);
                log_gateway_upstream_error(&request_id, &route, "send", &error);
                last_error = Some(format!("上游请求失败：{error}"));
                continue;
            }
        };

        let status = upstream.status();
        let response_latency_ms = elapsed_ms(request_started_at);
        let response_action = if is_retryable_upstream_status(status) {
            "try_next_route"
        } else {
            "return"
        };
        log_gateway_upstream_response(
            &request_id,
            &route,
            status,
            response_latency_ms,
            response_action,
        );
        if is_retryable_upstream_status(status) {
            let mut headers = upstream.headers().clone();
            let mut response_read = false;
            match upstream.bytes().await {
                Ok(mut body) => {
                    if protocol_context.is_some() {
                        body = Bytes::from(protocol_error_body(&body));
                        headers = protocol_response_headers(&headers, false);
                    }
                    last_response = Some(BufferedGatewayResponse {
                        status,
                        headers,
                        body,
                        route: route.clone(),
                    });
                    response_read = true;
                }
                Err(error) => {
                    log_gateway_upstream_error(
                        &request_id,
                        &route,
                        "read_retryable_response",
                        &error,
                    );
                    last_error = Some(format!("上游错误响应读取失败：{error}"));
                }
            }
            if response_read {
                record_gateway_route_response(&state, &route, used_half_open_probe, status);
                gateway_log(
                    Some(&request_id),
                    format_args!(
                        "route fallback route={} status={} reason=retryable_upstream_response",
                        gateway_route_label(&route),
                        status.as_u16(),
                    ),
                );
            } else {
                record_gateway_route_result(&state, &route, used_half_open_probe, false);
                gateway_log(
                    Some(&request_id),
                    format_args!(
                        "route failed route={} status={} reason=retryable_response_read_failed",
                        gateway_route_label(&route),
                        status.as_u16(),
                    ),
                );
            }
            continue;
        }

        record_gateway_route_result(&state, &route, used_half_open_probe, true);
        gateway_log(
            Some(&request_id),
            format_args!(
                "route succeeded route={} status={} latency_ms={response_latency_ms}",
                gateway_route_label(&route),
                status.as_u16(),
            ),
        );
        state.runtime.write().await.route = Some(route.clone());
        let upstream_headers = upstream.headers().clone();
        let upstream_is_streaming = upstream_headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.to_ascii_lowercase().contains("text/event-stream"));
        let is_streaming = upstream_is_streaming;
        if is_streaming {
            let response_headers = if protocol_context.is_some() {
                protocol_response_headers(&upstream_headers, true)
            } else {
                upstream_headers.clone()
            };
            let response_body = if let Some(context) = protocol_context.clone() {
                Body::from_stream(LoggingResponseStream::new(
                    convert_chat_stream(upstream.bytes_stream(), context),
                    LoggingResponseMeta {
                        request_id: request_id.clone(),
                        local_store: state.local_store.clone(),
                        route,
                        uri: uri.clone(),
                        app_type: app_type.clone(),
                        request_model: request_model.clone(),
                        status,
                        latency_ms: response_latency_ms,
                        started_at: request_started_at,
                    },
                ))
            } else {
                Body::from_stream(LoggingResponseStream::new(
                    upstream.bytes_stream(),
                    LoggingResponseMeta {
                        request_id: request_id.clone(),
                        local_store: state.local_store.clone(),
                        route,
                        uri: uri.clone(),
                        app_type: app_type.clone(),
                        request_model: request_model.clone(),
                        status,
                        latency_ms: response_latency_ms,
                        started_at: request_started_at,
                    },
                ))
            };
            log_gateway_request_finished(
                &request_id,
                request_started_at,
                status,
                "stream_headers_sent",
            );
            return build_gateway_response(status, &response_headers, response_body);
        }
        match upstream.bytes().await {
            Ok(body) => {
                let (body, response_headers) = if let Some(context) = protocol_context.as_ref() {
                    if status.is_client_error() || status.is_server_error() {
                        (
                            Bytes::from(protocol_error_body(&body)),
                            protocol_response_headers(&upstream_headers, false),
                        )
                    } else {
                        let value = match serde_json::from_slice::<Value>(&body) {
                            Ok(value) => value,
                            Err(error) => {
                                record_local_usage(
                                    state.local_store.as_ref(),
                                    &route,
                                    &uri,
                                    &app_type,
                                    request_model.as_deref(),
                                    &body,
                                    StatusCode::BAD_GATEWAY,
                                    response_latency_ms,
                                    Some(elapsed_ms(request_started_at)),
                                    None,
                                    false,
                                    Some(format!("Chat Completions 响应不是有效 JSON：{error}")),
                                );
                                return gateway_error(
                                    StatusCode::BAD_GATEWAY,
                                    "response_transform_failed",
                                    "上游 Chat Completions 响应无法转换",
                                );
                            }
                        };
                        let response =
                            match chat_protocol::chat_response_to_responses(value, context) {
                                Ok(response) => response,
                                Err(error) => {
                                    return gateway_error(
                                        StatusCode::BAD_GATEWAY,
                                        "response_transform_failed",
                                        error,
                                    )
                                }
                            };
                        (
                            Bytes::from(serde_json::to_vec(&response).unwrap_or_default()),
                            protocol_response_headers(&upstream_headers, false),
                        )
                    }
                } else {
                    (body, upstream_headers.clone())
                };
                record_local_usage(
                    state.local_store.as_ref(),
                    &route,
                    &uri,
                    &app_type,
                    request_model.as_deref(),
                    &body,
                    status,
                    response_latency_ms,
                    Some(elapsed_ms(request_started_at)),
                    None,
                    false,
                    None,
                );
                log_gateway_request_finished(
                    &request_id,
                    request_started_at,
                    status,
                    "response_sent",
                );
                return build_gateway_response(status, &response_headers, Body::from(body));
            }
            Err(error) => {
                log_gateway_upstream_error(&request_id, &route, "read_response", &error);
                log_gateway_request_finished(
                    &request_id,
                    request_started_at,
                    StatusCode::BAD_GATEWAY,
                    "upstream_response_read_failed",
                );
                record_local_usage(
                    state.local_store.as_ref(),
                    &route,
                    &uri,
                    &app_type,
                    request_model.as_deref(),
                    &[],
                    status,
                    response_latency_ms,
                    Some(elapsed_ms(request_started_at)),
                    None,
                    false,
                    Some(format!("上游响应读取失败：{error}")),
                );
                return gateway_error(
                    StatusCode::BAD_GATEWAY,
                    "upstream_response_read_failed",
                    "上游响应读取失败",
                );
            }
        }
    }

    if let Some(response) = last_response {
        gateway_log(
            Some(&request_id),
            format_args!(
                "returning buffered retryable response route={} status={} reason=no_later_route_succeeded",
                gateway_route_label(&response.route),
                response.status.as_u16(),
            ),
        );
        log_gateway_request_finished(
            &request_id,
            request_started_at,
            response.status,
            "last_retryable_response",
        );
        record_local_usage(
            state.local_store.as_ref(),
            &response.route,
            &uri,
            &app_type,
            request_model.as_deref(),
            &response.body,
            response.status,
            elapsed_ms(request_started_at),
            Some(elapsed_ms(request_started_at)),
            None,
            false,
            last_error.clone(),
        );
        return build_gateway_response(
            response.status,
            &response.headers,
            Body::from(response.body),
        );
    }
    if !attempted {
        log_gateway_request_finished(
            &request_id,
            request_started_at,
            StatusCode::SERVICE_UNAVAILABLE,
            "all_routes_circuit_open",
        );
        return gateway_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "all_routes_circuit_open",
            "所有本地网关路由均处于熔断状态",
        );
    }
    if let Some(route) = last_route {
        gateway_log(
            Some(&request_id),
            format_args!(
                "all upstream attempts failed last_route={}",
                gateway_route_label(&route),
            ),
        );
        record_local_usage(
            state.local_store.as_ref(),
            &route,
            &uri,
            &app_type,
            request_model.as_deref(),
            &[],
            StatusCode::BAD_GATEWAY,
            elapsed_ms(request_started_at),
            Some(elapsed_ms(request_started_at)),
            None,
            false,
            last_error.clone(),
        );
    }
    log_gateway_request_finished(
        &request_id,
        request_started_at,
        StatusCode::BAD_GATEWAY,
        "all_upstreams_failed",
    );
    gateway_error(
        StatusCode::BAD_GATEWAY,
        "all_upstreams_failed",
        last_error.unwrap_or_else(|| "所有上游路由均请求失败".into()),
    )
}

pub(crate) async fn restore_persisted_gateway_route(state: &AppState) -> Result<(), String> {
    restore_persisted_gateway_routes(state).await
}

async fn restore_persisted_gateway_routes(state: &AppState) -> Result<(), String> {
    let selections = {
        let store = state
            .store
            .lock()
            .map_err(|_| "本地数据库不可用".to_string())?;
        let routes = load_persisted_route_selections(&store)?;
        if routes.is_empty() {
            load_direct_route(&store)?.into_iter().collect()
        } else {
            routes
        }
    };
    if selections.is_empty() {
        return Ok(());
    }

    let mut routes = Vec::with_capacity(selections.len());
    for selection in &selections {
        let Ok((station, api_key)) =
            read_api_key(state, &selection.station_id, &selection.key_id).await
        else {
            continue;
        };
        if api_key.trim().is_empty() {
            continue;
        }
        routes.push(GatewayRoute {
            station_id: selection.station_id.clone(),
            key_id: selection.key_id.clone(),
            provider_name: station.name.clone(),
            upstream_base_url: api_base_url(&station.base_url),
            api_key,
        });
    }
    if routes.is_empty() {
        return Err("已保存的本地网关 API 密钥均无法恢复".into());
    }
    state.gateway.set_routes(routes).await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Clone)]
    struct TestUpstreamState {
        count: Arc<AtomicUsize>,
        status: StatusCode,
    }

    async fn test_upstream_handler(
        AxumState(state): AxumState<TestUpstreamState>,
    ) -> (StatusCode, &'static str) {
        state.count.fetch_add(1, Ordering::SeqCst);
        (state.status, "upstream")
    }

    async fn spawn_test_upstream(
        status: StatusCode,
    ) -> (String, Arc<AtomicUsize>, oneshot::Sender<()>) {
        let count = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/v1/{*path}", any(test_upstream_handler))
            .with_state(TestUpstreamState {
                count: count.clone(),
                status,
            });
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind test upstream");
        let address = listener.local_addr().expect("get test upstream address");
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await;
        });
        (format!("http://{address}/v1"), count, shutdown_tx)
    }

    #[derive(Clone)]
    struct ProtocolUpstreamResponse {
        status: StatusCode,
        content_type: &'static str,
        chunks: Vec<Vec<u8>>,
    }

    #[derive(Clone)]
    struct ProtocolUpstreamState {
        capture: Arc<Mutex<Option<(String, String, Vec<u8>)>>>,
        response: ProtocolUpstreamResponse,
    }

    async fn protocol_upstream_handler(
        AxumState(state): AxumState<ProtocolUpstreamState>,
        request: Request<Body>,
    ) -> Response {
        let path = request.uri().path().to_string();
        let authorization = request
            .headers()
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string();
        let body = to_bytes(request.into_body(), 64 * 1024 * 1024)
            .await
            .expect("read protocol test request");
        *state.capture.lock().expect("capture protocol request") =
            Some((path, authorization, body.to_vec()));

        let response = state.response;
        let builder = Response::builder()
            .status(response.status)
            .header(header::CONTENT_TYPE, response.content_type);
        if response.content_type == "text/event-stream" {
            let chunks = response
                .chunks
                .into_iter()
                .map(|chunk| Ok::<Bytes, std::convert::Infallible>(Bytes::from(chunk)));
            builder
                .body(Body::from_stream(stream::iter(chunks)))
                .expect("build protocol SSE response")
        } else {
            let body = response.chunks.into_iter().flatten().collect::<Vec<_>>();
            builder
                .body(Body::from(body))
                .expect("build protocol response")
        }
    }

    async fn spawn_protocol_upstream(
        response: ProtocolUpstreamResponse,
    ) -> (String, ProtocolUpstreamState, oneshot::Sender<()>) {
        let state = ProtocolUpstreamState {
            capture: Arc::new(Mutex::new(None)),
            response,
        };
        let app = Router::new()
            .route("/v1/{*path}", any(protocol_upstream_handler))
            .with_state(state.clone());
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind protocol test upstream");
        let address = listener
            .local_addr()
            .expect("get protocol test upstream address");
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await;
        });
        (format!("http://{address}/v1"), state, shutdown_tx)
    }

    async fn spawn_test_gateway(state: GatewayServiceState) -> (String, oneshot::Sender<()>) {
        let app = Router::new()
            .route("/v1", any(gateway_proxy))
            .route("/v1/{*path}", any(gateway_proxy))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind test gateway");
        let address = listener.local_addr().expect("get test gateway address");
        let (shutdown_tx, shutdown_rx) = oneshot::channel();
        tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await;
        });
        (format!("http://{address}"), shutdown_tx)
    }

    fn test_route(station_id: &str, key_id: &str, upstream_base_url: String) -> GatewayRoute {
        GatewayRoute {
            station_id: station_id.into(),
            key_id: key_id.into(),
            provider_name: station_id.into(),
            upstream_base_url,
            api_key: format!("key-{key_id}"),
        }
    }

    #[test]
    fn direct_config_fingerprint_normalizes_url_without_storing_the_key() {
        let first =
            direct_config_fingerprint(Some(("https://relay.example/v1", Some("sk-secret"))));
        let same_route =
            direct_config_fingerprint(Some(("https://relay.example", Some("sk-secret"))));
        let changed_key =
            direct_config_fingerprint(Some(("https://relay.example/v1", Some("sk-new"))));

        assert_eq!(first, same_route);
        assert_ne!(first, changed_key);
        assert!(!first.contains("sk-secret"));
    }

    #[test]
    fn rate_limit_releases_a_half_open_probe() {
        let mut breaker = GatewayCircuitBreaker::new();
        breaker.open();
        breaker.opened_at = Some(Instant::now() - GatewayCircuitConfig::default().recovery_after);

        assert_eq!(
            breaker.allow_request(GatewayCircuitConfig::default()),
            Some(true)
        );
        breaker.record_rate_limited(true);
        assert_eq!(breaker.state, GatewayCircuitState::Closed);
        assert_eq!(
            breaker.allow_request(GatewayCircuitConfig::default()),
            Some(false)
        );
    }

    fn test_gateway_state(
        routes: Vec<GatewayRoute>,
        circuit_config: GatewayCircuitConfig,
    ) -> GatewayServiceState {
        GatewayServiceState {
            runtime: Arc::new(RwLock::new(GatewayRuntime {
                token: "gateway-token".into(),
                port: 0,
                route: routes.first().cloned(),
                routes,
            })),
            client: Client::new(),
            local_store: None,
            circuit_breakers: Arc::new(Mutex::new(HashMap::new())),
            circuit_config,
        }
    }

    async fn send_test_request(client: &Client, gateway_url: &str) -> StatusCode {
        client
            .post(format!("{gateway_url}/v1/chat/completions"))
            .bearer_auth("gateway-token")
            .body("{}")
            .send()
            .await
            .expect("send gateway request")
            .status()
    }

    #[tokio::test]
    async fn gateway_uses_first_route_when_it_succeeds() {
        let (a_url, a_count, a_shutdown) = spawn_test_upstream(StatusCode::OK).await;
        let (b_url, b_count, b_shutdown) = spawn_test_upstream(StatusCode::OK).await;
        let (c_url, c_count, c_shutdown) = spawn_test_upstream(StatusCode::OK).await;
        let state = test_gateway_state(
            vec![
                test_route("station-a", "key-a", a_url),
                test_route("station-b", "key-b", b_url),
                test_route("station-c", "key-c", c_url),
            ],
            GatewayCircuitConfig::default(),
        );
        let (gateway_url, gateway_shutdown) = spawn_test_gateway(state).await;

        assert_eq!(
            send_test_request(&Client::new(), &gateway_url).await,
            StatusCode::OK
        );
        assert_eq!(a_count.load(Ordering::SeqCst), 1);
        assert_eq!(b_count.load(Ordering::SeqCst), 0);
        assert_eq!(c_count.load(Ordering::SeqCst), 0);

        let _ = gateway_shutdown.send(());
        let _ = a_shutdown.send(());
        let _ = b_shutdown.send(());
        let _ = c_shutdown.send(());
    }

    #[tokio::test]
    async fn gateway_fails_over_from_a_to_b() {
        let (a_url, a_count, a_shutdown) =
            spawn_test_upstream(StatusCode::INTERNAL_SERVER_ERROR).await;
        let (b_url, b_count, b_shutdown) = spawn_test_upstream(StatusCode::OK).await;
        let state = test_gateway_state(
            vec![
                test_route("station-a", "key-a", a_url),
                test_route("station-b", "key-b", b_url),
            ],
            GatewayCircuitConfig::default(),
        );
        let (gateway_url, gateway_shutdown) = spawn_test_gateway(state).await;

        assert_eq!(
            send_test_request(&Client::new(), &gateway_url).await,
            StatusCode::OK
        );
        assert_eq!(a_count.load(Ordering::SeqCst), 1);
        assert_eq!(b_count.load(Ordering::SeqCst), 1);

        let _ = gateway_shutdown.send(());
        let _ = a_shutdown.send(());
        let _ = b_shutdown.send(());
    }

    #[tokio::test]
    async fn gateway_fails_over_through_a_b_to_c() {
        let (a_url, a_count, a_shutdown) = spawn_test_upstream(StatusCode::BAD_GATEWAY).await;
        let (b_url, b_count, b_shutdown) =
            spawn_test_upstream(StatusCode::SERVICE_UNAVAILABLE).await;
        let (c_url, c_count, c_shutdown) = spawn_test_upstream(StatusCode::OK).await;
        let state = test_gateway_state(
            vec![
                test_route("station-a", "key-a", a_url),
                test_route("station-b", "key-b", b_url),
                test_route("station-c", "key-c", c_url),
            ],
            GatewayCircuitConfig::default(),
        );
        let (gateway_url, gateway_shutdown) = spawn_test_gateway(state).await;

        assert_eq!(
            send_test_request(&Client::new(), &gateway_url).await,
            StatusCode::OK
        );
        assert_eq!(a_count.load(Ordering::SeqCst), 1);
        assert_eq!(b_count.load(Ordering::SeqCst), 1);
        assert_eq!(c_count.load(Ordering::SeqCst), 1);

        let _ = gateway_shutdown.send(());
        let _ = a_shutdown.send(());
        let _ = b_shutdown.send(());
        let _ = c_shutdown.send(());
    }

    #[tokio::test]
    async fn gateway_does_not_fail_over_for_client_errors() {
        let (a_url, a_count, a_shutdown) = spawn_test_upstream(StatusCode::BAD_REQUEST).await;
        let (b_url, b_count, b_shutdown) = spawn_test_upstream(StatusCode::OK).await;
        let state = test_gateway_state(
            vec![
                test_route("station-a", "key-a", a_url),
                test_route("station-b", "key-b", b_url),
            ],
            GatewayCircuitConfig::default(),
        );
        let (gateway_url, gateway_shutdown) = spawn_test_gateway(state).await;

        assert_eq!(
            send_test_request(&Client::new(), &gateway_url).await,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(a_count.load(Ordering::SeqCst), 1);
        assert_eq!(b_count.load(Ordering::SeqCst), 0);

        let _ = gateway_shutdown.send(());
        let _ = a_shutdown.send(());
        let _ = b_shutdown.send(());
    }

    #[tokio::test]
    async fn gateway_does_not_open_route_for_rate_limits() {
        let (upstream_url, upstream_count, upstream_shutdown) =
            spawn_test_upstream(StatusCode::TOO_MANY_REQUESTS).await;
        let state = test_gateway_state(
            vec![test_route("station-a", "key-a", upstream_url)],
            GatewayCircuitConfig {
                failure_threshold: 1,
                ..GatewayCircuitConfig::default()
            },
        );
        let (gateway_url, gateway_shutdown) = spawn_test_gateway(state).await;
        let client = Client::new();

        assert_eq!(
            send_test_request(&client, &gateway_url).await,
            StatusCode::TOO_MANY_REQUESTS
        );
        assert_eq!(
            send_test_request(&client, &gateway_url).await,
            StatusCode::TOO_MANY_REQUESTS
        );
        assert_eq!(upstream_count.load(Ordering::SeqCst), 2);

        let _ = gateway_shutdown.send(());
        let _ = upstream_shutdown.send(());
    }

    #[tokio::test]
    async fn gateway_skips_a_after_its_circuit_opens() {
        let (a_url, a_count, a_shutdown) =
            spawn_test_upstream(StatusCode::INTERNAL_SERVER_ERROR).await;
        let (b_url, b_count, b_shutdown) = spawn_test_upstream(StatusCode::OK).await;
        let state = test_gateway_state(
            vec![
                test_route("station-a", "key-a", a_url),
                test_route("station-b", "key-b", b_url),
            ],
            GatewayCircuitConfig {
                failure_threshold: 1,
                ..GatewayCircuitConfig::default()
            },
        );
        let (gateway_url, gateway_shutdown) = spawn_test_gateway(state).await;
        let client = Client::new();

        assert_eq!(
            send_test_request(&client, &gateway_url).await,
            StatusCode::OK
        );
        assert_eq!(
            send_test_request(&client, &gateway_url).await,
            StatusCode::OK
        );
        assert_eq!(a_count.load(Ordering::SeqCst), 1);
        assert_eq!(b_count.load(Ordering::SeqCst), 2);

        let _ = gateway_shutdown.send(());
        let _ = a_shutdown.send(());
        let _ = b_shutdown.send(());
    }

    #[tokio::test]
    async fn gateway_route_health_reports_open_state_and_can_be_reset() {
        let controller = GatewayController::new_with_circuit_config(
            Client::new(),
            "gateway-token".into(),
            0,
            GatewayCircuitConfig {
                failure_threshold: 1,
                ..GatewayCircuitConfig::default()
            },
            None,
        );
        let route = test_route("station-a", "key-a", "http://127.0.0.1:1/v1".into());
        controller.set_routes(vec![route.clone()]).await;
        let state = GatewayServiceState {
            runtime: controller.runtime.clone(),
            client: controller.client.clone(),
            local_store: None,
            circuit_breakers: controller.circuit_breakers.clone(),
            circuit_config: controller.circuit_config,
        };

        record_gateway_route_result(&state, &route, false, false);
        let health = controller.route_health().await;
        assert_eq!(health[0].state, "open");
        assert_eq!(health[0].failed_requests, 1);
        assert!(health[0].cooldown_remaining_ms > 0);
        assert!(health[0].last_failure_at.is_some());

        controller
            .reset_route_health("station-a", "key-a")
            .await
            .expect("reset route health");
        let reset_health = controller.route_health().await;
        assert_eq!(reset_health[0].state, "closed");
        assert_eq!(reset_health[0].failed_requests, 0);
        assert_eq!(reset_health[0].cooldown_remaining_ms, 0);
    }

    #[tokio::test]
    async fn gateway_converts_responses_request_and_response_over_http() {
        let upstream_body = serde_json::to_vec(&json!({
            "id": "chatcmpl_123",
            "object": "chat.completion",
            "created": 123,
            "model": "gpt-5-codex",
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": "Hello from upstream"},
                "finish_reason": "stop"
            }],
            "usage": {"prompt_tokens": 4, "completion_tokens": 3, "total_tokens": 7}
        }))
        .expect("serialize protocol test response");
        let (upstream_url, upstream_state, upstream_shutdown) =
            spawn_protocol_upstream(ProtocolUpstreamResponse {
                status: StatusCode::OK,
                content_type: "application/json",
                chunks: vec![upstream_body],
            })
            .await;
        let state = test_gateway_state(
            vec![test_route("station-a", "key-a", upstream_url)],
            GatewayCircuitConfig::default(),
        );
        let (gateway_url, gateway_shutdown) = spawn_test_gateway(state).await;

        let response = Client::new()
            .post(format!("{gateway_url}/v1/responses"))
            .bearer_auth("gateway-token")
            .json(&json!({
                "model": "gpt-5-codex",
                "instructions": "Be concise.",
                "input": [{
                    "type": "message",
                    "role": "user",
                    "content": [{"type": "input_text", "text": "Hello"}]
                }]
            }))
            .send()
            .await
            .expect("send Responses request");
        assert_eq!(response.status(), StatusCode::OK);
        let response_body = response
            .json::<Value>()
            .await
            .expect("read Responses response");
        assert_eq!(response_body["object"], "response");
        assert_eq!(
            response_body["output"][0]["content"][0]["text"],
            "Hello from upstream"
        );
        assert_eq!(response_body["usage"]["total_tokens"], 7);

        let (path, authorization, request_body) = upstream_state
            .capture
            .lock()
            .expect("read captured protocol request")
            .clone()
            .expect("protocol request was captured");
        let request_body =
            serde_json::from_slice::<Value>(&request_body).expect("parse Chat request");
        assert_eq!(path, "/v1/chat/completions");
        assert_eq!(authorization, "Bearer key-key-a");
        assert_eq!(request_body["messages"][0]["role"], "system");
        assert_eq!(request_body["messages"][1]["content"][0]["text"], "Hello");

        let _ = gateway_shutdown.send(());
        let _ = upstream_shutdown.send(());
    }

    #[tokio::test]
    async fn gateway_forwards_responses_compact_without_protocol_conversion() {
        let upstream_body = serde_json::to_vec(&json!({
            "id": "resp_compact_123",
            "object": "response",
            "status": "completed",
            "output": []
        }))
        .expect("serialize compact response");
        let (upstream_url, upstream_state, upstream_shutdown) =
            spawn_protocol_upstream(ProtocolUpstreamResponse {
                status: StatusCode::OK,
                content_type: "application/json",
                chunks: vec![upstream_body.clone()],
            })
            .await;
        let state = test_gateway_state(
            vec![test_route("station-a", "key-a", upstream_url)],
            GatewayCircuitConfig::default(),
        );
        let (gateway_url, gateway_shutdown) = spawn_test_gateway(state).await;
        let request_body = json!({
            "model": "gpt-5.5",
            "input": "compact this conversation"
        });

        let response = Client::new()
            .post(format!("{gateway_url}/v1/responses/compact"))
            .bearer_auth("gateway-token")
            .json(&request_body)
            .send()
            .await
            .expect("send compact request");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.json::<Value>().await.unwrap()["object"],
            "response"
        );

        let (path, authorization, body) = upstream_state
            .capture
            .lock()
            .expect("read captured compact request")
            .clone()
            .expect("compact request was captured");
        assert_eq!(path, "/v1/responses/compact");
        assert_eq!(authorization, "Bearer key-key-a");
        assert_eq!(
            serde_json::from_slice::<Value>(&body).unwrap(),
            request_body
        );

        let _ = gateway_shutdown.send(());
        let _ = upstream_shutdown.send(());
    }

    #[tokio::test]
    async fn gateway_converts_responses_error_body_without_changing_status() {
        let upstream_body = serde_json::to_vec(&json!({
            "error": {"message": "invalid request", "type": "invalid_request_error", "code": "bad_input"}
        }))
        .expect("serialize protocol test error");
        let (upstream_url, _upstream_state, upstream_shutdown) =
            spawn_protocol_upstream(ProtocolUpstreamResponse {
                status: StatusCode::BAD_REQUEST,
                content_type: "application/json",
                chunks: vec![upstream_body],
            })
            .await;
        let state = test_gateway_state(
            vec![test_route("station-a", "key-a", upstream_url)],
            GatewayCircuitConfig::default(),
        );
        let (gateway_url, gateway_shutdown) = spawn_test_gateway(state).await;

        let response = Client::new()
            .post(format!("{gateway_url}/v1/responses"))
            .bearer_auth("gateway-token")
            .json(&json!({"model": "gpt-5-codex", "input": "Hello"}))
            .send()
            .await
            .expect("send Responses error request");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response_body = response
            .json::<Value>()
            .await
            .expect("read Responses error");
        assert_eq!(response_body["error"]["message"], "invalid request");
        assert_eq!(response_body["error"]["type"], "invalid_request_error");
        assert_eq!(response_body["error"]["code"], "bad_input");

        let _ = gateway_shutdown.send(());
        let _ = upstream_shutdown.send(());
    }

    #[tokio::test]
    async fn gateway_converts_responses_sse_stream() {
        let first_chunk = br#"data: {"id":"chatcmpl_stream","model":"gpt-5-codex","created":1,"choices":[{"delta":{"role":"assistant","content":"he"},"finish_reason":null}]}

"#;
        let second_chunk =
            br#"data: {"choices":[{"delta":{"content":"llo"},"finish_reason":"stop"}]}

data: [DONE]

"#;
        let (upstream_url, upstream_state, upstream_shutdown) =
            spawn_protocol_upstream(ProtocolUpstreamResponse {
                status: StatusCode::OK,
                content_type: "text/event-stream",
                chunks: vec![first_chunk.to_vec(), second_chunk.to_vec()],
            })
            .await;
        let state = test_gateway_state(
            vec![test_route("station-a", "key-a", upstream_url)],
            GatewayCircuitConfig::default(),
        );
        let (gateway_url, gateway_shutdown) = spawn_test_gateway(state).await;

        let response = Client::new()
            .post(format!("{gateway_url}/v1/responses"))
            .bearer_auth("gateway-token")
            .header(header::ACCEPT, "text/event-stream")
            .json(&json!({
                "model": "gpt-5-codex",
                "input": "Hello",
                "stream": true
            }))
            .send()
            .await
            .expect("send streaming Responses request");
        assert_eq!(response.status(), StatusCode::OK);
        assert!(response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("text/event-stream")));
        let response_body = response
            .text()
            .await
            .expect("read converted Responses stream");
        assert!(response_body.contains("response.output_text.delta"));
        assert!(response_body.contains("\"delta\":\"he\""));
        assert!(response_body.contains("\"delta\":\"llo\""));
        assert!(response_body.contains("response.completed"));

        let capture = upstream_state
            .capture
            .lock()
            .expect("read captured streaming request")
            .clone()
            .expect("streaming request was captured");
        assert_eq!(capture.0, "/v1/chat/completions");

        let _ = gateway_shutdown.send(());
        let _ = upstream_shutdown.send(());
    }

    #[test]
    fn local_usage_accumulator_handles_split_sse_events() {
        let mut accumulator = LocalUsageAccumulator::default();
        accumulator.push(
            br#"data: {"model":"gpt-5-codex","usage":{"prompt_tokens":4,"completion_tokens":3"#,
        );
        accumulator.push(
            br#"}}

data: [DONE]
"#,
        );

        let usage = accumulator.finish();
        assert_eq!(usage.model.as_deref(), Some("gpt-5-codex"));
        assert_eq!(usage.input_tokens, 4);
        assert_eq!(usage.output_tokens, 3);
    }
}
