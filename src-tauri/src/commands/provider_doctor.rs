use tauri::State;

use crate::{
    models::ProviderDoctorReport, services::provider_doctor::diagnose, station_store::StationStore,
    AppState,
};

#[tauri::command]
pub(crate) async fn diagnose_station(
    state: State<'_, AppState>,
    station_id: String,
    key_id: Option<String>,
) -> Result<ProviderDoctorReport, String> {
    let station = state
        .store
        .lock()
        .map_err(|_| "本地数据库不可用".to_string())?
        .get_station(&station_id)?;
    Ok(diagnose(&state, &station, key_id.as_deref()).await)
}
