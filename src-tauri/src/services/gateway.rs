use std::{
    collections::{HashMap, HashSet},
    net::SocketAddr,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    body::{to_bytes, Body},
    extract::{OriginalUri, State as AxumState},
    http::{header, HeaderMap, HeaderName, Request, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
    Router,
};
use chrono::Utc;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;
use tokio::sync::{oneshot, RwLock};
use url::Url;
use uuid::Uuid;

use crate::{
    keyring_store::credential_entry, services::api_keys::read_api_key,
    settings_store::SettingsStore, store::Store, support::api_base_url, AppState,
};

pub(crate) const DEFAULT_GATEWAY_PORT: u16 = 18765;
pub(crate) const GATEWAY_TOKEN_ID: &str = "local-gateway-token";
const ACTIVE_GATEWAY_ROUTES_SETTING: &str = "activeGatewayRoutes";
const DEFAULT_CIRCUIT_FAILURE_THRESHOLD: u32 = 4;
const DEFAULT_CIRCUIT_SUCCESS_THRESHOLD: u32 = 2;
const DEFAULT_CIRCUIT_RECOVERY: Duration = Duration::from_secs(60);
const DEFAULT_CIRCUIT_ERROR_RATE_THRESHOLD: f64 = 0.6;
const DEFAULT_CIRCUIT_MIN_REQUESTS: u32 = 10;
const GATEWAY_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

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
    circuit_breakers: Arc<Mutex<HashMap<String, GatewayCircuitBreaker>>>,
    circuit_config: GatewayCircuitConfig,
}

pub(crate) struct GatewayController {
    runtime: Arc<RwLock<GatewayRuntime>>,
    client: Client,
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
            upstream_base_url: api_base_url(&station.base_url),
            api_key,
        });
    }
    Ok(routes)
}

pub(crate) async fn set_tray_routing_mode(app: AppHandle, mode: RoutingMode) -> Result<(), String> {
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
    let result = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_setting("routingMode", routing_mode_setting(&mode));
    result
}

pub(crate) async fn set_gateway_route(
    state: &AppState,
    station_id: String,
    key_id: String,
) -> Result<(), String> {
    set_gateway_routes(state, vec![GatewayRouteSelection { station_id, key_id }]).await
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
    }
    state.gateway.start().await
}

