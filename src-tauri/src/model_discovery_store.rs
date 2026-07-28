use rusqlite::params;

use crate::Store;

/// The model list is public metadata from a relay, but it is scoped to the API
/// key because relays commonly filter models by group or token permissions.
pub(crate) trait ModelDiscoveryStore {
    fn load_model_discovery_cache(
        &self,
        station_id: &str,
        key_id: &str,
    ) -> Result<Option<(Vec<String>, i64)>, String>;
    fn save_model_discovery_cache(
        &self,
        station_id: &str,
        key_id: &str,
        models: &[String],
        fetched_at: i64,
    ) -> Result<(), String>;
}

impl ModelDiscoveryStore for Store {
    fn load_model_discovery_cache(
        &self,
        station_id: &str,
        key_id: &str,
    ) -> Result<Option<(Vec<String>, i64)>, String> {
        let result = self.connection.query_row(
            "SELECT payload, fetched_at FROM model_discovery_cache WHERE station_id=?1 AND key_id=?2",
            params![station_id, key_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        );
        match result {
            Ok((payload, fetched_at)) => Ok(Some((
                serde_json::from_str(&payload).map_err(|error| error.to_string())?,
                fetched_at,
            ))),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn save_model_discovery_cache(
        &self,
        station_id: &str,
        key_id: &str,
        models: &[String],
        fetched_at: i64,
    ) -> Result<(), String> {
        self.connection
            .execute(
                "INSERT OR REPLACE INTO model_discovery_cache (station_id,key_id,payload,fetched_at) VALUES (?1,?2,?3,?4)",
                params![
                    station_id,
                    key_id,
                    serde_json::to_string(models).map_err(|error| error.to_string())?,
                    fetched_at,
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::ModelDiscoveryStore;
    use crate::Store;

    #[test]
    fn caches_models_per_station_and_key() {
        let directory = tempdir().unwrap();
        let store = Store::open(directory.path().join("relayhub.db")).unwrap();
        store
            .save_model_discovery_cache(
                "station-a",
                "key-a",
                &["gpt-4.1".into(), "claude-sonnet".into()],
                123,
            )
            .unwrap();

        assert_eq!(
            store
                .load_model_discovery_cache("station-a", "key-a")
                .unwrap(),
            Some((vec!["gpt-4.1".into(), "claude-sonnet".into()], 123))
        );
        assert_eq!(
            store
                .load_model_discovery_cache("station-a", "key-b")
                .unwrap(),
            None
        );
    }
}
