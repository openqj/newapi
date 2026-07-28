use crate::support::now;
use crate::{RemoteSyncLog, Store};
use rusqlite::params;

pub(crate) trait RemoteSyncLogStore {
    fn add_remote_sync_log(
        &self,
        server_id: &str,
        status: &str,
        action: &str,
        summary: &str,
        config_fingerprint: Option<&str>,
    ) -> Result<(), String>;
    fn list_remote_sync_logs(&self, server_id: &str) -> Result<Vec<RemoteSyncLog>, String>;
}

impl RemoteSyncLogStore for Store {
    fn add_remote_sync_log(
        &self,
        server_id: &str,
        status: &str,
        action: &str,
        summary: &str,
        config_fingerprint: Option<&str>,
    ) -> Result<(), String> {
        self.connection.execute("INSERT INTO remote_sync_logs (server_id,status,action,summary,config_fingerprint,created_at) VALUES (?1,?2,?3,?4,?5,?6)", params![server_id, status, action, summary, config_fingerprint, now()]).map_err(|error| error.to_string())?;
        Ok(())
    }

    fn list_remote_sync_logs(&self, server_id: &str) -> Result<Vec<RemoteSyncLog>, String> {
        let mut statement = self.connection.prepare("SELECT id,server_id,status,action,summary,config_fingerprint,created_at FROM remote_sync_logs WHERE server_id=?1 ORDER BY id DESC LIMIT 30").map_err(|error| error.to_string())?;
        let logs = statement
            .query_map([server_id], |row| {
                Ok(RemoteSyncLog {
                    id: row.get(0)?,
                    server_id: row.get(1)?,
                    status: row.get(2)?,
                    action: row.get(3)?,
                    summary: row.get(4)?,
                    config_fingerprint: row.get(5)?,
                    created_at: row.get(6)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(logs)
    }
}
