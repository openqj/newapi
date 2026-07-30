use std::collections::BTreeSet;

use crate::support::now;
use crate::{Store, UsageLog};
use rusqlite::params;

const MAX_CACHED_USAGE_LOGS_PER_STATION: usize = 5_000;

pub(crate) trait UsageStore {
    fn cache_usage_logs(&mut self, logs: &[UsageLog]) -> Result<(), String>;
    fn cached_usage_logs(&self, station_id: &str) -> Result<Vec<UsageLog>, String>;
}

impl UsageStore for Store {
    fn cache_usage_logs(&mut self, logs: &[UsageLog]) -> Result<(), String> {
        let transaction = self
            .connection
            .transaction()
            .map_err(|error| error.to_string())?;
        let station_ids = logs
            .iter()
            .map(|log| log.station_id.as_str())
            .collect::<BTreeSet<_>>();
        for log in logs {
            transaction.execute("INSERT OR REPLACE INTO usage_log_cache (station_id,log_id,payload,created_at) VALUES (?1,?2,?3,?4)", params![log.station_id, log.id, serde_json::to_string(log).map_err(|error| error.to_string())?, now()]).map_err(|error| error.to_string())?;
        }
        for station_id in station_ids {
            transaction.execute(
                "DELETE FROM usage_log_cache WHERE rowid IN (SELECT rowid FROM usage_log_cache WHERE station_id = ?1 ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?2)",
                params![station_id, MAX_CACHED_USAGE_LOGS_PER_STATION as i64],
            ).map_err(|error| error.to_string())?;
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    fn cached_usage_logs(&self, station_id: &str) -> Result<Vec<UsageLog>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT payload FROM usage_log_cache WHERE station_id=?1 ORDER BY created_at DESC, rowid DESC LIMIT ?2",
            )
            .map_err(|error| error.to_string())?;
        let logs = statement
            .query_map(
                params![station_id, MAX_CACHED_USAGE_LOGS_PER_STATION as i64],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| error.to_string())?
            .map(|row| {
                serde_json::from_str::<UsageLog>(&row.map_err(|error| error.to_string())?)
                    .map_err(|error| error.to_string())
            })
            .collect();
        logs
    }
}
