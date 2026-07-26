//! Stable names exposed to the frontend and external desktop automation.
//! Keep this list in sync with `generate_handler!` in `lib.rs` whenever a
//! command is added or removed.

#[cfg_attr(not(test), allow(dead_code))]
pub const COMMAND_NAMES: &[&str] = &[
    "probe_station", "add_station", "list_stations", "list_login_profiles",
    "get_login_profile", "save_login_profile", "delete_login_profile",
    "list_remote_servers", "list_remote_sync_logs", "cancel_remote_server_operation",
    "install_or_update_remote_codex_command", "choose_private_key_file",
    "add_remote_server", "update_remote_server", "delete_remote_server",
    "test_remote_server", "verify_remote_codex_session_command",
    "assign_remote_relay_key", "update_remote_relay", "refresh_station",
    "reauthenticate_station", "clear_station_session", "refresh_all",
    "get_sync_progress", "cancel_sync", "get_snapshot", "get_usage_summary",
    "list_usage_logs", "get_history", "list_key_rows", "list_account_rows",
    "list_rate_rows", "list_station_groups", "update_key_group", "create_api_key",
    "update_api_key", "delete_api_key", "reveal_key", "get_gateway_status",
    "set_routing_mode", "set_gateway_port", "start_gateway", "stop_gateway",
    "set_active_gateway_route", "get_gateway_credentials", "rotate_gateway_token",
    "import_to_cc_switch", "test_api_models", "detect_model_authenticity",
    "delete_station", "backup_database",
];
