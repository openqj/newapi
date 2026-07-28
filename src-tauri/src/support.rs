use std::time::{SystemTime, UNIX_EPOCH};
use url::Url;

pub(crate) fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

pub(crate) fn base(url: &str) -> String {
    url.trim_end_matches('/').to_string()
}

pub(crate) fn station_base(url: &str) -> String {
    Url::parse(url)
        .map(|parsed| parsed.origin().ascii_serialization())
        .unwrap_or_else(|_| base(url))
}

pub(crate) fn api_base_url(url: &str) -> String {
    let root = base(url);
    if root.ends_with("/v1") {
        root
    } else {
        format!("{root}/v1")
    }
}

#[cfg(test)]
mod tests {
    use super::station_base;

    #[test]
    fn station_base_discards_login_page_paths() {
        assert_eq!(
            station_base("https://chat.178266.xyz/login"),
            "https://chat.178266.xyz"
        );
    }
}
