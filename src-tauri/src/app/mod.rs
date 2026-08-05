use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use reqwest::Client;
use tauri::Emitter;

use crate::{models::SyncProgress, services::gateway::GatewayController, store::Store};

mod runtime;

pub(crate) use runtime::run;

pub(crate) const STATIONS_CHANGED_EVENT: &str = "relayhub:stations-changed";

pub(crate) struct AppState {
    pub(crate) app_handle: tauri::AppHandle<tauri::Wry>,
    pub(crate) store: Arc<Mutex<Store>>,
    pub(crate) client: Client,
    pub(crate) gateway: GatewayController,
    pub(crate) auth_backoff: Mutex<HashMap<String, AuthBackoff>>,
    pub(crate) refresh_locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    pub(crate) remote_operations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub(crate) sync_operations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub(crate) sync_progress: Mutex<HashMap<String, SyncProgress>>,
}

impl AppState {
    pub(crate) fn emit_stations_changed(&self) {
        let _ = self.app_handle.emit(STATIONS_CHANGED_EVENT, ());
    }
}

pub(crate) struct RemoteOperationGuard {
    pub(crate) id: String,
    pub(crate) operations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    pub(crate) cancelled: Arc<AtomicBool>,
}

impl Drop for RemoteOperationGuard {
    fn drop(&mut self) {
        if let Ok(mut operations) = self.operations.lock() {
            operations.remove(&self.id);
        }
    }
}

impl RemoteOperationGuard {
    pub(crate) fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Relaxed)
    }
}

pub(crate) struct AuthBackoff {
    pub(crate) attempts: u8,
    pub(crate) retry_after: i64,
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Mutex,
        },
    };

    use super::RemoteOperationGuard;
    use crate::services::remote::ensure_active;

    #[test]
    fn remote_operation_guard_releases_and_honors_cancellation() {
        let operations = Arc::new(Mutex::new(HashMap::new()));
        let cancelled = Arc::new(AtomicBool::new(false));
        operations
            .lock()
            .unwrap()
            .insert("server-1".into(), cancelled.clone());
        let guard = RemoteOperationGuard {
            id: "server-1".into(),
            operations: operations.clone(),
            cancelled,
        };
        assert!(ensure_active(Some(&guard)).is_ok());
        guard.cancelled.store(true, Ordering::Relaxed);
        assert_eq!(ensure_active(Some(&guard)).unwrap_err(), "操作已取消");
        drop(guard);
        assert!(!operations.lock().unwrap().contains_key("server-1"));
    }
}
