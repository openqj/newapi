use rusqlite::params;
#[cfg(test)]
use rusqlite::Row;
use serde::{Deserialize, Serialize};

use crate::Store;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotificationPreferences {
    pub(crate) desktop_enabled: bool,
    pub(crate) sync_enabled: bool,
    pub(crate) alert_enabled: bool,
    pub(crate) offer_enabled: bool,
}

impl Default for NotificationPreferences {
    fn default() -> Self {
        Self {
            desktop_enabled: true,
            sync_enabled: true,
            alert_enabled: true,
            offer_enabled: true,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MembershipAccess {
    pub(crate) station_id: String,
    pub(crate) account_id: String,
    pub(crate) user_email: String,
    pub(crate) plan: String,
    pub(crate) access_level: String,
    pub(crate) enabled: bool,
    pub(crate) expires_at: Option<i64>,
    pub(crate) privileges: Vec<String>,
    pub(crate) updated_at: i64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersonalCenterAuditEntry {
    pub(crate) id: i64,
    pub(crate) action: String,
    pub(crate) subject: String,
    pub(crate) detail: String,
    pub(crate) created_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersonalCenterNotification {
    pub(crate) id: String,
    pub(crate) audience: String,
    pub(crate) target_email: Option<String>,
    pub(crate) kind: String,
    pub(crate) title: String,
    pub(crate) body: String,
    pub(crate) destination: String,
    pub(crate) published_at: i64,
    pub(crate) expires_at: Option<i64>,
    pub(crate) revoked_at: Option<i64>,
    pub(crate) delivered_at: Option<i64>,
    pub(crate) read_at: Option<i64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishNotificationRequest {
    pub(crate) audience: String,
    pub(crate) target_email: Option<String>,
    pub(crate) kind: String,
    pub(crate) title: String,
    pub(crate) body: String,
    pub(crate) destination: String,
    pub(crate) expires_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersonalCenterLoginEvent {
    pub(crate) id: i64,
    pub(crate) email: String,
    pub(crate) ip_address: Option<String>,
    pub(crate) user_agent: Option<String>,
    pub(crate) outcome: String,
    pub(crate) failure_reason: Option<String>,
    pub(crate) created_at: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersonalCenterRealtimeSession {
    pub(crate) url: String,
    pub(crate) anon_key: String,
    pub(crate) access_token: String,
    pub(crate) user_id: String,
    pub(crate) is_admin: bool,
    pub(crate) is_anonymous: bool,
    pub(crate) expires_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MerchantProfile {
    pub(crate) merchant_name: String,
    pub(crate) description: Option<String>,
    pub(crate) qq: Option<String>,
    pub(crate) qq_link: Option<String>,
    pub(crate) wechat_qr_url: Option<String>,
    pub(crate) tier: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MerchantRateShare {
    pub(crate) id: String,
    pub(crate) merchant_name: String,
    pub(crate) description: Option<String>,
    pub(crate) station_name: String,
    pub(crate) station_url: String,
    pub(crate) group_name: String,
    pub(crate) multiplier_summary: String,
    pub(crate) qq: Option<String>,
    pub(crate) qq_link: Option<String>,
    pub(crate) wechat_qr_url: Option<String>,
    pub(crate) tier: Option<String>,
    pub(crate) pinned: bool,
    pub(crate) published_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PublishMerchantRateRequest {
    pub(crate) station_name: String,
    pub(crate) station_url: String,
    pub(crate) group_name: String,
    pub(crate) multiplier_summary: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MerchantFreeCodeInput {
    pub(crate) station_name: String,
    pub(crate) station_url: String,
    pub(crate) redeem_code: String,
    pub(crate) quota: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MerchantFreeOffer {
    pub(crate) id: String,
    pub(crate) merchant_name: String,
    pub(crate) description: Option<String>,
    pub(crate) station_name: String,
    pub(crate) station_url: String,
    pub(crate) quota: f64,
    pub(crate) pinned: bool,
    pub(crate) tier: Option<String>,
    pub(crate) published_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminMerchantProfile {
    pub(crate) user_id: String,
    pub(crate) merchant_name: String,
    pub(crate) description: Option<String>,
    pub(crate) qq: Option<String>,
    pub(crate) qq_link: Option<String>,
    pub(crate) wechat_qr_url: Option<String>,
    pub(crate) tier: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminMerchantProfileInput {
    pub(crate) user_id: String,
    pub(crate) merchant_name: String,
    pub(crate) description: Option<String>,
    pub(crate) qq: Option<String>,
    pub(crate) qq_link: Option<String>,
    pub(crate) wechat_qr_url: Option<String>,
    pub(crate) tier: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminMerchantRateShare {
    pub(crate) id: String,
    pub(crate) merchant_id: String,
    pub(crate) merchant_name: String,
    pub(crate) station_name: String,
    pub(crate) station_url: String,
    pub(crate) group_name: String,
    pub(crate) multiplier_summary: String,
    pub(crate) pinned: bool,
    pub(crate) published_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminMerchantRateShareInput {
    pub(crate) id: Option<String>,
    pub(crate) merchant_id: String,
    pub(crate) station_name: String,
    pub(crate) station_url: String,
    pub(crate) group_name: String,
    pub(crate) multiplier_summary: String,
    pub(crate) pinned: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminMerchantFreeCode {
    pub(crate) id: String,
    pub(crate) merchant_id: String,
    pub(crate) merchant_name: String,
    pub(crate) station_name: String,
    pub(crate) station_url: String,
    pub(crate) redeem_code: String,
    pub(crate) quota: f64,
    pub(crate) pinned: bool,
    pub(crate) claimed: bool,
    pub(crate) created_at: i64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AdminMerchantFreeCodeInput {
    pub(crate) id: Option<String>,
    pub(crate) merchant_id: String,
    pub(crate) station_name: String,
    pub(crate) station_url: String,
    pub(crate) redeem_code: String,
    pub(crate) quota: f64,
    pub(crate) pinned: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ClaimedMerchantCode {
    pub(crate) id: String,
    pub(crate) station_name: String,
    pub(crate) station_url: String,
    pub(crate) redeem_code: String,
}

#[cfg(test)]
fn membership(row: &Row<'_>) -> rusqlite::Result<MembershipAccess> {
    let privileges: String = row.get(7)?;
    Ok(MembershipAccess {
        station_id: row.get(0)?,
        account_id: row.get(1)?,
        user_email: row.get(2)?,
        plan: row.get(3)?,
        access_level: row.get(4)?,
        enabled: row.get::<_, i64>(5)? != 0,
        expires_at: row.get(6)?,
        privileges: serde_json::from_str(&privileges).unwrap_or_default(),
        updated_at: row.get(8)?,
    })
}

pub(crate) trait PersonalCenterStore {
    fn notification_preferences(&self) -> Result<NotificationPreferences, String>;
    fn save_notification_preferences(
        &self,
        preferences: &NotificationPreferences,
    ) -> Result<(), String>;
    #[cfg(test)]
    fn list_memberships(&self) -> Result<Vec<MembershipAccess>, String>;
    fn save_membership(&self, membership: &MembershipAccess) -> Result<(), String>;
    fn delete_membership(&self, station_id: &str, account_id: &str) -> Result<bool, String>;
}

impl PersonalCenterStore for Store {
    fn notification_preferences(&self) -> Result<NotificationPreferences, String> {
        let value = self.connection.query_row(
            "SELECT value FROM app_settings WHERE key='personalCenterNotificationPreferences'",
            [],
            |row| row.get::<_, String>(0),
        );
        match value {
            Ok(value) => serde_json::from_str(&value).map_err(|error| error.to_string()),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(NotificationPreferences::default()),
            Err(error) => Err(error.to_string()),
        }
    }

    fn save_notification_preferences(
        &self,
        preferences: &NotificationPreferences,
    ) -> Result<(), String> {
        let value = serde_json::to_string(preferences).map_err(|error| error.to_string())?;
        self.connection.execute(
            "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('personalCenterNotificationPreferences', ?1)",
            [value],
        ).map_err(|error| error.to_string())?;
        Ok(())
    }

    #[cfg(test)]
    fn list_memberships(&self) -> Result<Vec<MembershipAccess>, String> {
        let mut statement = self.connection.prepare(
            "SELECT station_id,account_id,user_email,plan,access_level,enabled,expires_at,privileges,updated_at
             FROM personal_center_memberships ORDER BY updated_at DESC, station_id, account_id",
        ).map_err(|error| error.to_string())?;
        let memberships = statement
            .query_map([], membership)
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(memberships)
    }

    fn save_membership(&self, membership: &MembershipAccess) -> Result<(), String> {
        let privileges =
            serde_json::to_string(&membership.privileges).map_err(|error| error.to_string())?;
        self.connection.execute(
            "INSERT INTO personal_center_memberships (station_id,account_id,user_email,plan,access_level,enabled,expires_at,privileges,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)
             ON CONFLICT(station_id,account_id) DO UPDATE SET user_email=excluded.user_email,plan=excluded.plan,access_level=excluded.access_level,
                enabled=excluded.enabled,expires_at=excluded.expires_at,privileges=excluded.privileges,updated_at=excluded.updated_at",
            params![membership.station_id, membership.account_id, membership.user_email, membership.plan, membership.access_level,
                i64::from(membership.enabled), membership.expires_at, privileges, membership.updated_at],
        ).map_err(|error| error.to_string())?;
        Ok(())
    }

    fn delete_membership(&self, station_id: &str, account_id: &str) -> Result<bool, String> {
        self.connection
            .execute(
                "DELETE FROM personal_center_memberships WHERE station_id=?1 AND account_id=?2",
                params![station_id, account_id],
            )
            .map(|count| count > 0)
            .map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{MembershipAccess, PersonalCenterStore};
    use crate::Store;

    #[test]
    fn membership_round_trip_keeps_account_scope_and_privileges() {
        let database =
            tempfile::NamedTempFile::new().expect("temporary database should be created");
        let store = Store::open(database.path().to_path_buf()).expect("database should open");
        let membership = MembershipAccess {
            station_id: "station-1".into(),
            account_id: "account-1".into(),
            user_email: "user@example.com".into(),
            plan: "pro".into(),
            access_level: "manager".into(),
            enabled: true,
            expires_at: Some(42),
            privileges: vec!["usage".into(), "members".into()],
            updated_at: 9,
        };
        store
            .save_membership(&membership)
            .expect("membership should save");
        assert_eq!(
            store.list_memberships().expect("memberships should list"),
            vec![membership]
        );
    }
}
