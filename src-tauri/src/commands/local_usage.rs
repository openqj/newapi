use tauri::State;

use crate::{
    local_usage_store::{
        LocalModelPricing, LocalModelPricingInput, LocalUsageDashboard, LocalUsageQuery,
    },
    AppState,
};

#[tauri::command]
pub(crate) fn get_local_usage_dashboard(
    state: State<'_, AppState>,
    query: LocalUsageQuery,
) -> Result<LocalUsageDashboard, String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .local_usage_dashboard(&query)
}

#[tauri::command]
pub(crate) fn get_local_usage_refresh_interval(
    state: State<'_, AppState>,
) -> Result<u64, String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .local_usage_refresh_interval()
}

#[tauri::command]
pub(crate) fn save_local_usage_refresh_interval(
    state: State<'_, AppState>,
    interval_ms: u64,
) -> Result<u64, String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_local_usage_refresh_interval(interval_ms)
}

#[tauri::command]
pub(crate) fn get_local_usage_pricing(
    state: State<'_, AppState>,
) -> Result<Vec<LocalModelPricing>, String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .local_model_pricing()
}

#[tauri::command]
pub(crate) fn save_local_usage_pricing(
    state: State<'_, AppState>,
    pricing: LocalModelPricingInput,
) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .save_local_model_pricing(pricing)
}

#[tauri::command]
pub(crate) fn delete_local_usage_pricing(
    state: State<'_, AppState>,
    model_id: String,
) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .delete_local_model_pricing(&model_id)
}

#[tauri::command]
pub(crate) fn clear_local_usage_logs(state: State<'_, AppState>) -> Result<(), String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .clear_local_usage_logs()
}
