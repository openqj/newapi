use crate::Store;

pub(crate) trait SettingsStore {
    fn setting(&self, key: &str) -> Result<Option<String>, String>;
    fn save_setting(&self, key: &str, value: &str) -> Result<(), String>;
}

impl SettingsStore for Store {
    fn setting(&self, key: &str) -> Result<Option<String>, String> {
        match self.connection.query_row(
            "SELECT value FROM app_settings WHERE key=?1",
            [key],
            |row| row.get(0),
        ) {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn save_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.connection
            .execute(
                "INSERT OR REPLACE INTO app_settings (key,value) VALUES (?1,?2)",
                rusqlite::params![key, value],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}
