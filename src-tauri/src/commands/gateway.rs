use tauri::{AppHandle, State};

use crate::services::gateway::{self, GatewayCredentials, GatewayStatus, RoutingMode};
use crate::AppState;

#[tauri::command]
pub(crate) async fn get_gateway_status(
    state: State<'_, AppState>,
) -> Result<GatewayStatus, String> {
    gateway::get_status(&state).await
}

#[tauri::command]
pub(crate) async fn stop_gateway(state: State<'_, AppState>) -> Result<GatewayStatus, String> {
    gateway::stop(&state).await
}

#[tauri::command]
pub(crate) async fn get_gateway_credentials(
    state: State<'_, AppState>,
) -> Result<GatewayCredentials, String> {
    gateway::credentials(&state).await
}

#[tauri::command]
pub(crate) async fn set_routing_mode(
    state: State<'_, AppState>,
    mode: RoutingMode,
) -> Result<GatewayStatus, String> {
    gateway::set_routing_mode(&state, mode).await
}

#[tauri::command]
pub(crate) async fn set_gateway_port(
    state: State<'_, AppState>,
    port: u16,
) -> Result<GatewayStatus, String> {
    gateway::set_port(&state, port).await
}

#[tauri::command]
pub(crate) async fn start_gateway(state: State<'_, AppState>) -> Result<GatewayStatus, String> {
    gateway::start(&state).await
}

#[tauri::command]
pub(crate) async fn set_active_gateway_route(
    state: State<'_, AppState>,
    station_id: String,
    key_id: String,
) -> Result<GatewayStatus, String> {
    gateway::set_gateway_route(&state, station_id, key_id).await?;
    gateway::get_status(&state).await
}

#[tauri::command]
pub(crate) async fn rotate_gateway_token(
    state: State<'_, AppState>,
) -> Result<GatewayCredentials, String> {
    gateway::rotate_token(&state).await
}

#[tauri::command]
pub(crate) async fn import_to_cc_switch(
    app: AppHandle,
    state: State<'_, AppState>,
    station_id: String,
    key_id: String,
    target_app: String,
) -> Result<(), String> {
    gateway::import_to_cc_switch(app, &state, station_id, key_id, target_app).await
}
