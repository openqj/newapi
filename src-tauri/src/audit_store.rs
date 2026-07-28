use crate::{support::now, AuditEvent, Store};
use rusqlite::{params, OptionalExtension, Row};
use serde_json::Value;

pub(crate) trait AuditStore {
    fn record_audit(
        &self,
        station_id: &str,
        action: &str,
        outcome: &str,
        detail: &str,
    ) -> Result<(), String>;
    fn record_audit_with_payload(
        &self,
        station_id: &str,
        action: &str,
        outcome: &str,
        detail: &str,
        payload: &Value,
    ) -> Result<(), String>;
    fn list_audit_events(
        &self,
        scope: Option<&str>,
        limit: usize,
    ) -> Result<Vec<AuditEvent>, String>;
    fn audit_event(&self, id: i64) -> Result<Option<AuditEvent>, String>;
}

fn audit_event(row: &Row<'_>) -> rusqlite::Result<AuditEvent> {
    let payload = row.get::<_, Option<String>>(5)?.map(|value| {
        serde_json::from_str(&value)
            .unwrap_or_else(|_| Value::String("Invalid audit payload".into()))
    });
    Ok(AuditEvent {
        id: row.get(0)?,
        station_id: row.get(1)?,
        action: row.get(2)?,
        outcome: row.get(3)?,
        detail: row.get(4)?,
        payload,
        created_at: row.get(6)?,
    })
}

impl AuditStore for Store {
    fn record_audit(
        &self,
        station_id: &str,
        action: &str,
        outcome: &str,
        detail: &str,
    ) -> Result<(), String> {
        self.connection.execute("INSERT INTO audit_events (station_id,action,outcome,detail,created_at) VALUES (?1,?2,?3,?4,?5)", params![station_id, action, outcome, detail, now()]).map_err(|error| error.to_string())?;
        Ok(())
    }

    fn record_audit_with_payload(
        &self,
        station_id: &str,
        action: &str,
        outcome: &str,
        detail: &str,
        payload: &Value,
    ) -> Result<(), String> {
        let payload = serde_json::to_string(payload).map_err(|error| error.to_string())?;
        self.connection.execute("INSERT INTO audit_events (station_id,action,outcome,detail,payload,created_at) VALUES (?1,?2,?3,?4,?5,?6)", params![station_id, action, outcome, detail, payload, now()]).map_err(|error| error.to_string())?;
        Ok(())
    }

    fn list_audit_events(
        &self,
        scope: Option<&str>,
        limit: usize,
    ) -> Result<Vec<AuditEvent>, String> {
        let limit = i64::try_from(limit.clamp(1, 200))
            .map_err(|_| "Invalid audit event limit".to_string())?;
        let sql = "SELECT id,station_id,action,outcome,detail,payload,created_at FROM audit_events WHERE (?1 IS NULL OR station_id=?1) ORDER BY id DESC LIMIT ?2";
        self.connection
            .prepare(sql)
            .map_err(|error| error.to_string())?
            .query_map(params![scope, limit], audit_event)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())
    }

    fn audit_event(&self, id: i64) -> Result<Option<AuditEvent>, String> {
        self.connection.query_row("SELECT id,station_id,action,outcome,detail,payload,created_at FROM audit_events WHERE id=?1", [id], audit_event)
            .optional().map_err(|error| error.to_string())
    }
}
