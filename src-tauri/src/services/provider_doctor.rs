use std::time::Instant;

use reqwest::Method;
use serde_json::Value;

use crate::{
    models::{ProviderDoctorCheck, ProviderDoctorReport},
    services::stations::{
        data, load_authenticated_secret, parse_account, parse_balance, station_request,
        usage_from_profile,
    },
    services::{
        api_keys::read_api_key,
        detection::{discover_models, test_model},
    },
    station_adapter::{PagedResource, Station, StationAdapter},
    station_snapshot_store::StationSnapshotStore,
    AppState,
};

const PROFILE_REMEDIATION: &str = "请重新认证站点，并确认当前账户有查看个人资料的权限。";
const PAGING_REMEDIATION: &str =
    "请确认站点版本兼容、账户具备相应读取权限，并检查反向代理是否保留查询参数。";

pub(crate) async fn diagnose(
    state: &AppState,
    station: &Station,
    requested_key_id: Option<&str>,
) -> ProviderDoctorReport {
    let started = Instant::now();
    let adapter = match StationAdapter::for_station(station) {
        Ok(adapter) => adapter,
        Err(error) => {
            return report(
                station,
                "unknown",
                started,
                vec![failed(
                    "adapter",
                    "适配器",
                    error,
                    "请选择受支持的 New API 或 Sub2API 站点。",
                    0,
                )],
            );
        }
    };
    let mut checks = vec![capability_check(adapter)];
    let authentication_started = Instant::now();
    let mut secret = match load_authenticated_secret(state, station).await {
        Ok(secret) => {
            checks.push(ProviderDoctorCheck {
                id: "authentication".into(),
                name: "登录状态".into(),
                status: "pass".into(),
                detail: "已加载有效的本地凭据；必要时已自动刷新会话。".into(),
                remediation: None,
                elapsed_ms: authentication_started.elapsed().as_millis() as u64,
            });
            secret
        }
        Err(error) => {
            checks.push(failed(
                "authentication",
                "登录状态",
                error,
                PROFILE_REMEDIATION,
                authentication_started.elapsed().as_millis() as u64,
            ));
            checks.push(skipped(
                "profile",
                "站点资料与额度",
                "未执行：当前登录状态不可用。",
            ));
            checks.push(skipped(
                "keys_pagination",
                "API 密钥分页",
                "未执行：当前登录状态不可用。",
            ));
            checks.push(skipped(
                "usage_pagination",
                "用量分页",
                "未执行：当前登录状态不可用。",
            ));
            checks.push(skipped_with_remediation(
                "model_availability",
                "模型可用性",
                "未执行：当前登录状态不可用，无法读取保存的 API Key。",
                "请重新认证站点后再运行体检。",
            ));
            return report(station, adapter_name(adapter), started, checks);
        }
    };

    let profile_started = Instant::now();
    match station_request(
        state,
        station,
        &mut secret,
        Method::GET,
        adapter.profile_path(),
        None,
    )
    .await
    {
        Ok(profile) => {
            let account = parse_account(&profile);
            let has_identity = !account.id.is_empty()
                || !account.username.is_empty()
                || !account.display_name.is_empty();
            let balance = parse_balance(&profile);
            let usage = usage_from_profile(&profile);
            let has_usage = usage.today_input_tokens.is_some()
                || usage.today_output_tokens.is_some()
                || usage.today_requests.is_some()
                || usage.today_spent.is_some()
                || usage.total_spent.is_some();
            let detail = match (has_identity, balance, has_usage) {
                (true, Some(balance), true) => {
                    format!("资料已认证；余额/额度 {balance:.2}，并提供用量字段。")
                }
                (true, Some(balance), false) => {
                    format!("资料已认证；余额/额度 {balance:.2}，但资料接口未提供用量字段。")
                }
                (true, None, _) => "资料已认证；该资料接口未提供可解析的余额/额度。".into(),
                (false, _, _) => "资料端点可访问，但未返回可识别的账户标识。".into(),
            };
            checks.push(ProviderDoctorCheck {
                id: "profile".into(),
                name: "站点资料与额度".into(),
                status: if has_identity { "pass" } else { "warning" }.into(),
                detail,
                remediation: (!has_identity)
                    .then(|| "请检查站点返回格式是否仍与所选适配器兼容。".into()),
                elapsed_ms: profile_started.elapsed().as_millis() as u64,
            });
            if !has_usage {
                checks.push(ProviderDoctorCheck {
                    id: "profile_usage".into(),
                    name: "资料用量字段".into(),
                    status: "warning".into(),
                    detail: "资料端点未提供可解析的用量；将单独检查用量分页端点。".into(),
                    remediation: None,
                    elapsed_ms: 0,
                });
            }
        }
        Err(error) => checks.push(failed(
            "profile",
            "站点资料与额度",
            error,
            PROFILE_REMEDIATION,
            profile_started.elapsed().as_millis() as u64,
        )),
    }

    checks.push(
        probe_paged_resource(state, station, &mut secret, adapter, PagedResource::Keys).await,
    );
    checks.push(
        probe_paged_resource(state, station, &mut secret, adapter, PagedResource::Usage).await,
    );
    checks.push(probe_model_availability(state, station, requested_key_id).await);
    report(station, adapter_name(adapter), started, checks)
}

