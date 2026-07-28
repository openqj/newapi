use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
};

use axum::{
    body::{to_bytes, Body},
    extract::{OriginalUri, State as AxumState},
    http::{header, HeaderMap, HeaderName, Request, StatusCode},
    response::{IntoResponse, Response},
    routing::any,
    Router,
};
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

#[derive(Clone, Debug)]
pub(crate) struct GatewayRuntime {
    pub(crate) token: String,
    pub(crate) port: u16,
    pub(crate) route: Option<GatewayRoute>,
}

#[derive(Clone)]
struct GatewayServiceState {
    runtime: Arc<RwLock<GatewayRuntime>>,
    client: Client,
}

pub(crate) struct GatewayController {
    runtime: Arc<RwLock<GatewayRuntime>>,
    client: Client,
    shutdown: Mutex<Option<oneshot::Sender<()>>>,
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
    if current_routing_mode(state)? != RoutingMode::LocalGateway {
        return Err("请先切换到本地稳定入口模式".into());
    }
    let (station, api_key) = read_api_key(state, &station_id, &key_id).await?;
    state
        .gateway
        .set_route(GatewayRoute {
            station_id: station_id.clone(),
            key_id: key_id.clone(),
            upstream_base_url: api_base_url(&station.base_url),
            api_key,
        })
        .await;
    {
        let store = state
            .store
            .lock()
            .map_err(|_| "本地数据库不可用".to_string())?;
        store.save_setting("activeGatewayStationId", &station_id)?;
        store.save_setting("activeGatewayKeyId", &key_id)?;
    }
    state.gateway.start().await
}

pub(crate) async fn get_status(state: &AppState) -> Result<GatewayStatus, String> {
    let mode = current_routing_mode(state)?;
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
        Self {
            runtime: Arc::new(RwLock::new(GatewayRuntime {
                token,
                port,
                route: None,
            })),
            client,
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

    pub(crate) async fn set_route(&self, route: GatewayRoute) {
        self.runtime.write().await.route = Some(route);
    }

    pub(crate) async fn clear_route(&self) {
        self.runtime.write().await.route = None;
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
    let route = match snapshot.route {
        Some(route) => route,
        None => {
            return gateway_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "no_active_route",
                "尚未为本地网关选择活动路由",
            )
        }
    };
    let target = match gateway_upstream_url(&route.upstream_base_url, &uri) {
        Ok(target) => target,
        Err(error) => {
            return gateway_error(StatusCode::SERVICE_UNAVAILABLE, "invalid_route", error)
        }
    };
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
    let mut outbound = state
        .client
        .request(parts.method, target)
        .bearer_auth(route.api_key)
        .body(payload);
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
            return gateway_error(
                StatusCode::BAD_GATEWAY,
                "upstream_unavailable",
                format!("上游请求失败：{error}"),
            )
        }
    };
    let status = upstream.status();
    let headers = upstream.headers().clone();
    let mut response = Response::builder().status(status);
    if let Some(output_headers) = response.headers_mut() {
        for (name, value) in &headers {
            if name == header::CONTENT_LENGTH || is_hop_by_hop_header(name) {
                continue;
            }
            output_headers.append(name.clone(), value.clone());
        }
    }
    response
        .body(Body::from_stream(upstream.bytes_stream()))
        .unwrap_or_else(|_| {
            gateway_error(
                StatusCode::BAD_GATEWAY,
                "response_build_failed",
                "无法创建上游响应",
            )
        })
}

pub(crate) async fn restore_persisted_gateway_route(state: &AppState) -> Result<(), String> {
    let (station_id, key_id) = {
        let store = state
            .store
            .lock()
            .map_err(|_| "本地数据库不可用".to_string())?;
        (
            store.setting("activeGatewayStationId")?,
            store.setting("activeGatewayKeyId")?,
        )
    };
    let (Some(station_id), Some(key_id)) = (station_id, key_id) else {
        return Ok(());
    };
    let (station, api_key) = read_api_key(state, &station_id, &key_id).await?;
    state
        .gateway
        .set_route(GatewayRoute {
            station_id,
            key_id,
            upstream_base_url: api_base_url(&station.base_url),
            api_key,
        })
        .await;
    Ok(())
}
