import type { ReactNode } from "react";
import type { UsageLog } from "../types";

export type UsageColumns = Record<"key" | "model" | "reasoning" | "endpoint" | "ip" | "source" | "group" | "type" | "billing" | "tokens" | "cost" | "latency" | "time", boolean>;

const formatMoney = (value?: number) => value == null ? "-" : `${value.toFixed(4)} 额度`;
const formatNumber = (value?: number) => new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value ?? 0);
const formatTime = (value?: number) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value * 1000) : "尚未同步";
const compactDuration = (value?: number) => value == null ? "-" : value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`;

const labels: Record<keyof UsageColumns, string> = {
  key: "API 密钥", model: "模型", reasoning: "推理强度", endpoint: "端点", ip: "IP", source: "来源", group: "分组", type: "类型", billing: "计费", tokens: "Token", cost: "费用", latency: "延迟", time: "时间",
};

function cells(row: UsageLog): Record<keyof UsageColumns, ReactNode> {
  return {
    key: row.apiKeyName ?? "-", model: row.model || "-", reasoning: row.reasoningEffort ?? "-", endpoint: row.endpoint ?? "-", ip: row.ipAddress ?? "-",
    source: <><strong>{row.stationName}</strong><small>{row.stationUrl ?? "-"}</small></>, group: row.groupName ?? "-", type: row.requestType || "-", billing: [row.billingType, row.billingMode].filter(Boolean).join(" / ") || "-",
    tokens: <><strong>{formatNumber(row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens)}</strong><small>输 {formatNumber(row.inputTokens)} / 出 {formatNumber(row.outputTokens)}</small></>,
    cost: formatMoney(row.actualCost), latency: compactDuration(row.durationMs), time: formatTime(row.createdAt),
  };
}

type UsageRecordsProps = { rows: UsageLog[]; columns: UsageColumns };

export function UsageRecordsDesktop({ rows, columns }: UsageRecordsProps) {
  const visible = (Object.keys(columns) as Array<keyof UsageColumns>).filter((key) => columns[key]);

  return <div className="sub2-desktop-table"><table><thead><tr>{visible.map((key) => <th key={key}>{labels[key]}</th>)}</tr></thead><tbody>{rows.map((row) => {
      const rowCells = cells(row);
      return <tr key={row.id}>{visible.map((key) => <td key={key}>{rowCells[key]}</td>)}</tr>;
    })}</tbody></table></div>;
}

export function UsageRecordsMobile({ rows, columns }: UsageRecordsProps) {
  return <div className="sub2-mobile-cards">{rows.map((row) => <article className="sub2-record-card" key={row.id}><div><strong>{row.model || "未知模型"}</strong><span className="sub2-request-type">{row.requestType || "-"}</span></div><small>{formatTime(row.createdAt)}</small><dl>{columns.source && <><div><dt>来源</dt><dd>{row.stationName}</dd></div><div><dt>网址</dt><dd>{row.stationUrl ?? "-"}</dd></div></>}{columns.endpoint && <div><dt>端点</dt><dd>{row.endpoint ?? "-"}</dd></div>}{columns.key && <div><dt>API 密钥</dt><dd>{row.apiKeyName ?? "-"}</dd></div>}{columns.group && <div><dt>分组</dt><dd>{row.groupName ?? "-"}</dd></div>}{columns.tokens && <div><dt>Token</dt><dd>{formatNumber(row.inputTokens + row.outputTokens)}</dd></div>}{columns.cost && <div><dt>费用</dt><dd>{formatMoney(row.actualCost)}</dd></div>}{columns.latency && <div><dt>延迟</dt><dd>{compactDuration(row.durationMs)}</dd></div>}</dl></article>)}</div>;
}
