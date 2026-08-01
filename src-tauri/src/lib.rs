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
mod personal_center_store;
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
    apply_api_key_to_codex, create_api_key, delete_api_key, reveal_key, update_api_key,
    update_key_group,
};
use commands::audit::{list_audit_events, rollback_audit_event};
use commands::detection::{detect_model_authenticity, discover_api_models, test_api_models};
use commands::gateway::{
    get_gateway_credentials, get_gateway_status, import_to_cc_switch, rotate_gateway_token,
    set_active_gateway_route, set_gateway_port, set_routing_mode, start_gateway, stop_gateway,
};
use commands::personal_center::{
    claim_merchant_free_code, delete_admin_merchant_free_code,
    delete_admin_merchant_rate_share, delete_personal_center_membership,
    delete_personal_center_notification, get_merchant_profile,
    get_personal_center_notification_preferences, get_personal_center_realtime_session,
    import_merchant_free_codes, list_admin_merchant_free_codes,
    list_admin_merchant_profiles, list_admin_merchant_rate_shares,
    list_merchant_free_offers, list_merchant_rate_shares,
    list_personal_center_audit_history, list_personal_center_login_events,
    list_personal_center_memberships, list_personal_center_notifications,
    list_sent_personal_center_notifications, mark_personal_center_notification,
    publish_merchant_rate_share, publish_personal_center_notification,
    refresh_personal_center_notification_preferences, release_merchant_free_code,
    revoke_personal_center_notification, save_personal_center_membership,
    save_admin_merchant_free_code, save_admin_merchant_profile,
    save_admin_merchant_rate_share,
    save_merchant_profile, save_personal_center_notification_preferences,
    update_personal_center_notification,
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
use commands::settings::{
    backup_database, cloud_complete_password_reset, cloud_request_password_reset, cloud_sign_in,
    cloud_sign_out, cloud_sign_up, create_cloud_backup, delete_cloud_backup,
    get_active_codex_relay_status, get_cloud_auth_status, get_codex_integration,
    get_local_cloud_backup_preview, list_cloud_backups, preview_cloud_backup, restore_cloud_backup,
    set_codex_preserve_official_login,
};
use commands::stations::{
    add_station, cancel_sync, clear_station_session, delete_station, get_sync_progress,
    import_station_with_code,
    list_stations, probe_station, reauthenticate_station, refresh_all, refresh_station,
    redeem_station_code, send_station_verification_code, update_station,
};
use commands::usage::{list_usage_logs, refresh_usage_logs};
use models::*;
use serde_json::Value;
use store::Store;

pub(crate) fn application_builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default().invoke_handler(tauri::generate_handler![
        probe_station,
        send_station_verification_code,
        diagnose_station,
        get_alert_policy,
        save_alert_policy,
        evaluate_alerts,
        list_alert_history,
        add_station,
        import_station_with_code,
        redeem_station_code,
        update_station,
        list_stations,
        list_login_profiles,
        get_login_profile,
        save_login_profile,
        delete_login_profile,
        get_personal_center_notification_preferences,
        get_merchant_profile,
        save_merchant_profile,
        list_admin_merchant_profiles,
        save_admin_merchant_profile,
        list_admin_merchant_rate_shares,
        save_admin_merchant_rate_share,
        delete_admin_merchant_rate_share,
        list_admin_merchant_free_codes,
        save_admin_merchant_free_code,
        delete_admin_merchant_free_code,
        list_merchant_rate_shares,
        publish_merchant_rate_share,
        import_merchant_free_codes,
        list_merchant_free_offers,
        claim_merchant_free_code,
        release_merchant_free_code,
        refresh_personal_center_notification_preferences,
        save_personal_center_notification_preferences,
        list_personal_center_memberships,
        save_personal_center_membership,
        delete_personal_center_membership,
        list_personal_center_audit_history,
        list_personal_center_notifications,
        publish_personal_center_notification,
        list_sent_personal_center_notifications,
        update_personal_center_notification,
        revoke_personal_center_notification,
        delete_personal_center_notification,
        mark_personal_center_notification,
        get_personal_center_realtime_session,
        list_personal_center_login_events,
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
        refresh_usage_logs,
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
        apply_api_key_to_codex,
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
        get_cloud_auth_status,
        cloud_sign_up,
        cloud_sign_in,
        cloud_request_password_reset,
        cloud_complete_password_reset,
        cloud_sign_out,
        list_cloud_backups,
        get_local_cloud_backup_preview,
        create_cloud_backup,
        delete_cloud_backup,
        preview_cloud_backup,
        restore_cloud_backup,
        get_active_codex_relay_status,
        get_codex_integration,
        set_codex_preserve_official_login,
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    app::run();
}
