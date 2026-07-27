use crate::{RemoteServer, Store};
use rusqlite::{params, Row};

const REMOTE_SERVER_COLUMNS: &str = "id,name,host,port,username,auth_type,private_key_path,codex_version,codex_latest_version,codex_update_available,host_key_fingerprint,relay_url,relay_provider,relay_key_source,relay_key_masked,relay_config_fingerprint,connection_status,connection_error,last_synced_at,last_sync_status,last_sync_error,updated_at";

fn remote_server(row: &Row<'_>) -> rusqlite::Result<RemoteServer> {
    Ok(RemoteServer {
        id: row.get(0)?, name: row.get(1)?, host: row.get(2)?, port: row.get(3)?, username: row.get(4)?, auth_type: row.get(5)?, private_key_path: row.get(6)?, codex_version: row.get(7)?, codex_latest_version: row.get(8)?, codex_update_available: row.get(9)?, host_key_fingerprint: row.get(10)?,
        relay_url: row.get(11)?, relay_provider: row.get(12)?, relay_key_source: row.get(13)?, relay_key_masked: row.get(14)?, relay_config_fingerprint: row.get(15)?, connection_status: row.get(16)?, connection_error: row.get(17)?, last_synced_at: row.get(18)?, last_sync_status: row.get(19)?, last_sync_error: row.get(20)?, updated_at: row.get(21)?,
    })
}

pub(crate) trait RemoteServerStore {
    fn list_remote_servers(&self) -> Result<Vec<RemoteServer>, String>;
    fn get_remote_server(&self, id: &str) -> Result<RemoteServer, String>;
    fn save_remote_server(&self, server: &RemoteServer) -> Result<(), String>;
    fn delete_remote_server(&self, id: &str) -> Result<(), String>;
}

impl RemoteServerStore for Store {
    fn list_remote_servers(&self) -> Result<Vec<RemoteServer>, String> {
        let mut statement = self.connection.prepare(&format!("SELECT {REMOTE_SERVER_COLUMNS} FROM remote_servers ORDER BY name")).map_err(|error| error.to_string())?;
        let servers = statement.query_map([], remote_server).map_err(|error| error.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
        Ok(servers)
    }

    fn get_remote_server(&self, id: &str) -> Result<RemoteServer, String> {
        self.connection.query_row(&format!("SELECT {REMOTE_SERVER_COLUMNS} FROM remote_servers WHERE id=?1"), [id], remote_server).map_err(|error| error.to_string())
    }

    fn save_remote_server(&self, server: &RemoteServer) -> Result<(), String> {
        self.connection.execute("INSERT OR REPLACE INTO remote_servers (id,name,host,port,username,auth_type,private_key_path,codex_version,codex_latest_version,codex_update_available,host_key_fingerprint,relay_url,relay_provider,relay_key_source,relay_key_masked,relay_config_fingerprint,connection_status,connection_error,last_synced_at,last_sync_status,last_sync_error,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22)", params![server.id, server.name, server.host, server.port, server.username, server.auth_type, server.private_key_path, server.codex_version, server.codex_latest_version, server.codex_update_available, server.host_key_fingerprint, server.relay_url, server.relay_provider, server.relay_key_source, server.relay_key_masked, server.relay_config_fingerprint, server.connection_status, server.connection_error, server.last_synced_at, server.last_sync_status, server.last_sync_error, server.updated_at]).map_err(|error| error.to_string())?;
        Ok(())
    }

    fn delete_remote_server(&self, id: &str) -> Result<(), String> {
        self.connection.execute("DELETE FROM remote_servers WHERE id=?1", [id]).map_err(|error| error.to_string())?;
        self.connection.execute("DELETE FROM remote_sync_logs WHERE server_id=?1", [id]).map_err(|error| error.to_string())?;
        Ok(())
    }
}
