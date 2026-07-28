use rusqlite::{params, OptionalExtension, Row};

use crate::Store;

#[derive(Clone, Debug)]
pub(crate) struct AlertEventRecord {
    pub(crate) id: i64,
    pub(crate) alert_id: String,
    pub(crate) station_id: String,
    pub(crate) station_name: String,
    pub(crate) severity: String,
    pub(crate) title: String,
    pub(crate) detail: String,
    pub(crate) status: String,
    pub(crate) occurred_at: i64,
}

#[derive(Clone, Debug)]
pub(crate) struct ActiveAlertRecord {
    pub(crate) alert_id: String,
    pub(crate) station_id: String,
    pub(crate) station_name: String,
    pub(crate) severity: String,
    pub(crate) title: String,
    pub(crate) detail: String,
}

pub(crate) trait AlertStore {
    fn record_alert_evaluation(&self, active: &[ActiveAlertRecord], now: i64)
        -> Result<(), String>;
    fn list_alert_events(&self, limit: usize) -> Result<Vec<AlertEventRecord>, String>;
}

fn event(row: &Row<'_>) -> rusqlite::Result<AlertEventRecord> {
    Ok(AlertEventRecord {
        id: row.get(0)?,
        alert_id: row.get(1)?,
        station_id: row.get(2)?,
        station_name: row.get(3)?,
        severity: row.get(4)?,
        title: row.get(5)?,
        detail: row.get(6)?,
        status: row.get(7)?,
        occurred_at: row.get(8)?,
    })
}

impl AlertStore for Store {
    fn record_alert_evaluation(
        &self,
        active: &[ActiveAlertRecord],
        now: i64,
    ) -> Result<(), String> {
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(|error| error.to_string())?;
        for item in active {
            let prior_status = transaction
                .query_row(
                    "SELECT status FROM alert_states WHERE alert_id=?1",
                    [&item.alert_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            if prior_status.as_deref() != Some("active") {
                transaction.execute(
                    "INSERT INTO alert_events (alert_id,station_id,station_name,severity,title,detail,status,occurred_at) VALUES (?1,?2,?3,?4,?5,?6,'active',?7)",
                    params![item.alert_id, item.station_id, item.station_name, item.severity, item.title, item.detail, now],
                ).map_err(|error| error.to_string())?;
            }
            transaction.execute(
                "INSERT INTO alert_states (alert_id,station_id,station_name,severity,title,detail,status,updated_at) VALUES (?1,?2,?3,?4,?5,?6,'active',?7) ON CONFLICT(alert_id) DO UPDATE SET station_id=excluded.station_id,station_name=excluded.station_name,severity=excluded.severity,title=excluded.title,detail=excluded.detail,status='active',updated_at=excluded.updated_at",
                params![item.alert_id, item.station_id, item.station_name, item.severity, item.title, item.detail, now],
            ).map_err(|error| error.to_string())?;
        }
        let mut stale = transaction.prepare("SELECT alert_id,station_id,station_name,severity,title,detail FROM alert_states WHERE status='active'").map_err(|error| error.to_string())?;
        let prior = stale
            .query_map([], |row| {
                Ok(ActiveAlertRecord {
                    alert_id: row.get(0)?,
                    station_id: row.get(1)?,
                    station_name: row.get(2)?,
                    severity: row.get(3)?,
                    title: row.get(4)?,
                    detail: row.get(5)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        drop(stale);
        let active_ids = active
            .iter()
            .map(|item| item.alert_id.as_str())
            .collect::<std::collections::HashSet<_>>();
        for item in prior
            .into_iter()
            .filter(|item| !active_ids.contains(item.alert_id.as_str()))
        {
            transaction.execute(
                "INSERT INTO alert_events (alert_id,station_id,station_name,severity,title,detail,status,occurred_at) VALUES (?1,?2,?3,?4,?5,?6,'resolved',?7)",
                params![item.alert_id, item.station_id, item.station_name, item.severity, item.title, item.detail, now],
            ).map_err(|error| error.to_string())?;
            transaction
                .execute(
                    "UPDATE alert_states SET status='resolved',updated_at=?2 WHERE alert_id=?1",
                    params![item.alert_id, now],
                )
                .map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    fn list_alert_events(&self, limit: usize) -> Result<Vec<AlertEventRecord>, String> {
        let limit = i64::try_from(limit.clamp(1, 200))
            .map_err(|_| "Invalid alert event limit".to_string())?;
        self.connection.prepare("SELECT id,alert_id,station_id,station_name,severity,title,detail,status,occurred_at FROM alert_events ORDER BY id DESC LIMIT ?1")
            .map_err(|error| error.to_string())?
            .query_map([limit], event).map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{ActiveAlertRecord, AlertStore};
    use crate::Store;

    fn active() -> ActiveAlertRecord {
        ActiveAlertRecord {
            alert_id: "low-balance:station-1".into(),
            station_id: "station-1".into(),
            station_name: "Station 1".into(),
            severity: "warning".into(),
            title: "Low balance".into(),
            detail: "Balance is low".into(),
        }
    }

    #[test]
    fn records_only_alert_state_transitions() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let store = Store::open(file.path().to_path_buf()).unwrap();
        store.record_alert_evaluation(&[active()], 100).unwrap();
        store.record_alert_evaluation(&[active()], 150).unwrap();
        store.record_alert_evaluation(&[], 200).unwrap();
        store.record_alert_evaluation(&[], 250).unwrap();
        store.record_alert_evaluation(&[active()], 300).unwrap();
        let events = store.list_alert_events(10).unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(events[0].status, "active");
        assert_eq!(events[0].occurred_at, 300);
        assert_eq!(events[1].status, "resolved");
        assert_eq!(events[1].occurred_at, 200);
        assert_eq!(events[2].status, "active");
        assert_eq!(events[2].occurred_at, 100);
    }
}
