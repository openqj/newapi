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
             CREATE TABLE IF NOT EXISTS model_discovery_cache (
                station_id TEXT NOT NULL, key_id TEXT NOT NULL, payload TEXT NOT NULL, fetched_at INTEGER NOT NULL,
                PRIMARY KEY (station_id, key_id)
             );
             CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY, value TEXT NOT NULL
             );
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
                id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL
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
    use crate::remote_sync_logs::RemoteSyncLogStore;

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
}