async fn probe_model_availability(
    state: &AppState,
    station: &Station,
    requested_key_id: Option<&str>,
) -> ProviderDoctorCheck {
    const REMEDIATION: &str =
        "请先同步站点并选择一把仍启用、配额可用的 API Key；随后重新运行体检。";
    let started = Instant::now();
    let key_id = match requested_key_id.map(str::trim).filter(|id| !id.is_empty()) {
        Some(key_id) => Some(key_id.to_string()),
        None => match state.store.lock() {
            Ok(store) => store
                .load_snapshot(&station.id)
                .ok()
                .flatten()
                .and_then(|(_, snapshot)| select_usable_key_id(&snapshot.api_keys)),
            Err(_) => None,
        },
    };
    let Some(key_id) = key_id else {
        return skipped_with_remediation(
            "model_availability",
            "模型可用性",
            "未找到可用于探针的已同步 API Key，因此没有发送模型请求。",
            REMEDIATION,
        );
    };

    let (model_station, key) = match read_api_key(state, &station.id, &key_id).await {
        Ok(value) => value,
        Err(error) => {
            return failed(
                "model_availability",
                "模型可用性",
                error,
                REMEDIATION,
                started.elapsed().as_millis() as u64,
            );
        }
    };
    let model = match discover_models(&state.client, &model_station.base_url, &key).await {
        Ok(models) => models.into_iter().next(),
        Err(error) => {
            return failed(
                "model_availability",
                "模型可用性",
                format!("API Key 可读取，但无法获取模型列表：{error}"),
                "请确认此 API Key 有 /v1/models 权限；如站点禁用了该接口，请在站点侧启用模型列表后重试。",
                started.elapsed().as_millis() as u64,
            );
        }
    };
    let Some(model) = model else {
        return failed(
            "model_availability",
            "模型可用性",
            "API Key 可读取，但模型列表为空。".into(),
            "请为该 API Key 分配至少一个可用模型或检查其模型分组。",
            started.elapsed().as_millis() as u64,
        );
    };
    match test_model(&state.client, &model_station, &key, &model, "chat").await {
        Ok(result) => ProviderDoctorCheck {
            id: "model_availability".into(),
            name: "模型可用性".into(),
            status: "pass".into(),
            detail: format!(
                "已使用保存的 API Key 成功探测模型 {model}（{}，{} ms）。",
                result.protocol, result.elapsed_ms
            ),
            remediation: None,
            elapsed_ms: started.elapsed().as_millis() as u64,
        },
        Err(error) => failed(
            "model_availability",
            "模型可用性",
            format!("模型 {model} 探针失败：{error}"),
            "请检查 API Key 的模型权限、模型名称和站点 OpenAI 兼容接口。",
            started.elapsed().as_millis() as u64,
        ),
    }
}

fn select_usable_key_id(keys: &[crate::models::ApiKeyInfo]) -> Option<String> {
    keys.iter()
        .find(|key| {
            key.status.eq_ignore_ascii_case("active")
                && (key.unlimited_quota || key.remaining_quota.unwrap_or(0.0) > 0.0)
        })
        .map(|key| key.id.clone())
}

async fn probe_paged_resource(
    state: &AppState,
    station: &Station,
    secret: &mut crate::keyring_store::Secret,
    adapter: StationAdapter,
    resource: PagedResource,
) -> ProviderDoctorCheck {
    let started = Instant::now();
    let (id, name) = match resource {
        PagedResource::Keys => ("keys_pagination", "API 密钥分页"),
        PagedResource::Usage => ("usage_pagination", "用量分页"),
    };
    let path = adapter.paged_path(resource, adapter.first_page(), 1);
    match station_request(state, station, secret, Method::GET, &path, None).await {
        Ok(value) if has_page_shape(&value) => ProviderDoctorCheck {
            id: id.into(),
            name: name.into(),
            status: "pass".into(),
            detail: format!("首个分页请求可用（{path}）；返回格式可识别。"),
            remediation: None,
            elapsed_ms: started.elapsed().as_millis() as u64,
        },
        Ok(_) => ProviderDoctorCheck {
            id: id.into(),
            name: name.into(),
            status: "warning".into(),
            detail: format!("首个分页请求成功（{path}），但返回格式不含可识别的列表字段。"),
            remediation: Some("请检查站点版本或反馈该端点的脱敏响应以补充适配器。".into()),
            elapsed_ms: started.elapsed().as_millis() as u64,
        },
        Err(error) => failed(
            id,
            name,
            error,
            PAGING_REMEDIATION,
            started.elapsed().as_millis() as u64,
        ),
    }
}