pub(crate) async fn get_status(state: &AppState) -> Result<GatewayStatus, String> {
    let mode = current_routing_mode(state)?;
    let runtime = state.gateway.runtime_snapshot().await;
    let route_queue = if runtime.routes.is_empty() {
        let store = state
            .store
            .lock()
            .map_err(|_| "本地数据库不可用".to_string())?;
        load_persisted_route_selections(&store)?
    } else {
        runtime
            .routes
            .iter()
            .map(|route| GatewayRouteSelection {
                station_id: route.station_id.clone(),
                key_id: route.key_id.clone(),
            })
            .collect()
    };
    Ok(GatewayStatus {
        mode,
        running: state.gateway.is_running(),
        port: runtime.port,
        base_url: gateway_base_url(runtime.port),
        active_station_id: runtime.route.as_ref().map(|route| route.station_id.clone()),
        active_key_id: runtime.route.as_ref().map(|route| route.key_id.clone()),
        has_active_route: runtime.route.is_some(),
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

pub(crate) async fn set_routing_mode(
    state: &AppState,
    mode: RoutingMode,
) -> Result<GatewayStatus, String> {
    match mode {
        RoutingMode::CcSwitch => {
            state.gateway.stop();
            state.gateway.clear_route().await;
        }
        RoutingMode::LocalGateway => {
            if state.gateway.runtime_snapshot().await.route.is_none() {
                let _ = restore_persisted_gateway_route(state).await;
            }
            state.gateway.start().await?;
        }
    }
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_setting("routingMode", routing_mode_setting(&mode))?;
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
        return Err("请先切换到本地稳定入口模式".into());
    }
    state.gateway.start().await?;
    get_status(state).await
}

pub(crate) async fn rotate_token(state: &AppState) -> Result<GatewayCredentials, String> {
    if current_routing_mode(state)? != RoutingMode::LocalGateway {
        return Err("请先切换到本地稳定入口模式".into());
    }
    let token = format!("rh-{}", Uuid::new_v4().simple());
    credential_entry(GATEWAY_TOKEN_ID)?
        .set_password(&token)
        .map_err(|error| error.to_string())?;
    state.gateway.rotate_token(token.clone()).await;
    let port = state.gateway.runtime_snapshot().await.port;
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
        return Err("本地稳定入口模式下不能导入 CC Switch".into());
    }
    if !matches!(target_app.as_str(), "claude" | "codex" | "gemini") {
        return Err("CC Switch 目标仅支持 Claude、Codex 或 Gemini".into());
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
        .map_err(|error| format!("无法启动 CC Switch：{error}"))
}

impl GatewayController {
    pub(crate) fn new(client: Client, token: String, port: u16) -> Self {
        Self::new_with_circuit_config(client, token, port, GatewayCircuitConfig::default())
    }

    fn new_with_circuit_config(
        client: Client,
        token: String,
        port: u16,
        circuit_config: GatewayCircuitConfig,
    ) -> Self {
        Self {
            runtime: Arc::new(RwLock::new(GatewayRuntime {
                token,
                port,
                route: None,
                routes: Vec::new(),
            })),
            client,
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

fn gateway_upstream_url(upstream_base_url: &str, uri: &axum::http::Uri) -> Result<String, String> {
    let path_and_query = uri
        .path_and_query()
        .map(|value| value.as_str())
        .unwrap_or("/v1");
    let suffix = path_and_query
        .strip_prefix("/v1")
        .ok_or("网关仅支持 /v1 请求")?;
    let target = format!("{}{}", upstream_base_url.trim_end_matches('/'), suffix);
    Url::parse(&target).map_err(|_| "活动路由的上游地址无效".to_string())?;
    Ok(target)
}

#[derive(Debug)]
struct BufferedGatewayResponse {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
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
        if success {
            breaker.record_success(used_half_open_probe, state.circuit_config);
        } else {
            breaker.record_failure(used_half_open_probe, state.circuit_config);
        }
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

async fn gateway_proxy(
    AxumState(state): AxumState<GatewayServiceState>,
    OriginalUri(uri): OriginalUri,
    request: Request<Body>,
) -> Response {
    let (parts, body) = request.into_parts();
    let snapshot = state.runtime.read().await.clone();
    if !gateway_request_authorized(&parts.headers, &snapshot.token) {
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
        return gateway_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "no_active_route",
            "尚未为本地网关选择活动路由",
        );
    }

    let payload = match to_bytes(body, 64 * 1024 * 1024).await {
        Ok(payload) => payload,
        Err(_) => {
            return gateway_error(
                StatusCode::PAYLOAD_TOO_LARGE,
                "request_too_large",
                "请求体超过本地网关 64 MB 限制",
            )
        }
    };

    let mut attempted = false;
    let mut last_error = None;
    let mut last_response = None;

    for route in routes {
        let Some(used_half_open_probe) = allow_gateway_route(&state, &route) else {
            continue;
        };
        attempted = true;

        let target = match gateway_upstream_url(&route.upstream_base_url, &uri) {
            Ok(target) => target,
            Err(error) => {
                record_gateway_route_result(&state, &route, used_half_open_probe, false);
                last_error = Some(error);
                continue;
            }
        };

        let mut outbound = state
            .client
            .request(parts.method.clone(), target)
            .timeout(GATEWAY_REQUEST_TIMEOUT)
            .bearer_auth(&route.api_key)
            .body(payload.clone());
        for (name, value) in &parts.headers {
            if name == header::AUTHORIZATION
                || name == header::HOST
                || name == header::CONTENT_LENGTH
                || is_hop_by_hop_header(name)
            {
                continue;
            }
            outbound = outbound.header(name.clone(), value.clone());
        }

        let upstream = match outbound.send().await {
            Ok(response) => response,
            Err(error) => {
                record_gateway_route_result(&state, &route, used_half_open_probe, false);
                last_error = Some(format!("上游请求失败：{error}"));
                continue;
            }
        };

        let status = upstream.status();
        if is_retryable_upstream_status(status) {
            let headers = upstream.headers().clone();
            match upstream.bytes().await {
                Ok(body) => {
                    last_response = Some(BufferedGatewayResponse {
                        status,
                        headers,
                        body: body.to_vec(),
                    });
                }
                Err(error) => {
                    last_error = Some(format!("上游错误响应读取失败：{error}"));
                }
            }
            record_gateway_route_result(&state, &route, used_half_open_probe, false);
            continue;
        }

        record_gateway_route_result(&state, &route, used_half_open_probe, true);
        state.runtime.write().await.route = Some(route);
        let response_headers = upstream.headers().clone();
        let response_body = Body::from_stream(upstream.bytes_stream());
        return build_gateway_response(status, &response_headers, response_body);
    }

    if let Some(response) = last_response {
        return build_gateway_response(
            response.status,
            &response.headers,
            Body::from(response.body),
        );
    }
    if !attempted {
        return gateway_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "all_routes_circuit_open",
            "所有本地网关路由均处于熔断状态",
        );
    }
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
        load_persisted_route_selections(&store)?
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
            upstream_base_url,
            api_key: format!("key-{key_id}"),
        }
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
        );
        let route = test_route("station-a", "key-a", "http://127.0.0.1:1/v1".into());
        controller.set_routes(vec![route.clone()]).await;
        let state = GatewayServiceState {
            runtime: controller.runtime.clone(),
            client: controller.client.clone(),
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
}
