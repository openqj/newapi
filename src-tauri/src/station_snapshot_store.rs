use crate::{StationSnapshot, Store};
use crate::support::now;
use rusqlite::params;
use serde_json::{json, Value};

pub(crate) trait StationSnapshotStore {
    fn load_snapshot(&self, id: &str) -> Result<Option<(String, StationSnapshot)>, String>;
    fn save_snapshot(&self, id: &str, fingerprint: &str, snapshot: &StationSnapshot, changes: &[String]) -> Result<(), String>;
    fn history(&self, id: &str) -> Result<Vec<Value>, String>;
}

impl StationSnapshotStore for Store {
    fn load_snapshot(&self, id: &str) -> Result<Option<(String, StationSnapshot)>, String> {
        let result = self.connection.query_row("SELECT fingerprint,payload FROM snapshots WHERE station_id=?1", [id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)));
        match result { Ok((fingerprint, payload)) => Ok(Some((fingerprint, serde_json::from_str(&payload).map_err(|error| error.to_string())?))), Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None), Err(error) => Err(error.to_string()) }
    }

    fn save_snapshot(&self, id: &str, fingerprint: &str, snapshot: &StationSnapshot, changes: &[String]) -> Result<(), String> {
        let timestamp = now();
        self.connection.execute("INSERT OR REPLACE INTO snapshots (station_id,fingerprint,payload,updated_at) VALUES (?1,?2,?3,?4)", params![id, fingerprint, serde_json::to_string(snapshot).map_err(|error| error.to_string())?, timestamp]).map_err(|error| error.to_string())?;
        for change in changes { self.connection.execute("INSERT INTO changes (station_id,summary,created_at) VALUES (?1,?2,?3)", params![id, change, timestamp]).map_err(|error| error.to_string())?; }
        Ok(())
    }

    fn history(&self, id: &str) -> Result<Vec<Value>, String> {
        let mut statement = self.connection.prepare("SELECT summary,created_at FROM changes WHERE station_id=?1 ORDER BY id DESC LIMIT 30").map_err(|error| error.to_string())?;
        let history = statement.query_map([id], |row| Ok(json!({"summary": row.get::<_, String>(0)?, "createdAt": row.get::<_, i64>(1)?}))).map_err(|error| error.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
        Ok(history)
    }
}
