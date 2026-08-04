use crate::station_adapter::{Station, StationCapabilities};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiKeyInfo {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) masked_key: String,
    pub(crate) group: Option<String>,
    pub(crate) status: String,
    pub(crate) remaining_quota: Option<f64>,
    pub(crate) total_quota: Option<f64>,
    pub(crate) unlimited_quota: bool,
    pub(crate) current_concurrency: Option<i64>,
    pub(crate) used_quota: Option<f64>,
    pub(crate) today_spent: Option<f64>,
    pub(crate) last_30_days_spent: Option<f64>,
    /// Optional provider-supplied quota reset timestamp (Unix seconds).
    pub(crate) quota_reset_at: Option<i64>,
    pub(crate) expires_at: Option<i64>,
    pub(crate) created_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeyRow {
    pub(crate) station_id: String,
    pub(crate) station_name: String,
    pub(crate) station_url: String,
    pub(crate) station_balance: Option<f64>,
    pub(crate) groups: Vec<GroupOption>,
    pub(crate) models: Vec<String>,
    pub(crate) key: ApiKeyInfo,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountInfo {
    pub(crate) id: String,
    pub(crate) username: String,
    pub(crate) display_name: String,
    pub(crate) email: Option<String>,
    pub(crate) group: Option<String>,
    pub(crate) role: String,
    pub(crate) status: String,
    pub(crate) balance: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountRow {
    pub(crate) station_id: String,
    pub(crate) station_name: String,
    pub(crate) station_url: String,
    pub(crate) kind: String,
    pub(crate) sync_status: String,
    pub(crate) last_synced_at: Option<i64>,
    pub(crate) account: AccountInfo,
    pub(crate) usage: UsageStats,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StationAccountCredentials {
    pub(crate) username: String,
    pub(crate) password: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelTestResult {
    pub(crate) model: String,
    pub(crate) available: bool,
    pub(crate) protocol: String,
    pub(crate) response: Option<String>,
    pub(crate) error: Option<String>,
    pub(crate) elapsed_ms: u64,
    pub(crate) first_token_ms: Option<u64>,
    pub(crate) tokens_per_second: Option<f64>,
    pub(crate) input_tokens: Option<i64>,
    pub(crate) output_tokens: Option<i64>,
    pub(crate) cache_read_tokens: Option<i64>,
    pub(crate) cost: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelDiscoveryResult {
    pub(crate) models: Vec<String>,
    pub(crate) elapsed_ms: u64,
    /// Unix timestamp of the model-list response retained for this station/key.
    pub(crate) fetched_at: Option<i64>,
    /// `true` when a fresh local model-list cache avoided a network request.
    pub(crate) from_cache: bool,
    /// A model endpoint is optional on compatible relays. Keep this structured so
    /// callers can retain their current selection instead of treating it as fatal.
    pub(crate) error: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelDetectionRequest {
    #[serde(default)]
    pub(crate) endpoint: String,
    #[serde(default)]
    pub(crate) api_key: String,
    pub(crate) model: String,
    pub(crate) protocol: String,
    pub(crate) station_id: Option<String>,
    pub(crate) key_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelDetectionCheck {
    pub(crate) name: String,
    pub(crate) status: String,
    pub(crate) detail: String,
    pub(crate) trace: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelDetectionResult {
    pub(crate) score: u8,
    pub(crate) checks: Vec<ModelDetectionCheck>,
    pub(crate) elapsed_ms: u64,
    pub(crate) tokens_per_second: f64,
    pub(crate) input_tokens: i64,
    pub(crate) output_tokens: i64,
    pub(crate) cache_read_tokens: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GroupOption {
    pub(crate) name: String,
    pub(crate) description: Option<String>,
    pub(crate) multiplier: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GroupRate {
    pub(crate) group: String,
    pub(crate) group_description: Option<String>,
    pub(crate) model: String,
    pub(crate) multiplier: f64,
    pub(crate) input_multiplier: Option<f64>,
    pub(crate) output_multiplier: Option<f64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RateRow {
    pub(crate) station_id: String,
    pub(crate) station_name: String,
    pub(crate) station_url: String,
    pub(crate) last_synced_at: Option<i64>,
    pub(crate) sync_status: String,
    pub(crate) rate: GroupRate,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Offer {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) summary: String,
    pub(crate) source_url: String,
    pub(crate) published_at: Option<i64>,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageStats {
    pub(crate) today_input_tokens: Option<i64>,
    pub(crate) today_output_tokens: Option<i64>,
    pub(crate) today_requests: Option<i64>,
    pub(crate) total_requests: Option<i64>,
    pub(crate) today_spent: Option<f64>,
    pub(crate) today_limit: Option<f64>,
    pub(crate) total_spent: Option<f64>,
    pub(crate) total_limit: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageSummary {
    pub(crate) today_input_tokens: Option<i64>,
    pub(crate) today_output_tokens: Option<i64>,
    pub(crate) today_requests: Option<i64>,
    pub(crate) total_requests: Option<i64>,
    pub(crate) today_spent: Option<f64>,
    pub(crate) today_limit: Option<f64>,
    pub(crate) total_spent: Option<f64>,
    pub(crate) total_limit: Option<f64>,
    pub(crate) costs_are_isolated: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StationSnapshot {
    pub(crate) station_balance: Option<f64>,
    #[serde(default)]
    pub(crate) account: AccountInfo,
    pub(crate) rates: Vec<GroupRate>,
    pub(crate) api_keys: Vec<ApiKeyInfo>,
    pub(crate) offers: Vec<Offer>,
    pub(crate) unavailable: Vec<String>,
    #[serde(default)]
    pub(crate) usage: UsageStats,
    #[serde(default)]
    pub(crate) capabilities: StationCapabilities,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddStationRequest {
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) username: String,
    pub(crate) password: String,
    pub(crate) kind: String,
    pub(crate) totp: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RegisterStationAccountRequest {
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) email: String,
    pub(crate) username: Option<String>,
    pub(crate) password: String,
    pub(crate) verification_code: String,
    pub(crate) kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImportStationWithCodeRequest {
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) email: String,
    pub(crate) password: String,
    pub(crate) verification_code: String,
    pub(crate) redeem_code: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateStationRequest {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) username: Option<String>,
    pub(crate) password: Option<String>,
    pub(crate) kind: String,
    pub(crate) totp: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ApiKeyMutationRequest {
    pub(crate) station_id: String,
    pub(crate) key_id: Option<String>,
    pub(crate) name: Option<String>,
    pub(crate) group: Option<String>,
    pub(crate) custom_key: Option<String>,
    pub(crate) quota: Option<f64>,
    pub(crate) expires_in_days: Option<i64>,
    pub(crate) status: Option<String>,
    pub(crate) ip_whitelist: Option<Vec<String>>,
    pub(crate) ip_blacklist: Option<Vec<String>>,
    pub(crate) rate_limit_5h: Option<f64>,
    pub(crate) rate_limit_1d: Option<f64>,
    pub(crate) rate_limit_7d: Option<f64>,
    pub(crate) reset_quota: Option<bool>,
    pub(crate) reset_rate_limit_usage: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StationConnectionResult {
    pub(crate) success: bool,
    pub(crate) status: String,
    pub(crate) reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StationSaveResult {
    pub(crate) station: Station,
    pub(crate) connection: StationConnectionResult,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StationCodeImportResult {
    pub(crate) station: Station,
    pub(crate) connection: StationConnectionResult,
    pub(crate) redemption_message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StationProbe {
    pub(crate) name: String,
    pub(crate) kind: Option<String>,
    pub(crate) requires_email_verification: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderDoctorCheck {
    /// Stable identifier for filtering and future UI presentation.
    pub(crate) id: String,
    pub(crate) name: String,
    /// One of: pass, warning, fail, or skipped.
    pub(crate) status: String,
    pub(crate) detail: String,
    pub(crate) remediation: Option<String>,
    pub(crate) elapsed_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProviderDoctorReport {
    pub(crate) station_id: String,
    pub(crate) station_name: String,
    pub(crate) adapter: String,
    pub(crate) healthy: bool,
    pub(crate) elapsed_ms: u64,
    pub(crate) checks: Vec<ProviderDoctorCheck>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UsageLog {
    pub(crate) id: String,
    pub(crate) station_id: String,
    pub(crate) station_name: String,
    pub(crate) station_url: String,
    pub(crate) api_key_name: Option<String>,
    pub(crate) group_name: Option<String>,
    pub(crate) endpoint: Option<String>,
    pub(crate) ip_address: Option<String>,
    pub(crate) reasoning_effort: Option<String>,
    pub(crate) billing_type: Option<String>,
    pub(crate) billing_mode: Option<String>,
    pub(crate) model: String,
    pub(crate) input_tokens: i64,
    pub(crate) output_tokens: i64,
    pub(crate) cache_creation_tokens: i64,
    pub(crate) cache_read_tokens: i64,
    pub(crate) actual_cost: f64,
    pub(crate) request_type: String,
    pub(crate) duration_ms: Option<i64>,
    pub(crate) created_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteServer {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_type: String,
    pub(crate) private_key_path: Option<String>,
    pub(crate) codex_version: Option<String>,
    pub(crate) codex_latest_version: Option<String>,
    pub(crate) codex_update_available: bool,
    pub(crate) host_key_fingerprint: Option<String>,
    pub(crate) relay_url: Option<String>,
    pub(crate) relay_provider: Option<String>,
    pub(crate) relay_key_source: Option<String>,
    pub(crate) relay_key_masked: Option<String>,
    pub(crate) relay_config_fingerprint: Option<String>,
    pub(crate) connection_status: String,
    pub(crate) connection_error: Option<String>,
    pub(crate) last_synced_at: Option<i64>,
    pub(crate) last_sync_status: Option<String>,
    pub(crate) last_sync_error: Option<String>,
    pub(crate) updated_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteConnectionResult {
    pub(crate) success: bool,
    pub(crate) status: String,
    pub(crate) code: Option<i32>,
    pub(crate) reason: Option<String>,
    pub(crate) host_key_fingerprint: Option<String>,
    pub(crate) requires_host_key_confirmation: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GenerateSshKeyRequest {
    pub(crate) host: String,
    #[serde(default = "default_ssh_port")]
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) password: String,
    pub(crate) host_key_fingerprint: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GenerateSshKeyResult {
    pub(crate) private_key_path: Option<String>,
    pub(crate) public_key_path: Option<String>,
    pub(crate) connection: RemoteConnectionResult,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteServerSaveResult {
    pub(crate) server: RemoteServer,
    pub(crate) connection: RemoteConnectionResult,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteSyncLog {
    pub(crate) id: i64,
    pub(crate) server_id: String,
    pub(crate) status: String,
    pub(crate) action: String,
    pub(crate) summary: String,
    pub(crate) config_fingerprint: Option<String>,
    pub(crate) created_at: i64,
}

/// A redacted, user-facing record of a local configuration mutation.  The
/// payload is intentionally JSON rather than an arbitrary command request:
/// secrets never belong in audit history.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuditEvent {
    pub(crate) id: i64,
    pub(crate) station_id: String,
    pub(crate) action: String,
    pub(crate) outcome: String,
    pub(crate) detail: String,
    pub(crate) payload: Option<serde_json::Value>,
    pub(crate) created_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteServerRollbackSnapshot {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) username: String,
    /// Authentication method is not a credential.  Passwords, key passphrases,
    /// and private-key paths are deliberately excluded from audit history.
    pub(crate) auth_type: String,
    pub(crate) host_key_fingerprint: Option<String>,
    pub(crate) relay_provider: Option<String>,
    pub(crate) relay_url: Option<String>,
}

pub(crate) const DEFAULT_SSH_PORT: u16 = 22;
pub(crate) fn default_ssh_port() -> u16 {
    DEFAULT_SSH_PORT
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddRemoteServerRequest {
    pub(crate) name: String,
    pub(crate) host: String,
    #[serde(default = "default_ssh_port")]
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_type: String,
    pub(crate) password: Option<String>,
    pub(crate) private_key_path: Option<String>,
    pub(crate) private_key_passphrase: Option<String>,
    pub(crate) relay_provider: Option<String>,
    pub(crate) host_key_fingerprint: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateRemoteServerRequest {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) host: String,
    #[serde(default = "default_ssh_port")]
    pub(crate) port: u16,
    pub(crate) username: String,
    pub(crate) auth_type: String,
    pub(crate) password: Option<String>,
    pub(crate) private_key_path: Option<String>,
    pub(crate) private_key_passphrase: Option<String>,
    pub(crate) relay_provider: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateRemoteRelayRequest {
    pub(crate) server_id: String,
    pub(crate) relay_url: String,
    pub(crate) relay_key: Option<String>,
    pub(crate) relay_provider: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncResult {
    pub(crate) station: Station,
    pub(crate) snapshot: StationSnapshot,
    pub(crate) changed: bool,
    pub(crate) change_summary: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SyncProgress {
    pub(crate) operation_id: String,
    pub(crate) completed: usize,
    pub(crate) total: usize,
    pub(crate) current_station: Option<String>,
    pub(crate) status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CodexIntegrationStatus {
    pub(crate) preserve_official_login: bool,
    pub(crate) config_directory: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActiveCodexRelayStatus {
    pub(crate) name: String,
    pub(crate) balance: Option<f64>,
    pub(crate) balance_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudAuthStatus {
    pub(crate) configured: bool,
    pub(crate) email: Option<String>,
    pub(crate) is_admin: bool,
    pub(crate) role: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudBackupSummary {
    pub(crate) id: String,
    pub(crate) created_at: String,
    pub(crate) byte_size: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CloudBackupPreview {
    pub(crate) id: String,
    pub(crate) station_count: usize,
    pub(crate) login_profile_count: usize,
    pub(crate) remote_server_count: usize,
}
