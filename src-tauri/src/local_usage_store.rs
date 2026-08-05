use std::collections::{BTreeMap, BTreeSet};

use chrono::{Local, TimeZone, Timelike};
use rusqlite::{params, params_from_iter, types::Value, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{store::Store, support::now};

const DEFAULT_REFRESH_INTERVAL_MS: u64 = 30_000;
const MAX_QUERY_LOGS: usize = 100_000;
const TOTAL_INPUT_SEMANTICS: i64 = 1;

#[derive(Clone, Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageQuery {
    pub(crate) start_date: Option<i64>,
    pub(crate) end_date: Option<i64>,
    pub(crate) app_type: Option<String>,
    pub(crate) provider_name: Option<String>,
    pub(crate) model: Option<String>,
    #[serde(default = "default_page")]
    pub(crate) page: u32,
    #[serde(default = "default_page_size")]
    pub(crate) page_size: u32,
}

fn default_page() -> u32 {
    1
}

fn default_page_size() -> u32 {
    20
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageDashboard {
    pub(crate) summary: LocalUsageSummary,
    pub(crate) trends: Vec<LocalUsageDailyStats>,
    pub(crate) provider_stats: Vec<LocalUsageProviderStats>,
    pub(crate) model_stats: Vec<LocalUsageModelStats>,
    pub(crate) logs: Vec<LocalUsageLogDetail>,
    pub(crate) total_logs: u32,
    pub(crate) providers: Vec<String>,
    pub(crate) models: Vec<String>,
    pub(crate) app_types: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageSummary {
    pub(crate) total_requests: u64,
    pub(crate) total_cost: String,
    pub(crate) total_input_tokens: u64,
    pub(crate) total_output_tokens: u64,
    pub(crate) total_cache_creation_tokens: u64,
    pub(crate) total_cache_read_tokens: u64,
    pub(crate) success_rate: f64,
    pub(crate) real_total_tokens: u64,
    pub(crate) cache_hit_rate: f64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageDailyStats {
    pub(crate) date: String,
    pub(crate) request_count: u64,
    pub(crate) total_cost: String,
    pub(crate) total_tokens: u64,
    pub(crate) total_input_tokens: u64,
    pub(crate) total_output_tokens: u64,
    pub(crate) total_cache_creation_tokens: u64,
    pub(crate) total_cache_read_tokens: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageProviderStats {
    pub(crate) provider_id: String,
    pub(crate) provider_name: String,
    pub(crate) request_count: u64,
    pub(crate) total_tokens: u64,
    pub(crate) total_cost: String,
    pub(crate) success_rate: f64,
    pub(crate) avg_latency_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageModelStats {
    pub(crate) model: String,
    pub(crate) request_count: u64,
    pub(crate) total_tokens: u64,
    pub(crate) total_cost: String,
    pub(crate) avg_cost_per_request: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalUsageLogDetail {
    pub(crate) request_id: String,
    pub(crate) provider_id: String,
    pub(crate) provider_name: String,
    pub(crate) app_type: String,
    pub(crate) model: String,
    pub(crate) request_model: Option<String>,
    pub(crate) input_tokens: u64,
    pub(crate) output_tokens: u64,
    pub(crate) cache_read_tokens: u64,
    pub(crate) cache_creation_tokens: u64,
    pub(crate) total_tokens: u64,
    pub(crate) input_cost_usd: String,
    pub(crate) output_cost_usd: String,
    pub(crate) cache_read_cost_usd: String,
    pub(crate) cache_creation_cost_usd: String,
    pub(crate) total_cost_usd: String,
    pub(crate) is_streaming: bool,
    pub(crate) latency_ms: u64,
    pub(crate) first_token_ms: Option<u64>,
    pub(crate) duration_ms: Option<u64>,
    pub(crate) status_code: u16,
    pub(crate) error_message: Option<String>,
    pub(crate) endpoint: Option<String>,
    pub(crate) key_id: Option<String>,
    pub(crate) created_at: i64,
    pub(crate) data_source: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalModelPricing {
    pub(crate) model_id: String,
    pub(crate) display_name: String,
    pub(crate) input_cost_per_million: f64,
    pub(crate) output_cost_per_million: f64,
    pub(crate) cache_read_cost_per_million: f64,
    pub(crate) cache_creation_cost_per_million: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocalModelPricingInput {
    pub(crate) model_id: String,
    pub(crate) display_name: String,
    pub(crate) input_cost_per_million: f64,
    pub(crate) output_cost_per_million: f64,
    pub(crate) cache_read_cost_per_million: f64,
    pub(crate) cache_creation_cost_per_million: f64,
}

#[derive(Clone, Debug)]
pub(crate) struct LocalUsageRecord {
    pub(crate) request_id: String,
    pub(crate) provider_id: String,
    pub(crate) provider_name: String,
    pub(crate) app_type: String,
    pub(crate) model: String,
    pub(crate) request_model: Option<String>,
    pub(crate) input_tokens: i64,
    pub(crate) output_tokens: i64,
    pub(crate) cache_read_tokens: i64,
    pub(crate) cache_creation_tokens: i64,
    pub(crate) input_token_semantics: i64,
    pub(crate) latency_ms: i64,
    pub(crate) first_token_ms: Option<i64>,
    pub(crate) duration_ms: Option<i64>,
    pub(crate) status_code: u16,
    pub(crate) error_message: Option<String>,
    pub(crate) is_streaming: bool,
    pub(crate) endpoint: Option<String>,
    pub(crate) key_id: Option<String>,
    pub(crate) created_at: i64,
}

#[derive(Clone, Debug)]
struct StoredUsageLog {
    request_id: String,
    provider_id: String,
    provider_name: String,
    app_type: String,
    model: String,
    request_model: Option<String>,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_creation_tokens: i64,
    input_token_semantics: i64,
    input_cost_usd: f64,
    output_cost_usd: f64,
    cache_read_cost_usd: f64,
    cache_creation_cost_usd: f64,
    total_cost_usd: f64,
    latency_ms: i64,
    first_token_ms: Option<i64>,
    duration_ms: Option<i64>,
    status_code: u16,
    error_message: Option<String>,
    is_streaming: bool,
    endpoint: Option<String>,
    key_id: Option<String>,
    created_at: i64,
    data_source: String,
}

#[derive(Clone, Debug)]
struct UsageTrendPoint {
    created_at: i64,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    cache_creation_tokens: i64,
    input_token_semantics: i64,
    total_cost_usd: f64,
}

impl Store {
    pub(crate) fn record_local_usage(&self, record: &LocalUsageRecord) -> Result<(), String> {
        let pricing = self
            .connection
            .query_row(
                "SELECT input_cost_per_million, output_cost_per_million,
                        cache_read_cost_per_million, cache_creation_cost_per_million
                 FROM local_model_pricing WHERE model_id = ?1",
                [&record.model],
                |row| {
                    Ok((
                        row.get::<_, f64>(0)?,
                        row.get::<_, f64>(1)?,
                        row.get::<_, f64>(2)?,
                        row.get::<_, f64>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let pricing = pricing.or_else(|| {
            self.connection
                .query_row(
                    "SELECT input_cost_per_million, output_cost_per_million,
                            cache_read_cost_per_million, cache_creation_cost_per_million
                     FROM local_model_pricing WHERE model_id = '*'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, f64>(0)?,
                            row.get::<_, f64>(1)?,
                            row.get::<_, f64>(2)?,
                            row.get::<_, f64>(3)?,
                        ))
                    },
                )
                .optional()
                .ok()
                .flatten()
        });
        let input_tokens = positive(record.input_tokens);
        let output_tokens = positive(record.output_tokens);
        let cache_read_tokens = positive(record.cache_read_tokens);
        let cache_creation_tokens = positive(record.cache_creation_tokens);
        let billable_input_tokens = if record.input_token_semantics == TOTAL_INPUT_SEMANTICS {
            input_tokens
                .saturating_sub(cache_read_tokens)
                .saturating_sub(cache_creation_tokens)
        } else {
            input_tokens
        };
        let (input_cost, output_cost, cache_read_cost, cache_creation_cost) = pricing
            .map(|(input, output, cache_read, cache_creation)| {
                (
                    billable_input_tokens as f64 * input / 1_000_000.0,
                    output_tokens as f64 * output / 1_000_000.0,
                    cache_read_tokens as f64 * cache_read / 1_000_000.0,
                    cache_creation_tokens as f64 * cache_creation / 1_000_000.0,
                )
            })
            .unwrap_or_default();
        let total_cost = input_cost + output_cost + cache_read_cost + cache_creation_cost;
        self.connection
            .execute(
                "INSERT OR REPLACE INTO local_usage_logs (
                    request_id, provider_id, provider_name, app_type, model, request_model,
                    input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                    input_token_semantics, input_cost_usd, output_cost_usd, cache_read_cost_usd,
                    cache_creation_cost_usd, total_cost_usd, latency_ms, first_token_ms, duration_ms,
                    status_code, error_message, is_streaming, endpoint, key_id, created_at, data_source
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                           ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, 'local_gateway')",
                params![
                    record.request_id,
                    record.provider_id,
                    record.provider_name,
                    record.app_type,
                    record.model,
                    record.request_model,
                    input_tokens,
                    output_tokens,
                    cache_read_tokens,
                    cache_creation_tokens,
                    record.input_token_semantics,
                    input_cost,
                    output_cost,
                    cache_read_cost,
                    cache_creation_cost,
                    total_cost,
                    record.latency_ms.max(0),
                    record.first_token_ms,
                    record.duration_ms,
                    record.status_code as i64,
                    record.error_message,
                    record.is_streaming as i64,
                    record.endpoint,
                    record.key_id,
                    if record.created_at > 0 { record.created_at } else { now() },
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub(crate) fn local_usage_dashboard(
        &self,
        query: &LocalUsageQuery,
    ) -> Result<LocalUsageDashboard, String> {
        let end_date = query.end_date.unwrap_or_else(now);
        let start_date = query
            .start_date
            .unwrap_or_else(|| end_date.saturating_sub(86_400));
        let (start_date, end_date) = (start_date.min(end_date), start_date.max(end_date));
        let page_size = query.page_size.clamp(1, 200) as usize;
        let page = query.page.max(1) as usize;
        let offset = page.saturating_sub(1).saturating_mul(page_size);
        let summary = self.load_local_usage_summary(start_date, end_date, query)?;
        let trends = self.load_local_usage_trends(start_date, end_date, query)?;
        let provider_stats = self.load_local_usage_provider_stats(start_date, end_date, query)?;
        let model_stats = self.load_local_usage_model_stats(start_date, end_date, query)?;
        let total_logs = self.count_local_usage_logs(start_date, end_date, query)?;
        let logs =
            self.load_local_usage_log_page(start_date, end_date, query, page_size, offset)?;
        let providers =
            self.load_local_usage_options(start_date, end_date, query, "provider_name", false)?;
        let models = self.load_local_usage_options(start_date, end_date, query, "model", false)?;
        let app_types =
            self.load_local_usage_options(start_date, end_date, query, "app_type", true)?;
        Ok(LocalUsageDashboard {
            summary,
            trends,
            provider_stats,
            model_stats,
            logs,
            total_logs,
            providers,
            models,
            app_types,
        })
    }

    fn load_local_usage_summary(
        &self,
        start_date: i64,
        end_date: i64,
        query: &LocalUsageQuery,
    ) -> Result<LocalUsageSummary, String> {
        let (where_sql, mut values) = usage_filter_sql(start_date, end_date, query, true);
        values.push(Value::Integer(MAX_QUERY_LOGS as i64));
        let source = bounded_usage_source_sql(
            &where_sql,
            "input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
             input_token_semantics, total_cost_usd, status_code, created_at",
        );
        let fresh_input = fresh_input_sql();
        let statement_sql = format!(
            "SELECT COUNT(*),
                    COALESCE(SUM({fresh_input}), 0),
                    COALESCE(SUM(MAX(output_tokens, 0)), 0),
                    COALESCE(SUM(MAX(cache_creation_tokens, 0)), 0),
                    COALESCE(SUM(MAX(cache_read_tokens, 0)), 0),
                    COALESCE(SUM(total_cost_usd), 0),
                    COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 400 THEN 1 ELSE 0 END), 0)
             FROM ({source})"
        );
        self.connection
            .query_row(&statement_sql, params_from_iter(values.iter()), |row| {
                let total_requests = positive(row.get::<_, i64>(0)?);
                let total_input_tokens = positive(row.get::<_, i64>(1)?);
                let total_output_tokens = positive(row.get::<_, i64>(2)?);
                let total_cache_creation_tokens = positive(row.get::<_, i64>(3)?);
                let total_cache_read_tokens = positive(row.get::<_, i64>(4)?);
                let total_cost = row.get::<_, f64>(5)?;
                let success_count = positive(row.get::<_, i64>(6)?) as f64;
                let cacheable = total_input_tokens
                    .saturating_add(total_cache_creation_tokens)
                    .saturating_add(total_cache_read_tokens);
                let real_total_tokens = total_input_tokens
                    .saturating_add(total_output_tokens)
                    .saturating_add(total_cache_creation_tokens)
                    .saturating_add(total_cache_read_tokens);
                Ok(LocalUsageSummary {
                    total_requests,
                    total_cost: format_cost(total_cost),
                    total_input_tokens,
                    total_output_tokens,
                    total_cache_creation_tokens,
                    total_cache_read_tokens,
                    success_rate: if total_requests > 0 {
                        success_count / total_requests as f64 * 100.0
                    } else {
                        0.0
                    },
                    real_total_tokens,
                    cache_hit_rate: if cacheable > 0 {
                        total_cache_read_tokens as f64 / cacheable as f64
                    } else {
                        0.0
                    },
                })
            })
            .map_err(|error| error.to_string())
    }

    fn load_local_usage_provider_stats(
        &self,
        start_date: i64,
        end_date: i64,
        query: &LocalUsageQuery,
    ) -> Result<Vec<LocalUsageProviderStats>, String> {
        let (where_sql, mut values) = usage_filter_sql(start_date, end_date, query, true);
        values.push(Value::Integer(MAX_QUERY_LOGS as i64));
        let source = bounded_usage_source_sql(
            &where_sql,
            "provider_id, provider_name, input_tokens, output_tokens, cache_read_tokens,
             cache_creation_tokens, input_token_semantics, total_cost_usd, status_code,
             latency_ms, created_at",
        );
        let total_tokens = total_tokens_sql();
        let statement_sql = format!(
            "SELECT provider_id, provider_name, COUNT(*),
                    COALESCE(SUM(CASE WHEN status_code >= 200 AND status_code < 400 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM({total_tokens}), 0),
                    COALESCE(SUM(total_cost_usd), 0),
                    COALESCE(SUM(MAX(latency_ms, 0)), 0)
             FROM ({source})
             GROUP BY provider_id"
        );
        let mut statement = self
            .connection
            .prepare(&statement_sql)
            .map_err(|error| error.to_string())?;
        let mut output = statement
            .query_map(params_from_iter(values.iter()), |row| {
                let request_count = positive(row.get::<_, i64>(2)?);
                let success_count = positive(row.get::<_, i64>(3)?);
                let latency = positive(row.get::<_, i64>(6)?);
                Ok(LocalUsageProviderStats {
                    provider_id: row.get(0)?,
                    provider_name: row.get(1)?,
                    request_count,
                    total_tokens: positive(row.get::<_, i64>(4)?),
                    total_cost: format_cost(row.get::<_, f64>(5)?),
                    success_rate: if request_count > 0 {
                        success_count as f64 / request_count as f64 * 100.0
                    } else {
                        0.0
                    },
                    avg_latency_ms: if request_count > 0 {
                        latency / request_count
                    } else {
                        0
                    },
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        output.sort_by(|left, right| {
            right
                .request_count
                .cmp(&left.request_count)
                .then_with(|| left.provider_name.cmp(&right.provider_name))
        });
        Ok(output)
    }

    fn load_local_usage_model_stats(
        &self,
        start_date: i64,
        end_date: i64,
        query: &LocalUsageQuery,
    ) -> Result<Vec<LocalUsageModelStats>, String> {
        let (where_sql, mut values) = usage_filter_sql(start_date, end_date, query, true);
        values.push(Value::Integer(MAX_QUERY_LOGS as i64));
        let source = bounded_usage_source_sql(
            &where_sql,
            "model, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
             input_token_semantics, total_cost_usd, created_at",
        );
        let total_tokens = total_tokens_sql();
        let statement_sql = format!(
            "SELECT model, COUNT(*),
                    COALESCE(SUM({total_tokens}), 0),
                    COALESCE(SUM(total_cost_usd), 0)
             FROM ({source})
             GROUP BY model"
        );
        let mut statement = self
            .connection
            .prepare(&statement_sql)
            .map_err(|error| error.to_string())?;
        let mut output = statement
            .query_map(params_from_iter(values.iter()), |row| {
                let request_count = positive(row.get::<_, i64>(1)?);
                let total_cost = row.get::<_, f64>(3)?;
                Ok(LocalUsageModelStats {
                    model: row.get(0)?,
                    request_count,
                    total_tokens: positive(row.get::<_, i64>(2)?),
                    total_cost: format_cost(total_cost),
                    avg_cost_per_request: format_cost(if request_count > 0 {
                        total_cost / request_count as f64
                    } else {
                        0.0
                    }),
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        output.sort_by(|left, right| {
            right
                .request_count
                .cmp(&left.request_count)
                .then_with(|| left.model.cmp(&right.model))
        });
        Ok(output)
    }

    fn load_local_usage_trends(
        &self,
        start_date: i64,
        end_date: i64,
        query: &LocalUsageQuery,
    ) -> Result<Vec<LocalUsageDailyStats>, String> {
        let (where_sql, mut values) = usage_filter_sql(start_date, end_date, query, true);
        values.push(Value::Integer(MAX_QUERY_LOGS as i64));
        let source = bounded_usage_source_sql(
            &where_sql,
            "created_at, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
             input_token_semantics, total_cost_usd",
        );
        let statement_sql = format!(
            "SELECT created_at, input_tokens, output_tokens, cache_read_tokens,
                    cache_creation_tokens, input_token_semantics, total_cost_usd
             FROM ({source})"
        );
        let mut statement = self
            .connection
            .prepare(&statement_sql)
            .map_err(|error| error.to_string())?;
        let points = statement
            .query_map(params_from_iter(values.iter()), |row| {
                Ok(UsageTrendPoint {
                    created_at: row.get(0)?,
                    input_tokens: row.get(1)?,
                    output_tokens: row.get(2)?,
                    cache_read_tokens: row.get(3)?,
                    cache_creation_tokens: row.get(4)?,
                    input_token_semantics: row.get(5)?,
                    total_cost_usd: row.get(6)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(trends(&points, start_date, end_date))
    }

    fn count_local_usage_logs(
        &self,
        start_date: i64,
        end_date: i64,
        query: &LocalUsageQuery,
    ) -> Result<u32, String> {
        let (where_sql, values) = usage_filter_sql(start_date, end_date, query, true);
        let count = self
            .connection
            .query_row(
                &format!("SELECT COUNT(*) FROM local_usage_logs WHERE {where_sql}"),
                params_from_iter(values.iter()),
                |row| row.get::<_, i64>(0),
            )
            .map_err(|error| error.to_string())?;
        Ok(count.max(0).min(MAX_QUERY_LOGS as i64) as u32)
    }

    fn load_local_usage_log_page(
        &self,
        start_date: i64,
        end_date: i64,
        query: &LocalUsageQuery,
        page_size: usize,
        offset: usize,
    ) -> Result<Vec<LocalUsageLogDetail>, String> {
        if offset >= MAX_QUERY_LOGS {
            return Ok(Vec::new());
        }
        let limit = page_size.min(MAX_QUERY_LOGS - offset);
        let (where_sql, mut values) = usage_filter_sql(start_date, end_date, query, true);
        values.push(Value::Integer(limit as i64));
        values.push(Value::Integer(offset as i64));
        let mut statement = self
            .connection
            .prepare(&format!(
                "SELECT request_id, provider_id, provider_name, app_type, model, request_model,
                        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
                        input_token_semantics, input_cost_usd, output_cost_usd, cache_read_cost_usd,
                        cache_creation_cost_usd, total_cost_usd, latency_ms, first_token_ms, duration_ms,
                        status_code, error_message, is_streaming, endpoint, key_id, created_at, data_source
                 FROM local_usage_logs
                 WHERE {where_sql}
                 ORDER BY created_at DESC LIMIT ? OFFSET ?",
            ))
            .map_err(|error| error.to_string())?;
        let logs = statement
            .query_map(params_from_iter(values.iter()), |row| {
                Ok(StoredUsageLog {
                    request_id: row.get(0)?,
                    provider_id: row.get(1)?,
                    provider_name: row.get(2)?,
                    app_type: row.get(3)?,
                    model: row.get(4)?,
                    request_model: row.get(5)?,
                    input_tokens: row.get(6)?,
                    output_tokens: row.get(7)?,
                    cache_read_tokens: row.get(8)?,
                    cache_creation_tokens: row.get(9)?,
                    input_token_semantics: row.get(10)?,
                    input_cost_usd: row.get(11)?,
                    output_cost_usd: row.get(12)?,
                    cache_read_cost_usd: row.get(13)?,
                    cache_creation_cost_usd: row.get(14)?,
                    total_cost_usd: row.get(15)?,
                    latency_ms: row.get(16)?,
                    first_token_ms: row.get(17)?,
                    duration_ms: row.get(18)?,
                    status_code: row.get::<_, i64>(19)?.clamp(0, u16::MAX as i64) as u16,
                    error_message: row.get(20)?,
                    is_streaming: row.get::<_, i64>(21)? != 0,
                    endpoint: row.get(22)?,
                    key_id: row.get(23)?,
                    created_at: row.get(24)?,
                    data_source: row.get(25)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(logs.into_iter().map(|log| log_detail(&log)).collect())
    }

    fn load_local_usage_options(
        &self,
        start_date: i64,
        end_date: i64,
        query: &LocalUsageQuery,
        column: &str,
        include_model: bool,
    ) -> Result<Vec<String>, String> {
        let (where_sql, mut values) = usage_filter_sql(start_date, end_date, query, include_model);
        let statement_sql = if include_model {
            values.push(Value::Integer(MAX_QUERY_LOGS as i64));
            let source = bounded_usage_source_sql(&where_sql, "app_type, created_at");
            format!("SELECT DISTINCT {column} FROM ({source})")
        } else {
            format!("SELECT DISTINCT {column} FROM local_usage_logs WHERE {where_sql}")
        };
        let mut statement = self
            .connection
            .prepare(&statement_sql)
            .map_err(|error| error.to_string())?;
        let values = statement
            .query_map(params_from_iter(values.iter()), |row| {
                row.get::<_, String>(0)
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;
        Ok(sorted_strings(values.into_iter()))
    }

    pub(crate) fn local_model_pricing(&self) -> Result<Vec<LocalModelPricing>, String> {
        let mut statement = self
            .connection
            .prepare(
                "SELECT model_id, display_name, input_cost_per_million, output_cost_per_million,
                        cache_read_cost_per_million, cache_creation_cost_per_million
                 FROM local_model_pricing ORDER BY model_id COLLATE NOCASE",
            )
            .map_err(|error| error.to_string())?;
        let pricing = statement
            .query_map([], |row| {
                Ok(LocalModelPricing {
                    model_id: row.get(0)?,
                    display_name: row.get(1)?,
                    input_cost_per_million: row.get(2)?,
                    output_cost_per_million: row.get(3)?,
                    cache_read_cost_per_million: row.get(4)?,
                    cache_creation_cost_per_million: row.get(5)?,
                })
            })
            .map_err(|error| error.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string());
        pricing
    }

    pub(crate) fn save_local_model_pricing(
        &self,
        pricing: LocalModelPricingInput,
    ) -> Result<(), String> {
        let model_id = pricing.model_id.trim();
        if model_id.is_empty() || pricing.display_name.trim().is_empty() {
            return Err("模型 ID 和显示名称不能为空".into());
        }
        let values = [
            pricing.input_cost_per_million,
            pricing.output_cost_per_million,
            pricing.cache_read_cost_per_million,
            pricing.cache_creation_cost_per_million,
        ];
        if values
            .iter()
            .any(|value| !value.is_finite() || *value < 0.0)
        {
            return Err("模型价格必须是非负数".into());
        }
        self.connection
            .execute(
                "INSERT OR REPLACE INTO local_model_pricing
                 (model_id, display_name, input_cost_per_million, output_cost_per_million,
                  cache_read_cost_per_million, cache_creation_cost_per_million)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    model_id,
                    pricing.display_name.trim(),
                    pricing.input_cost_per_million,
                    pricing.output_cost_per_million,
                    pricing.cache_read_cost_per_million,
                    pricing.cache_creation_cost_per_million,
                ],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub(crate) fn delete_local_model_pricing(&self, model_id: &str) -> Result<(), String> {
        if model_id.trim() == "*" {
            return Err("不能删除默认定价".into());
        }
        self.connection
            .execute(
                "DELETE FROM local_model_pricing WHERE model_id = ?1",
                [model_id.trim()],
            )
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub(crate) fn clear_local_usage_logs(&self) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM local_usage_logs", [])
            .map_err(|error| error.to_string())?;
        Ok(())
    }

    pub(crate) fn local_usage_refresh_interval(&self) -> Result<u64, String> {
        let value = self
            .connection
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'localUsageRefreshIntervalMs'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        Ok(value
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(DEFAULT_REFRESH_INTERVAL_MS))
    }

    pub(crate) fn save_local_usage_refresh_interval(&self, value: u64) -> Result<u64, String> {
        let normalized = match value {
            0 | 5_000 | 10_000 | 30_000 | 60_000 => value,
            _ => DEFAULT_REFRESH_INTERVAL_MS,
        };
        self.connection
            .execute(
                "INSERT OR REPLACE INTO app_settings (key, value) VALUES ('localUsageRefreshIntervalMs', ?1)",
                [normalized.to_string()],
            )
            .map_err(|error| error.to_string())?;
        Ok(normalized)
    }
}

fn positive(value: i64) -> u64 {
    value.max(0) as u64
}

fn fresh_input(log: &StoredUsageLog) -> u64 {
    fresh_input_values(
        log.input_tokens,
        log.cache_read_tokens,
        log.cache_creation_tokens,
        log.input_token_semantics,
    )
}

fn fresh_input_values(
    input_tokens: i64,
    cache_read_tokens: i64,
    cache_creation_tokens: i64,
    input_token_semantics: i64,
) -> u64 {
    let input = positive(input_tokens);
    if input_token_semantics == TOTAL_INPUT_SEMANTICS {
        input
            .saturating_sub(positive(cache_read_tokens))
            .saturating_sub(positive(cache_creation_tokens))
    } else {
        input
    }
}

fn total_tokens(log: &StoredUsageLog) -> u64 {
    fresh_input(log)
        .saturating_add(positive(log.output_tokens))
        .saturating_add(positive(log.cache_creation_tokens))
        .saturating_add(positive(log.cache_read_tokens))
}

fn usage_filter_sql(
    start_date: i64,
    end_date: i64,
    query: &LocalUsageQuery,
    include_model: bool,
) -> (String, Vec<Value>) {
    let mut clauses = vec!["created_at >= ?".to_owned(), "created_at <= ?".to_owned()];
    let mut values = vec![Value::Integer(start_date), Value::Integer(end_date)];
    for (column, value) in [
        ("app_type", query.app_type.as_deref()),
        ("provider_name", query.provider_name.as_deref()),
    ] {
        if let Some(value) = active_filter(value) {
            clauses.push(format!("{column} = ?"));
            values.push(Value::Text(value.to_owned()));
        }
    }
    if include_model {
        if let Some(value) = active_filter(query.model.as_deref()) {
            clauses.push("model = ?".to_owned());
            values.push(Value::Text(value.to_owned()));
        }
    }
    (clauses.join(" AND "), values)
}

fn bounded_usage_source_sql(where_sql: &str, columns: &str) -> String {
    format!(
        "SELECT {columns} FROM local_usage_logs WHERE {where_sql} ORDER BY created_at DESC LIMIT ?"
    )
}

fn fresh_input_sql() -> &'static str {
    "CASE WHEN input_token_semantics = 1
          THEN MAX(MAX(input_tokens, 0) - MAX(cache_read_tokens, 0) - MAX(cache_creation_tokens, 0), 0)
          ELSE MAX(input_tokens, 0)
     END"
}

fn total_tokens_sql() -> String {
    format!(
        "({} + MAX(output_tokens, 0) + MAX(cache_creation_tokens, 0) + MAX(cache_read_tokens, 0))",
        fresh_input_sql()
    )
}

fn active_filter(value: Option<&str>) -> Option<&str> {
    value.filter(|value| !value.is_empty() && *value != "all")
}

fn sorted_strings(values: impl Iterator<Item = String>) -> Vec<String> {
    let mut set = BTreeSet::new();
    for value in values {
        if !value.trim().is_empty() {
            set.insert(value);
        }
    }
    set.into_iter().collect()
}

fn format_cost(value: f64) -> String {
    if value.is_finite() {
        format!("{value:.6}")
    } else {
        "0.000000".into()
    }
}

fn bucket_start(timestamp: i64, hourly: bool) -> i64 {
    let local = Local
        .timestamp_opt(timestamp, 0)
        .single()
        .unwrap_or_else(|| {
            Local
                .timestamp_opt(0, 0)
                .single()
                .expect("unix epoch is valid")
        });
    if hourly {
        local
            .with_minute(0)
            .and_then(|value| value.with_second(0))
            .and_then(|value| value.with_nanosecond(0))
            .map(|value| value.timestamp())
            .unwrap_or(timestamp - timestamp.rem_euclid(3_600))
    } else {
        local
            .date_naive()
            .and_hms_opt(0, 0, 0)
            .and_then(|value| Local.from_local_datetime(&value).single())
            .map(|value| value.timestamp())
            .unwrap_or(timestamp - timestamp.rem_euclid(86_400))
    }
}

fn trends(logs: &[UsageTrendPoint], start_date: i64, end_date: i64) -> Vec<LocalUsageDailyStats> {
    #[derive(Clone, Default)]
    struct Bucket {
        request_count: u64,
        total_cost: f64,
        total_input_tokens: u64,
        total_output_tokens: u64,
        total_cache_creation_tokens: u64,
        total_cache_read_tokens: u64,
    }

    let hourly = end_date.saturating_sub(start_date) <= 86_400;
    let step = if hourly { 3_600 } else { 86_400 };
    let first = bucket_start(start_date, hourly);
    let last = bucket_start(end_date, hourly);
    let mut buckets = BTreeMap::<i64, Bucket>::new();
    for log in logs {
        let bucket = buckets
            .entry(bucket_start(log.created_at, hourly))
            .or_default();
        bucket.request_count += 1;
        bucket.total_cost += log.total_cost_usd;
        bucket.total_input_tokens = bucket.total_input_tokens.saturating_add(fresh_input_values(
            log.input_tokens,
            log.cache_read_tokens,
            log.cache_creation_tokens,
            log.input_token_semantics,
        ));
        bucket.total_output_tokens = bucket
            .total_output_tokens
            .saturating_add(positive(log.output_tokens));
        bucket.total_cache_creation_tokens = bucket
            .total_cache_creation_tokens
            .saturating_add(positive(log.cache_creation_tokens));
        bucket.total_cache_read_tokens = bucket
            .total_cache_read_tokens
            .saturating_add(positive(log.cache_read_tokens));
    }
    let bucket_count = ((last.saturating_sub(first)) / step).min(2_000).max(0) as usize;
    (0..=bucket_count)
        .map(|index| {
            let timestamp = first.saturating_add(index as i64 * step);
            let bucket = buckets.get(&timestamp).cloned().unwrap_or_default();
            let total_tokens = bucket
                .total_input_tokens
                .saturating_add(bucket.total_output_tokens)
                .saturating_add(bucket.total_cache_creation_tokens)
                .saturating_add(bucket.total_cache_read_tokens);
            let date = Local
                .timestamp_opt(timestamp, 0)
                .single()
                .map(|value| value.to_rfc3339())
                .unwrap_or_else(|| timestamp.to_string());
            LocalUsageDailyStats {
                date,
                request_count: bucket.request_count,
                total_cost: format_cost(bucket.total_cost),
                total_tokens,
                total_input_tokens: bucket.total_input_tokens,
                total_output_tokens: bucket.total_output_tokens,
                total_cache_creation_tokens: bucket.total_cache_creation_tokens,
                total_cache_read_tokens: bucket.total_cache_read_tokens,
            }
        })
        .collect()
}

fn log_detail(log: &StoredUsageLog) -> LocalUsageLogDetail {
    LocalUsageLogDetail {
        request_id: log.request_id.clone(),
        provider_id: log.provider_id.clone(),
        provider_name: log.provider_name.clone(),
        app_type: log.app_type.clone(),
        model: log.model.clone(),
        request_model: log.request_model.clone(),
        input_tokens: fresh_input(log),
        output_tokens: positive(log.output_tokens),
        cache_read_tokens: positive(log.cache_read_tokens),
        cache_creation_tokens: positive(log.cache_creation_tokens),
        total_tokens: total_tokens(log),
        input_cost_usd: format_cost(log.input_cost_usd),
        output_cost_usd: format_cost(log.output_cost_usd),
        cache_read_cost_usd: format_cost(log.cache_read_cost_usd),
        cache_creation_cost_usd: format_cost(log.cache_creation_cost_usd),
        total_cost_usd: format_cost(log.total_cost_usd),
        is_streaming: log.is_streaming,
        latency_ms: positive(log.latency_ms),
        first_token_ms: log.first_token_ms.map(positive),
        duration_ms: log.duration_ms.map(positive),
        status_code: log.status_code,
        error_message: log.error_message.clone(),
        endpoint: log.endpoint.clone(),
        key_id: log.key_id.clone(),
        created_at: log.created_at,
        data_source: log.data_source.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    fn record(id: &str, app_type: &str, model: &str, input_tokens: i64) -> LocalUsageRecord {
        LocalUsageRecord {
            request_id: id.into(),
            provider_id: "station-1".into(),
            provider_name: "Relay A".into(),
            app_type: app_type.into(),
            model: model.into(),
            request_model: None,
            input_tokens,
            output_tokens: 200,
            cache_read_tokens: 300,
            cache_creation_tokens: 100,
            input_token_semantics: if app_type == "codex" {
                TOTAL_INPUT_SEMANTICS
            } else {
                0
            },
            latency_ms: 80,
            first_token_ms: None,
            duration_ms: Some(120),
            status_code: 200,
            error_message: None,
            is_streaming: false,
            endpoint: Some("/v1/chat/completions".into()),
            key_id: Some("key-1".into()),
            created_at: 1_720_000_000,
        }
    }

    #[test]
    fn local_statistics_empty_database_returns_zero_aggregates() {
        let file = NamedTempFile::new().unwrap();
        let store = Store::open(file.path().to_path_buf()).unwrap();
        let dashboard = store
            .local_usage_dashboard(&LocalUsageQuery {
                start_date: Some(1_720_000_000),
                end_date: Some(1_720_003_600),
                page: 1,
                page_size: 20,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(dashboard.summary.total_requests, 0);
        assert_eq!(dashboard.summary.total_cost, "0.000000");
        assert!(dashboard.logs.is_empty());
        assert!(dashboard.provider_stats.is_empty());
        assert!(dashboard.model_stats.is_empty());
        assert!(dashboard.app_types.is_empty());
    }

    #[test]
    fn local_statistics_use_cache_normalized_tokens_and_costs() {
        let file = NamedTempFile::new().unwrap();
        let store = Store::open(file.path().to_path_buf()).unwrap();
        store
            .record_local_usage(&record("a", "codex", "gpt-4o", 1_000))
            .unwrap();
        let dashboard = store
            .local_usage_dashboard(&LocalUsageQuery {
                start_date: Some(1_719_000_000),
                end_date: Some(1_721_000_000),
                page: 1,
                page_size: 20,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(dashboard.summary.total_input_tokens, 600);
        assert_eq!(dashboard.summary.real_total_tokens, 1_200);
        assert_eq!(dashboard.summary.total_cache_read_tokens, 300);
        assert!((dashboard.summary.cache_hit_rate - 0.3).abs() < 0.0001);
        assert_eq!(dashboard.logs[0].input_tokens, 600);
        assert_eq!(dashboard.provider_stats[0].avg_latency_ms, 80);
        assert!(dashboard.summary.total_cost.parse::<f64>().unwrap() > 0.0);
    }

    #[test]
    fn local_statistics_fill_empty_trend_buckets() {
        let file = NamedTempFile::new().unwrap();
        let store = Store::open(file.path().to_path_buf()).unwrap();
        store
            .record_local_usage(&record("a", "claude", "claude-3-5-sonnet", 100))
            .unwrap();
        let dashboard = store
            .local_usage_dashboard(&LocalUsageQuery {
                start_date: Some(1_720_000_000),
                end_date: Some(1_720_007_200),
                page: 1,
                page_size: 20,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(dashboard.trends.len(), 3);
        assert_eq!(
            dashboard
                .trends
                .iter()
                .filter(|item| item.request_count == 0)
                .count(),
            2
        );
    }

    #[test]
    fn local_statistics_push_filters_down_without_narrowing_options() {
        let file = NamedTempFile::new().unwrap();
        let store = Store::open(file.path().to_path_buf()).unwrap();
        let mut claude_a = record("claude-a", "claude", "claude-a", 100);
        claude_a.provider_name = "Relay A".into();
        claude_a.created_at = 1_720_000_100;
        let mut claude_b = record("claude-b", "claude", "claude-b", 100);
        claude_b.provider_name = "Relay A".into();
        claude_b.created_at = 1_720_000_200;
        let mut claude_other_provider = record("claude-c", "claude", "claude-a", 100);
        claude_other_provider.provider_id = "station-2".into();
        claude_other_provider.provider_name = "Relay B".into();
        claude_other_provider.created_at = 1_720_000_300;
        let mut codex = record("codex-a", "codex", "gpt-4o", 100);
        codex.provider_name = "Relay A".into();
        codex.created_at = 1_720_000_400;
        for item in [&claude_a, &claude_b, &claude_other_provider, &codex] {
            store.record_local_usage(item).unwrap();
        }

        let dashboard = store
            .local_usage_dashboard(&LocalUsageQuery {
                start_date: Some(1_719_000_000),
                end_date: Some(1_721_000_000),
                app_type: Some("claude".into()),
                provider_name: Some("Relay A".into()),
                model: Some("claude-a".into()),
                page: 1,
                page_size: 20,
            })
            .unwrap();
        assert_eq!(dashboard.total_logs, 1);
        assert_eq!(dashboard.logs[0].request_id, "claude-a");
        assert_eq!(dashboard.providers, vec!["Relay A"]);
        assert_eq!(dashboard.models, vec!["claude-a", "claude-b"]);
        assert_eq!(dashboard.app_types, vec!["claude"]);

        let page = store
            .local_usage_dashboard(&LocalUsageQuery {
                start_date: Some(1_719_000_000),
                end_date: Some(1_721_000_000),
                page: 2,
                page_size: 1,
                ..Default::default()
            })
            .unwrap();
        assert_eq!(page.total_logs, 4);
        assert_eq!(page.logs.len(), 1);
        assert_eq!(page.logs[0].request_id, "claude-c");
        assert_eq!(page.summary.total_requests, 4);
        assert_eq!(page.summary.total_input_tokens, 300);
        assert_eq!(page.summary.real_total_tokens, 2_700);
        assert_eq!(page.provider_stats[0].provider_name, "Relay A");
        assert_eq!(page.provider_stats[0].request_count, 3);
        assert_eq!(page.model_stats[0].model, "claude-a");
        assert_eq!(page.model_stats[0].request_count, 2);
    }
}
