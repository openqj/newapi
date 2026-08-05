use tauri::State;

use crate::{
    services::stations::{fetch_all_pages, load_authenticated_secret, parse_usage_logs},
    station_adapter::{PagedResource, Station, StationAdapter},
    station_store::StationStore,
    usage_store::UsageStore,
    AppState, UsageLog,
};

const MAX_USAGE_LOGS_RESPONSE: usize = 10_000;

fn refresh_station_metadata(logs: &mut [UsageLog], station: &Station) {
    for log in logs {
        if log.station_id == station.id {
            log.station_name = station.name.clone();
            log.station_url = station.base_url.clone();
        }
    }
}

#[tauri::command]
pub(crate) async fn list_usage_logs(state: State<'_, AppState>) -> Result<Vec<UsageLog>, String> {
    let stations = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .list_stations()?;
    let mut logs = Vec::new();
    for station in &stations {
        logs.extend(
            state
                .store
                .lock()
                .map_err(|_| "本地数据库不可用".to_string())?
                .cached_usage_logs(&station.id)?,
        );
    }
    for station in &stations {
        refresh_station_metadata(&mut logs, station);
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
    for station in &stations {
        let Ok(mut secret) = load_authenticated_secret(&state, station).await else {
            continue;
        };
        let adapter = StationAdapter::for_station(station)?;
        if let Ok(value) =
            fetch_all_pages(&state, station, &mut secret, adapter, PagedResource::Usage).await
        {
            let station_logs = parse_usage_logs(&value, station);
            if let Ok(mut store) = state.store.lock() {
                let _ = store.cache_usage_logs(&station_logs);
            }
            logs.extend(station_logs);
        } else if let Ok(store) = state.store.lock() {
            logs.extend(store.cached_usage_logs(&station.id)?);
        }
    }
    for station in &stations {
        refresh_station_metadata(&mut logs, station);
    }
    logs.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    logs.truncate(MAX_USAGE_LOGS_RESPONSE);
    Ok(logs)
}

#[cfg(test)]
mod tests {
    use super::refresh_station_metadata;
    use crate::{station_adapter::Station, UsageLog};

    #[test]
    fn cached_logs_use_current_station_metadata() {
        let station = Station {
            id: "station-1".into(),
            name: "Updated relay".into(),
            base_url: "https://updated.example.com".into(),
            kind: "newapi".into(),
            status: "online".into(),
            last_synced_at: None,
            last_error: None,
        };
        let mut logs = vec![UsageLog {
            id: "log-1".into(),
            station_id: station.id.clone(),
            station_name: "Old relay".into(),
            station_url: "https://old.example.com".into(),
            api_key_name: None,
            group_name: None,
            endpoint: None,
            ip_address: None,
            reasoning_effort: None,
            billing_type: None,
            billing_mode: None,
            model: "gpt-4o".into(),
            input_tokens: 1,
            output_tokens: 1,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
            actual_cost: 0.0,
            input_cost: None,
            output_cost: None,
            cache_creation_cost: None,
            cache_read_cost: None,
            total_cost: None,
            rate_multiplier: None,
            service_tier: None,
            request_type: "sync".into(),
            duration_ms: None,
            created_at: 1,
        }];

        refresh_station_metadata(&mut logs, &station);

        assert_eq!(logs[0].station_name, "Updated relay");
        assert_eq!(logs[0].station_url, "https://updated.example.com");
    }
}
