use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
}

pub(crate) fn base(url: &str) -> String {
    url.trim_end_matches('/').to_string()
}

pub(crate) fn api_base_url(url: &str) -> String {
    let root = base(url);
    if root.ends_with("/v1") { root } else { format!("{root}/v1") }
}
