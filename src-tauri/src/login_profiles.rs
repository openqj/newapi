use crate::Store;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoginProfile {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) username: String,
    #[serde(default)]
    pub(crate) email: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoginProfileRequest {
    pub(crate) id: Option<String>,
    pub(crate) name: String,
    pub(crate) username: String,
    #[serde(default)]
    pub(crate) email: String,
    pub(crate) password: String,
}

pub(crate) trait LoginProfileStore {
    fn list_login_profiles(&self) -> Result<Vec<LoginProfile>, String>;
    fn save_login_profile(&self, profile: &LoginProfile) -> Result<(), String>;
    fn delete_login_profile(&self, id: &str) -> Result<(), String>;
}

impl LoginProfileStore for Store {
    fn list_login_profiles(&self) -> Result<Vec<LoginProfile>, String> {
        let mut statement = self
            .connection
            .prepare("SELECT id,name,username,email FROM login_profiles ORDER BY name")
            .map_err(|error| error.to_string())?;
        let profiles = statement
            .query_map([], |row| {
                Ok(LoginProfile {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    username: row.get(2)?,
                    email: row.get(3)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(profiles)
    }

    fn save_login_profile(&self, profile: &LoginProfile) -> Result<(), String> {
        self.connection
            .execute(
                "INSERT OR REPLACE INTO login_profiles (id,name,username,email) VALUES (?1,?2,?3,?4)",
                params![profile.id, profile.name, profile.username, profile.email],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    fn delete_login_profile(&self, id: &str) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM login_profiles WHERE id=?1", [id])
            .map_err(|error| error.to_string())?;
        Ok(())
    }
}
