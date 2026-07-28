mod alert_store;
mod app;
#[cfg(windows)]
mod app_ui;
mod audit_store;
mod command_contract;
mod commands;
mod keyring_store;
mod login_profiles;
mod model_discovery_store;
mod models;
mod remote_store;
mod remote_sync_logs;
mod services;
mod settings_store;
mod station_adapter;
mod station_snapshot_store;
mod station_store;
mod store;
mod support;
mod usage_store;

pub(crate) use app::{AppState, AuthBackoff, RemoteOperationGuard};
use commands::alerts::{evaluate_alerts, get_alert_policy, list_alert_history, save_alert_policy};
use commands::api_keys::{
    create_api_key, delete_api_key, reveal_key, update_api_key, update_key_group,
};
use commands::audit::{list_audit_events, rollback_audit_event};
use commands::detection::{detect_model_authenticity, discover_api_models, test_api_models};
use commands::gateway::{
    get_gateway_credentials, get_gateway_status, import_to_cc_switch, rotate_gateway_token,
    set_active_gateway_route, set_gateway_port, set_routing_mode, start_gateway, stop_gateway,
};
use commands::profiles::{
    delete_login_profile, get_login_profile, list_login_profiles, save_login_profile,
};
use commands::provider_doctor::diagnose_station;
use commands::queries::{
    get_history, get_snapshot, get_usage_summary, list_account_rows, list_key_rows, list_rate_rows,
    list_station_groups,
};
use commands::remote::{
    add_remote_server, assign_remote_relay_key, cancel_remote_server_operation,
    choose_private_key_file, delete_remote_server, install_or_update_remote_codex_command,
    list_remote_servers, list_remote_sync_logs, test_remote_server, update_remote_relay,
    update_remote_server, verify_remote_codex_session_command,
};
use commands::settings::backup_database;
use commands::stations::{
    add_station, cancel_sync, clear_station_session, delete_station, get_sync_progress,
    list_stations, probe_station, reauthenticate_station, refresh_all, refresh_station,
};
use commands::usage::list_usage_logs;
use models::*;
use serde_json::Value;
use store::Store;

pub(crate) fn application_builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default().invoke_handler(tauri::generate_handler![
        probe_station,
        diagnose_station,
        get_alert_policy,
        save_alert_policy,
        evaluate_alerts,
        list_alert_history,
        add_station,
        list_stations,
        list_login_profiles,
        get_login_profile,
        save_login_profile,
        delete_login_profile,
        list_remote_servers,
        list_remote_sync_logs,
        cancel_remote_server_operation,
        install_or_update_remote_codex_command,
        choose_private_key_file,
        add_remote_server,
        update_remote_server,
        delete_remote_server,
        test_remote_server,
        verify_remote_codex_session_command,
        assign_remote_relay_key,
        update_remote_relay,
        refresh_station,
        reauthenticate_station,
        clear_station_session,
        refresh_all,
        get_sync_progress,
        cancel_sync,
        get_snapshot,
        get_usage_summary,
        list_usage_logs,
        get_history,
        list_audit_events,
        rollback_audit_event,
        list_key_rows,
        list_account_rows,
        list_rate_rows,
        list_station_groups,
        update_key_group,
        create_api_key,
        update_api_key,
        delete_api_key,
        reveal_key,
        get_gateway_status,
        set_routing_mode,
        set_gateway_port,
        start_gateway,
        stop_gateway,
        set_active_gateway_route,
        get_gateway_credentials,
        rotate_gateway_token,
        import_to_cc_switch,
        test_api_models,
        discover_api_models,
        detect_model_authenticity,
        delete_station,
        backup_database,
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app::run();
}