fn has_page_shape(value: &Value) -> bool {
    let root = data(value);
    root.is_array()
        || ["items", "records", "logs", "data"]
            .iter()
            .any(|field| root.get(*field).is_some_and(|value| value.is_array()))
}

fn capability_check(adapter: StationAdapter) -> ProviderDoctorCheck {
    let capabilities = adapter.capabilities();
    ProviderDoctorCheck {
        id: "adapter".into(),
        name: "接口兼容性".into(),
        status: "pass".into(),
        detail: format!(
            "{} 适配器已启用；密钥更新方式：{}；自定义密钥：{}；速率限制：{}。",
            adapter_name(adapter),
            capabilities.key_update,
            yes_no(capabilities.supports_custom_key),
            yes_no(capabilities.supports_rate_limits),
        ),
        remediation: None,
        elapsed_ms: 0,
    }
}

fn report(
    station: &Station,
    adapter: &str,
    started: Instant,
    checks: Vec<ProviderDoctorCheck>,
) -> ProviderDoctorReport {
    ProviderDoctorReport {
        station_id: station.id.clone(),
        station_name: station.name.clone(),
        adapter: adapter.into(),
        healthy: !checks.iter().any(|check| check.status == "fail"),
        elapsed_ms: started.elapsed().as_millis() as u64,
        checks,
    }
}

fn failed(
    id: &str,
    name: &str,
    detail: String,
    remediation: &str,
    elapsed_ms: u64,
) -> ProviderDoctorCheck {
    ProviderDoctorCheck {
        id: id.into(),
        name: name.into(),
        status: "fail".into(),
        detail,
        remediation: Some(remediation.into()),
        elapsed_ms,
    }
}

fn skipped(id: &str, name: &str, detail: &str) -> ProviderDoctorCheck {
    ProviderDoctorCheck {
        id: id.into(),
        name: name.into(),
        status: "skipped".into(),
        detail: detail.into(),
        remediation: None,
        elapsed_ms: 0,
    }
}

fn skipped_with_remediation(
    id: &str,
    name: &str,
    detail: &str,
    remediation: &str,
) -> ProviderDoctorCheck {
    ProviderDoctorCheck {
        id: id.into(),
        name: name.into(),
        status: "skipped".into(),
        detail: detail.into(),
        remediation: Some(remediation.into()),
        elapsed_ms: 0,
    }
}

fn adapter_name(adapter: StationAdapter) -> &'static str {
    match adapter {
        StationAdapter::Sub2Api => "Sub2API",
        StationAdapter::NewApi => "New API",
    }
}

fn yes_no(value: bool) -> &'static str {
    if value {
        "支持"
    } else {
        "不支持"
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{has_page_shape, select_usable_key_id};
    use crate::models::ApiKeyInfo;

    #[test]
    fn recognizes_supported_pagination_envelopes() {
        assert!(has_page_shape(&json!({"data": {"items": []}})));
        assert!(has_page_shape(&json!({"data": []})));
        assert!(has_page_shape(&json!({"records": []})));
        assert!(!has_page_shape(&json!({"data": {"message": "ok"}})));
    }

    #[test]
    fn selects_only_active_keys_with_available_quota() {
        let mut inactive = key("inactive", "inactive", Some(10.0), false);
        inactive.id = "inactive".into();
        let empty = key("empty", "active", Some(0.0), false);
        let usable = key("usable", "active", Some(1.0), false);
        assert_eq!(
            select_usable_key_id(&[inactive, empty, usable]),
            Some("usable".into())
        );
    }

    fn key(
        id: &str,
        status: &str,
        remaining_quota: Option<f64>,
        unlimited_quota: bool,
    ) -> ApiKeyInfo {
        ApiKeyInfo {
            id: id.into(),
            name: String::new(),
            masked_key: String::new(),
            group: None,
            status: status.into(),
            remaining_quota,
            total_quota: None,
            unlimited_quota,
            current_concurrency: None,
            used_quota: None,
            today_spent: None,
            last_30_days_spent: None,
            quota_reset_at: None,
            expires_at: None,
            created_at: None,
        }
    }
}
