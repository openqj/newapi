use crate::{services::cloud_backup, AppState};

/// Cloud administrator checks protect shared Supabase control-plane operations.
/// Local desktop operations intentionally remain available without cloud login.
pub(crate) async fn require_cloud_admin(state: &AppState) -> Result<(), String> {
    if cloud_backup::is_verified_cloud_admin(state).await? {
        Ok(())
    } else {
        Err("Administrator permission is required for this operation".into())
    }
}
