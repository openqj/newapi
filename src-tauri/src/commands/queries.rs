use serde_json::Value;
use tauri::State;

use crate::{
    services::stations::{sum_f64, sum_i64},
    station_snapshot_store::StationSnapshotStore,
    station_store::StationStore,
    AccountRow, AppState, GroupOption, KeyRow, RateRow, StationSnapshot, UsageSummary,
};

#[tauri::command]
pub(crate) async fn get_snapshot(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<StationSnapshot>, String> {
    Ok(state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .load_snapshot(&id)?
        .map(|(_, snapshot)| snapshot))
}

#[tauri::command]
pub(crate) async fn get_history(
    state: State<'_, AppState>,
    id: String,
) -> Result<Vec<Value>, String> {
    state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .history(&id)
}

#[tauri::command]
pub(crate) async fn get_usage_summary(state: State<'_, AppState>) -> Result<UsageSummary, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?;
    let snapshots = store
        .list_stations()?
        .into_iter()
        .filter_map(|station| {
            store
                .load_snapshot(&station.id)
                .ok()
                .flatten()
                .map(|(_, snapshot)| snapshot)
        })
        .collect::<Vec<_>>();
    let cost_sources = snapshots
        .iter()
        .filter(|snapshot| {
            snapshot.usage.today_spent.is_some() || snapshot.usage.total_spent.is_some()
        })
        .count();
    let can_aggregate_cost = cost_sources <= 1;
    Ok(UsageSummary {
        today_input_tokens: sum_i64(
            snapshots
                .iter()
                .map(|snapshot| snapshot.usage.today_input_tokens),
        ),
        today_output_tokens: sum_i64(
            snapshots
                .iter()
                .map(|snapshot| snapshot.usage.today_output_tokens),
        ),
        today_requests: sum_i64(
            snapshots
                .iter()
                .map(|snapshot| snapshot.usage.today_requests),
        ),
        total_requests: sum_i64(
            snapshots
                .iter()
                .map(|snapshot| snapshot.usage.total_requests),
        ),
        today_spent: can_aggregate_cost
            .then(|| sum_f64(snapshots.iter().map(|snapshot| snapshot.usage.today_spent)))
            .flatten(),
        today_limit: can_aggregate_cost
            .then(|| sum_f64(snapshots.iter().map(|snapshot| snapshot.usage.today_limit)))
            .flatten(),
        total_spent: can_aggregate_cost
            .then(|| sum_f64(snapshots.iter().map(|snapshot| snapshot.usage.total_spent)))
            .flatten(),
        total_limit: can_aggregate_cost
            .then(|| sum_f64(snapshots.iter().map(|snapshot| snapshot.usage.total_limit)))
            .flatten(),
        costs_are_isolated: !can_aggregate_cost,
    })
}

#[tauri::command]
pub(crate) async fn list_key_rows(state: State<'_, AppState>) -> Result<Vec<KeyRow>, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?;
    let mut rows = Vec::new();
    for station in store.list_stations()? {
        if let Some((_, snapshot)) = store.load_snapshot(&station.id)? {
            let mut groups = Vec::new();
            for rate in &snapshot.rates {
                if groups
                    .iter()
                    .any(|group: &GroupOption| group.name == rate.group)
                {
                    continue;
                }
                groups.push(GroupOption {
                    name: rate.group.clone(),
                    description: rate.group_description.clone(),
                    multiplier: Some(rate.multiplier),
                });
            }
            groups.sort_by(|left, right| left.name.cmp(&right.name));
            for key in snapshot.api_keys {
                let group_models = snapshot
                    .rates
                    .iter()
                    .filter(|rate| key.group.as_deref().is_none_or(|group| rate.group == group))
                    .map(|rate| rate.model.clone())
                    .collect::<Vec<_>>();
                let model_source = if group_models.is_empty() {
                    snapshot
                        .rates
                        .iter()
                        .map(|rate| rate.model.clone())
                        .collect()
                } else {
                    group_models
                };
                let mut models = model_source
                    .into_iter()
                    .filter(|model| model != "全部模型")
                    .collect::<Vec<_>>();
                models.sort();
                models.dedup();
                rows.push(KeyRow {
                    station_id: station.id.clone(),
                    station_name: station.name.clone(),
                    station_url: station.base_url.clone(),
                    station_balance: snapshot.station_balance,
                    groups: groups.clone(),
                    models,
                    key,
                });
            }
        }
    }
    Ok(rows)
}

#[tauri::command]
pub(crate) async fn list_account_rows(
    state: State<'_, AppState>,
) -> Result<Vec<AccountRow>, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?;
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
pub(crate) async fn list_rate_rows(state: State<'_, AppState>) -> Result<Vec<RateRow>, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?;
    let mut rows = Vec::new();
    for station in store.list_stations()? {
        if let Some((_, snapshot)) = store.load_snapshot(&station.id)? {
            for rate in snapshot.rates {
                rows.push(RateRow {
                    station_id: station.id.clone(),
                    station_name: station.name.clone(),
                    station_url: station.base_url.clone(),
                    last_synced_at: station.last_synced_at,
                    sync_status: station.status.clone(),
                    rate,
                });
            }
        }
    }
    Ok(rows)
}

#[tauri::command]
pub(crate) async fn list_station_groups(
    state: State<'_, AppState>,
    station_id: String,
) -> Result<Vec<GroupOption>, String> {
    let store = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?;
    let snapshot = store
        .load_snapshot(&station_id)?
        .map(|(_, snapshot)| snapshot)
        .ok_or("请先同步该站点以获取可见分组")?;
    let mut groups = Vec::new();
    for rate in snapshot.rates {
        if groups
            .iter()
            .any(|group: &GroupOption| group.name == rate.group)
        {
            continue;
        }
        groups.push(GroupOption {
            name: rate.group,
            description: rate.group_description,
            multiplier: Some(rate.multiplier),
        });
    }
    groups.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(groups)
}
