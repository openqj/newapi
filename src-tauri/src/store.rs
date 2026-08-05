use std::{
    fs,
    path::{Path, PathBuf},
};

use rusqlite::Connection;

pub(crate) struct Store {
    pub(crate) connection: Connection,
    pub(crate) path: PathBuf,
}

impl Store {
    pub(crate) fn open(path: PathBuf) -> Result<Self, String> {
        let connection = Connection::open(&path).map_err(|e| e.to_string())?;
        connection.execute_batch(
            "CREATE TABLE IF NOT EXISTS stations (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, base_url TEXT NOT NULL,
                kind TEXT NOT NULL, status TEXT NOT NULL, last_synced_at INTEGER, last_error TEXT
             );
             CREATE TABLE IF NOT EXISTS snapshots (
                station_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT, station_id TEXT NOT NULL, summary TEXT NOT NULL, created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT, station_id TEXT NOT NULL, action TEXT NOT NULL, outcome TEXT NOT NULL,
                detail TEXT NOT NULL, payload TEXT, created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS usage_log_cache (
                station_id TEXT NOT NULL, log_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
                PRIMARY KEY (station_id, log_id)
             );
             CREATE TABLE IF NOT EXISTS local_usage_logs (
                request_id TEXT PRIMARY KEY, provider_id TEXT NOT NULL, provider_name TEXT NOT NULL,
                app_type TEXT NOT NULL, model TEXT NOT NULL, request_model TEXT,
                input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
                cache_read_tokens INTEGER NOT NULL DEFAULT 0, cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
                input_token_semantics INTEGER NOT NULL DEFAULT 0,
                input_cost_usd REAL NOT NULL DEFAULT 0, output_cost_usd REAL NOT NULL DEFAULT 0,
                cache_read_cost_usd REAL NOT NULL DEFAULT 0, cache_creation_cost_usd REAL NOT NULL DEFAULT 0,
                total_cost_usd REAL NOT NULL DEFAULT 0, latency_ms INTEGER NOT NULL DEFAULT 0,
                first_token_ms INTEGER, duration_ms INTEGER, status_code INTEGER NOT NULL DEFAULT 0,
                error_message TEXT, is_streaming INTEGER NOT NULL DEFAULT 0,
                endpoint TEXT, key_id TEXT, created_at INTEGER NOT NULL,
                data_source TEXT NOT NULL DEFAULT 'local_gateway'
             );
             CREATE INDEX IF NOT EXISTS idx_local_usage_created_at ON local_usage_logs(created_at DESC);
             CREATE INDEX IF NOT EXISTS idx_local_usage_provider ON local_usage_logs(provider_name, provider_id);
             CREATE INDEX IF NOT EXISTS idx_local_usage_model ON local_usage_logs(model);
             CREATE INDEX IF NOT EXISTS idx_local_usage_app_created_at ON local_usage_logs(app_type, created_at DESC);
             CREATE INDEX IF NOT EXISTS idx_local_usage_app_provider_model_created_at
                ON local_usage_logs(app_type, provider_name, model, created_at DESC);
             CREATE INDEX IF NOT EXISTS idx_local_usage_provider_model_created_at
                ON local_usage_logs(provider_name, model, created_at DESC);
             CREATE TABLE IF NOT EXISTS local_model_pricing (
                model_id TEXT PRIMARY KEY, display_name TEXT NOT NULL,
                input_cost_per_million REAL NOT NULL DEFAULT 0,
                output_cost_per_million REAL NOT NULL DEFAULT 0,
                cache_read_cost_per_million REAL NOT NULL DEFAULT 0,
                cache_creation_cost_per_million REAL NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS model_discovery_cache (
                station_id TEXT NOT NULL, key_id TEXT NOT NULL, payload TEXT NOT NULL, fetched_at INTEGER NOT NULL,
                PRIMARY KEY (station_id, key_id)
             );
             CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY, value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS personal_center_memberships (
                station_id TEXT NOT NULL, account_id TEXT NOT NULL,
                user_email TEXT NOT NULL DEFAULT '',
                plan TEXT NOT NULL, access_level TEXT NOT NULL, enabled INTEGER NOT NULL,
                expires_at INTEGER, privileges TEXT NOT NULL, updated_at INTEGER NOT NULL,
                PRIMARY KEY (station_id, account_id)
             );
             CREATE TABLE IF NOT EXISTS personal_center_audit_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, subject TEXT NOT NULL,
                detail TEXT NOT NULL, created_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_personal_center_audit_events_created_at
                ON personal_center_audit_events(created_at DESC);
             CREATE TABLE IF NOT EXISTS alert_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                alert_id TEXT NOT NULL, station_id TEXT NOT NULL, station_name TEXT NOT NULL,
                severity TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL,
                status TEXT NOT NULL, occurred_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_alert_events_occurred_at ON alert_events(occurred_at DESC);
             CREATE TABLE IF NOT EXISTS alert_states (
                alert_id TEXT PRIMARY KEY, station_id TEXT NOT NULL, station_name TEXT NOT NULL,
                severity TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL,
                status TEXT NOT NULL, updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS login_profiles (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL, email TEXT NOT NULL DEFAULT ''
             );
             CREATE TABLE IF NOT EXISTS remote_servers (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 22, username TEXT NOT NULL,
                auth_type TEXT NOT NULL, private_key_path TEXT, codex_version TEXT, codex_latest_version TEXT, codex_update_available INTEGER NOT NULL DEFAULT 0, host_key_fingerprint TEXT, relay_url TEXT, relay_provider TEXT, relay_key_source TEXT,
                relay_key_masked TEXT, relay_config_fingerprint TEXT, connection_status TEXT NOT NULL DEFAULT 'warning', connection_error TEXT,
                last_synced_at INTEGER, last_sync_status TEXT, last_sync_error TEXT, updated_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS remote_sync_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT, server_id TEXT NOT NULL, status TEXT NOT NULL, action TEXT NOT NULL,
                summary TEXT NOT NULL, config_fingerprint TEXT, created_at INTEGER NOT NULL
             );"
        ).map_err(|e| e.to_string())?;
        let _ = connection.execute(
            "ALTER TABLE remote_servers ADD COLUMN port INTEGER NOT NULL DEFAULT 22",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE remote_servers ADD COLUMN codex_version TEXT",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE remote_servers ADD COLUMN codex_latest_version TEXT",
            [],
        );
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN codex_update_available INTEGER NOT NULL DEFAULT 0", []);
        let _ = connection.execute(
            "ALTER TABLE remote_servers ADD COLUMN host_key_fingerprint TEXT",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE remote_servers ADD COLUMN relay_provider TEXT",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE remote_servers ADD COLUMN relay_config_fingerprint TEXT",
            [],
        );
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'warning'", []);
        let _ = connection.execute(
            "ALTER TABLE remote_servers ADD COLUMN connection_error TEXT",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE remote_servers ADD COLUMN last_synced_at INTEGER",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE remote_servers ADD COLUMN last_sync_status TEXT",
            [],
        );
        let _ = connection.execute(
            "ALTER TABLE remote_servers ADD COLUMN last_sync_error TEXT",
            [],
        );
        let _ = connection.execute("ALTER TABLE audit_events ADD COLUMN payload TEXT", []);
        let _ = connection.execute("ALTER TABLE personal_center_memberships ADD COLUMN user_email TEXT NOT NULL DEFAULT ''", []);
        let _ = connection.execute(
            "ALTER TABLE login_profiles ADD COLUMN email TEXT NOT NULL DEFAULT ''",
            [],
        );
        connection
            .execute_batch(
                "INSERT OR IGNORE INTO local_model_pricing
                 (model_id, display_name, input_cost_per_million, output_cost_per_million, cache_read_cost_per_million, cache_creation_cost_per_million)
                 VALUES
                 ('claude-3-5-sonnet', 'Claude 3.5 Sonnet', 3, 15, 0.3, 3.75),
                 ('claude-3-7-sonnet', 'Claude 3.7 Sonnet', 3, 15, 0.3, 3.75),
                 ('claude-sonnet-4', 'Claude Sonnet 4', 3, 15, 0.3, 3.75),
                 ('claude-opus-4', 'Claude Opus 4', 15, 75, 1.5, 18.75),
                 ('gpt-4o', 'GPT-4o', 2.5, 10, 1.25, 0),
                 ('gpt-4o-mini', 'GPT-4o mini', 0.15, 0.6, 0.075, 0),
                 ('gpt-4.1', 'GPT-4.1', 2, 8, 0.5, 0),
                 ('gpt-4.1-mini', 'GPT-4.1 mini', 0.4, 1.6, 0.1, 0),
                 ('o3', 'o3', 2, 8, 0.5, 0),
                 ('o4-mini', 'o4-mini', 1.1, 4.4, 0.275, 0),
                 ('gemini-2.5-pro', 'Gemini 2.5 Pro', 1.25, 10, 0.3125, 0),
                 ('gemini-2.5-flash', 'Gemini 2.5 Flash', 0.3, 2.5, 0.075, 0);",
            )
            .map_err(|e| e.to_string())?;
        Ok(Self { connection, path })
    }

    pub(crate) fn checkpoint_and_copy(&self, destination: &Path) -> Result<(), String> {
        let _ = self.connection.execute_batch("PRAGMA wal_checkpoint(FULL)");
        fs::copy(&self.path, destination).map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::Store;
    use crate::{
        personal_center_store::{MembershipAccess, PersonalCenterStore},
        remote_sync_logs::RemoteSyncLogStore,
    };

    #[test]
    fn migrates_existing_remote_server_storage_and_preserves_sync_logs() {
        let database =
            tempfile::NamedTempFile::new().expect("temporary database should be created");
        let connection = Connection::open(database.path()).expect("temporary database should open");
        connection.execute_batch("CREATE TABLE remote_servers (id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL, username TEXT NOT NULL, auth_type TEXT NOT NULL, private_key_path TEXT, relay_url TEXT, relay_key_source TEXT, relay_key_masked TEXT, connection_status TEXT NOT NULL DEFAULT 'warning', connection_error TEXT, updated_at INTEGER NOT NULL);").expect("old remote server schema should be created");
        drop(connection);

        let store =
            Store::open(database.path().to_path_buf()).expect("existing storage should migrate");
        let columns = store
            .connection
            .prepare("PRAGMA table_info(remote_servers)")
            .expect("table info should prepare")
            .query_map([], |row| row.get::<_, String>(1))
            .expect("table info should query")
            .collect::<Result<Vec<_>, _>>()
            .expect("table info should collect");
        for column in [
            "port",
            "codex_version",
            "codex_latest_version",
            "codex_update_available",
            "host_key_fingerprint",
            "relay_provider",
            "relay_config_fingerprint",
            "last_sync_status",
        ] {
            assert!(
                columns.iter().any(|value| value == column),
                "missing migrated column {column}"
            );
        }
        store
            .add_remote_sync_log(
                "server-1",
                "success",
                "test",
                "read complete",
                Some("sha256:test"),
            )
            .expect("sync log should save");
        let logs = store
            .list_remote_sync_logs("server-1")
            .expect("sync logs should list");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].config_fingerprint.as_deref(), Some("sha256:test"));
    }

    #[test]
    fn creates_personal_center_storage_for_existing_databases() {
        let database =
            tempfile::NamedTempFile::new().expect("temporary database should be created");
        let connection = Connection::open(database.path()).expect("temporary database should open");
        connection
            .execute_batch("CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);")
            .expect("old schema should be created");
        drop(connection);

        let store = Store::open(database.path().to_path_buf()).expect("database should migrate");
        store
            .save_membership(&MembershipAccess {
                station_id: "station-1".into(),
                account_id: "account-1".into(),
                user_email: "user@example.com".into(),
                plan: "pro".into(),
                access_level: "member".into(),
                enabled: true,
                expires_at: None,
                privileges: vec!["usage".into()],
                updated_at: 1,
            })
            .expect("membership should persist");
        assert_eq!(
            store
                .list_memberships()
                .expect("memberships should list")
                .len(),
            1
        );
    }
}
