use tauri::State;

use crate::{
    services::stations::{fetch_all_pages, load_authenticated_secret, parse_usage_logs},
    station_adapter::{PagedResource, StationAdapter},
    station_store::StationStore,
    usage_store::UsageStore,
    AppState, UsageLog,
};

const MAX_USAGE_LOGS_RESPONSE: usize = 10_000;

#[tauri::command]
pub(crate) async fn list_usage_logs(state: State<'_, AppState>) -> Result<Vec<UsageLog>, String> {
    let stations = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .list_stations()?;
    let mut logs = Vec::new();
    for station in stations {
        logs.extend(
            state
                .store
                .lock()
                .map_err(|_| "本地数据库不可用".to_string())?
                .cached_usage_logs(&station.id)?,
        );
    }
    logs.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    logs.truncate(MAX_USAGE_LOGS_RESPONSE);
    Ok(logs)
}

#[tauri::command]
pub(crate) async fn refresh_usage_logs(
    state: State<'_, AppState>,
) -> Result<Vec<UsageLog>, String> {
    let stations = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .list_stations()?;
    let mut logs = Vec::new();
    for station in stations {
        let Ok(mut secret) = load_authenticated_secret(&state, &station).await else {
            continue;
        };
        let adapter = StationAdapter::for_station(&station)?;
        if let Ok(value) =
            fetch_all_pages(&state, &station, &mut secret, adapter, PagedResource::Usage).await
        {
            let station_logs = parse_usage_logs(&value, &station);
            if let Ok(mut store) = state.store.lock() {
                let _ = store.cache_usage_logs(&station_logs);
            }
            logs.extend(station_logs);
        } else if let Ok(store) = state.store.lock() {
            logs.extend(store.cached_usage_logs(&station.id)?);
        }
    }
    logs.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    logs.truncate(MAX_USAGE_LOGS_RESPONSE);
    Ok(logs)
}
