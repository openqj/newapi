use std::{fs, path::{Path, PathBuf}};

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
                detail TEXT NOT NULL, created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS usage_log_cache (
                station_id TEXT NOT NULL, log_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
                PRIMARY KEY (station_id, log_id)
             );
             CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY, value TEXT NOT NULL
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
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN port INTEGER NOT NULL DEFAULT 22", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN codex_version TEXT", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN codex_latest_version TEXT", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN codex_update_available INTEGER NOT NULL DEFAULT 0", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN host_key_fingerprint TEXT", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN relay_provider TEXT", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN relay_config_fingerprint TEXT", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'warning'", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN connection_error TEXT", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN last_synced_at INTEGER", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN last_sync_status TEXT", []);
        let _ = connection.execute("ALTER TABLE remote_servers ADD COLUMN last_sync_error TEXT", []);
        Ok(Self { connection, path })
    }

    pub(crate) fn checkpoint_and_copy(&self, destination: &Path) -> Result<(), String> {
        let _ = self.connection.execute_batch("PRAGMA wal_checkpoint(FULL)");
        fs::copy(&self.path, destination).map_err(|e| e.to_string())?;
        Ok(())
    }
}
