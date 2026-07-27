use crate::{support::now, Store};
use rusqlite::params;

pub(crate) trait AuditStore {
    fn record_audit(&self, station_id: &str, action: &str, outcome: &str, detail: &str) -> Result<(), String>;
}

impl AuditStore for Store {
    fn record_audit(&self, station_id: &str, action: &str, outcome: &str, detail: &str) -> Result<(), String> {
        self.connection.execute("INSERT INTO audit_events (station_id,action,outcome,detail,created_at) VALUES (?1,?2,?3,?4,?5)", params![station_id, action, outcome, detail, now()]).map_err(|error| error.to_string())?;
        Ok(())
    }
}
