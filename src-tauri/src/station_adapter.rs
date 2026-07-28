use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Station {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) base_url: String,
    pub(crate) kind: String,
    pub(crate) status: String,
    pub(crate) last_synced_at: Option<i64>,
    pub(crate) last_error: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum StationAdapter {
    Sub2Api,
    NewApi,
}

#[derive(Clone, Copy)]
pub(crate) enum PagedResource {
    Keys,
    Usage,
}

#[derive(Clone, Debug, Deserialize, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StationCapabilities {
    pub(crate) key_update: String,
    pub(crate) supports_custom_key: bool,
    pub(crate) supports_ip_blacklist: bool,
    pub(crate) supports_rate_limits: bool,
    pub(crate) supports_key_reveal: bool,
}

impl StationAdapter {
    pub(crate) fn for_station(station: &Station) -> Result<Self, String> {
        match station.kind.as_str() {
            "sub2api" => Ok(Self::Sub2Api),
            "newapi" => Ok(Self::NewApi),
            _ => Err("不支持的站点类型".into()),
        }
    }

    pub(crate) fn login_path(self) -> &'static str {
        match self {
            Self::Sub2Api => "/api/v1/auth/login",
            Self::NewApi => "/api/user/login",
        }
    }

    pub(crate) fn login_2fa_path(self) -> &'static str {
        match self {
            Self::Sub2Api => "/api/v1/auth/login/2fa",
            Self::NewApi => "/api/user/login/2fa",
        }
    }

    pub(crate) fn login_body(self, username: &str, password: &str) -> Value {
        match self {
            Self::Sub2Api => json!({"email": username, "password": password}),
            Self::NewApi => json!({"username": username, "password": password}),
        }
    }

    pub(crate) fn profile_path(self) -> &'static str {
        match self {
            Self::Sub2Api => "/api/v1/user/profile",
            Self::NewApi => "/api/user/self",
        }
    }

    pub(crate) fn paged_path(self, resource: PagedResource, page: i64, page_size: i64) -> String {
        match (self, resource) {
            (Self::Sub2Api, PagedResource::Keys) => {
                format!("/api/v1/keys?page={page}&page_size={page_size}")
            }
            (Self::Sub2Api, PagedResource::Usage) => {
                format!("/api/v1/usage?page={page}&page_size={page_size}")
            }
            (Self::NewApi, PagedResource::Keys) => format!("/api/token/?p={page}&size={page_size}"),
            (Self::NewApi, PagedResource::Usage) => {
                format!("/api/log/self?p={page}&page_size={page_size}")
            }
        }
    }

    pub(crate) fn first_page(self) -> i64 {
        match self {
            Self::Sub2Api => 1,
            Self::NewApi => 0,
        }
    }

    pub(crate) fn capabilities(self) -> StationCapabilities {
        match self {
            Self::Sub2Api => StationCapabilities {
                key_update: "patch_with_put_fallback".into(),
                supports_custom_key: true,
                supports_ip_blacklist: true,
                supports_rate_limits: true,
                supports_key_reveal: true,
            },
            Self::NewApi => StationCapabilities {
                key_update: "full_put_and_status_put".into(),
                supports_custom_key: false,
                supports_ip_blacklist: false,
                supports_rate_limits: false,
                supports_key_reveal: true,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{PagedResource, StationAdapter};

    #[test]
    fn builds_source_specific_login_fields() {
        let sub2 = StationAdapter::Sub2Api.login_body("user@example.com", "secret");
        let newapi = StationAdapter::NewApi.login_body("KitQQ", "secret");
        assert_eq!(sub2["email"], "user@example.com");
        assert!(sub2.get("username").is_none());
        assert_eq!(newapi["username"], "KitQQ");
    }

    #[test]
    fn builds_actual_pagination_paths_for_each_adapter() {
        assert_eq!(
            StationAdapter::Sub2Api.paged_path(PagedResource::Keys, 1, 100),
            "/api/v1/keys?page=1&page_size=100"
        );
        assert_eq!(
            StationAdapter::NewApi.paged_path(PagedResource::Usage, 0, 100),
            "/api/log/self?p=0&page_size=100"
        );
    }
}
