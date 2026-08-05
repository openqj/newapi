import { createPortal } from "react-dom";
import { Archive, ArrowDown, ArrowUp, Info, PencilLine } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { UsageLog } from "../types";

export type UsageColumns = Record<"key" | "model" | "reasoning" | "endpoint" | "ip" | "source" | "group" | "type" | "billing" | "tokens" | "cost" | "latency" | "time", boolean>;

const formatMoney = (value?: number) => value == null ? "-" : `${value.toFixed(4)} 额度`;
const formatInteger = (value?: number) => new Intl.NumberFormat("zh-CN").format(value ?? 0);
const formatCacheTokens = (value?: number) => {
  const tokens = value ?? 0;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return formatInteger(tokens);
};
const formatTime = (value?: number) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value * 1000) : "尚未同步";
const compactDuration = (value?: number | null) => {
  if (value == null) return "-";
  if (value < 1000) return `${value}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(2)}s`;
  const totalSeconds = Math.round(value / 1000);
  if (totalSeconds < 3600) return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`;
  return `${Math.floor(totalSeconds / 3600)}h ${Math.floor((totalSeconds % 3600) / 60)}m`;
};
const formatCostDetail = (value?: number) => value == null ? "-" : `$${value.toFixed(6)}`;
const formatTokenPrice = (cost?: number, tokens?: number) => cost == null || !tokens ? "-" : `$${((cost / tokens) * 1_000_000).toFixed(4)} / 1M Token`;

function requestTypeLabel(value?: string) {
  switch (value?.trim().toLowerCase()) {
    case "stream": return "流式";
    case "sync": return "同步";
    case "ws_v2": return "WS";
    case "cyber": return "Cyber";
    case "live": return "实时";
    default: return value?.trim() || "-";
  }
}

function requestTypeTone(value?: string) {
  switch (value?.trim().toLowerCase()) {
    case "stream": return "stream";
    case "sync": return "sync";
    default: return "other";
  }
}

function billingModeLabel(row: UsageLog) {
  const mode = row.billingMode?.trim().toLowerCase();
  switch (mode) {
    case "token":
    case "standard":
    case "按量":
      return "按量";
    case "per_request":
    case "request":
    case "按请求":
      return "按请求";
    case "image":
    case "按图片":
      return "按图片";
    case "video":
    case "按视频":
      return "按视频";
    default: {
      const fallback = row.billingMode?.trim() || row.billingType?.trim();
      return fallback && !/^\d+$/.test(fallback) ? fallback : "按量";
    }
  }
}

function billingModeTone(row: UsageLog) {
  switch (row.billingMode?.trim().toLowerCase()) {
    case "per_request":
    case "request":
    case "按请求":
      return "request";
    case "image":
    case "按图片":
      return "image";
    case "video":
    case "按视频":
      return "video";
    default: return "token";
  }
}

function serviceTierLabel(value?: string) {
  switch (value?.toLowerCase()) {
    case "priority":
    case "fast":
      return "Fast";
    case "flex":
      return "Flex";
    default:
      return "Standard";
  }
}

function CostDetails({ row }: { row: UsageLog }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; side: "left" | "right" } | null>(null);
  const visible = hovered || focused || pinned;
  const tooltipId = `usage-cost-tooltip-${row.id}`;
  const hasCostBreakdown = [row.inputCost, row.outputCost, row.cacheCreationCost, row.cacheReadCost].some((value) => value != null);

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const tooltipWidth = 260;
    const gap = 8;
    const placeRight = rect.right + gap + tooltipWidth <= window.innerWidth - 8;
    setPosition({
      left: placeRight ? rect.right + gap : Math.max(8, rect.left - tooltipWidth - gap),
      top: Math.min(Math.max(rect.top + rect.height / 2, 8), window.innerHeight - 8),
      side: placeRight ? "right" : "left",
    });
  };

  useEffect(() => {
    if (!visible) return;
    updatePosition();
    const onViewportChange = () => updatePosition();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHovered(false);
        setFocused(false);
        setPinned(false);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target)) {
        setHovered(false);
        setFocused(false);
        setPinned(false);
      }
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [visible]);

  return <span className="usage-cost-details">
    <button
      ref={triggerRef}
      type="button"
      className="usage-cost-details-trigger"
      aria-label="查看费用明细"
      aria-describedby={visible ? tooltipId : undefined}
      aria-expanded={visible}
      title="查看费用明细"
      onMouseEnter={() => { setHovered(true); updatePosition(); }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => { setFocused(true); updatePosition(); }}
      onBlur={() => setFocused(false)}
      onClick={() => setPinned((value) => !value)}
    >
      <Info size={13} strokeWidth={2} />
    </button>
    {visible && position && createPortal(
      <div id={tooltipId} role="tooltip" className="usage-cost-tooltip" style={{ left: position.left, top: position.top }}>
        <span className={`usage-cost-tooltip-arrow ${position.side}`} aria-hidden="true" />
        <div className="usage-cost-tooltip-title">费用明细</div>
        <div className="usage-cost-tooltip-section">
          {hasCostBreakdown ? <>
            <CostDetailRow label="输入费用" value={formatCostDetail(row.inputCost)} />
            <CostDetailRow label="输出费用" value={formatCostDetail(row.outputCost)} />
            <CostDetailRow label="输入单价" value={formatTokenPrice(row.inputCost, row.inputTokens)} tone="input" />
            <CostDetailRow label="输出单价" value={formatTokenPrice(row.outputCost, row.outputTokens)} tone="output" />
            <CostDetailRow label="缓存创建费用" value={formatCostDetail(row.cacheCreationCost)} />
            <CostDetailRow label="缓存读取费用" value={formatCostDetail(row.cacheReadCost)} />
          </> : <div className="usage-cost-tooltip-empty">当前记录未提供费用拆分</div>}
        </div>
        <div className="usage-cost-tooltip-summary">
          <CostDetailRow label="服务档位" value={serviceTierLabel(row.serviceTier)} tone="tier" />
          <CostDetailRow label="倍率" value={`${(row.rateMultiplier ?? 1).toFixed(3)}x`} tone="rate" />
          <CostDetailRow label="原始" value={formatCostDetail(row.totalCost ?? row.actualCost)} />
          <CostDetailRow label="用户扣费" value={formatCostDetail(row.actualCost)} tone="actual" />
        </div>
      </div>,
      document.body,
    )}
  </span>;
}

function CostDetailRow({ label, value, tone }: { label: string; value: string; tone?: "input" | "output" | "tier" | "rate" | "actual" }) {
  return <div className="usage-cost-tooltip-row"><span>{label}</span><strong className={tone ? `tone-${tone}` : undefined}>{value}</strong></div>;
}

function tokenTotal(row: UsageLog) {
  return row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens;
}

function TokenDetails({ row }: { row: UsageLog }) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number; side: "left" | "right" } | null>(null);
  const visible = hovered || focused || pinned;
  const tooltipId = `usage-token-tooltip-${row.id}`;

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const tooltipWidth = 230;
    const gap = 8;
    const placeRight = rect.right + gap + tooltipWidth <= window.innerWidth - 8;
    setPosition({
      left: placeRight ? rect.right + gap : Math.max(8, rect.left - tooltipWidth - gap),
      top: Math.min(Math.max(rect.top + rect.height / 2, 8), window.innerHeight - 8),
      side: placeRight ? "right" : "left",
    });
  };

  useEffect(() => {
    if (!visible) return;
    updatePosition();
    const onViewportChange = () => updatePosition();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHovered(false);
        setFocused(false);
        setPinned(false);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target)) {
        setHovered(false);
        setFocused(false);
        setPinned(false);
      }
    };
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("resize", onViewportChange);
      window.removeEventListener("scroll", onViewportChange, true);
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [visible]);

  return <span className="usage-token-details">
    <button
      ref={triggerRef}
      type="button"
      className="usage-token-details-trigger"
      aria-label="查看 Token 详情"
      aria-describedby={visible ? tooltipId : undefined}
      aria-expanded={visible}
      title="查看 Token 详情"
      onMouseEnter={() => { setHovered(true); updatePosition(); }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => { setFocused(true); updatePosition(); }}
      onBlur={() => setFocused(false)}
      onClick={() => setPinned((value) => !value)}
    >
      <Info size={13} strokeWidth={2} />
    </button>
    {visible && position && createPortal(
      <div id={tooltipId} role="tooltip" className="usage-token-tooltip" style={{ left: position.left, top: position.top }}>
        <span className={`usage-token-tooltip-arrow ${position.side}`} aria-hidden="true" />
        <div className="usage-token-tooltip-title">Token 详情</div>
        <div className="usage-token-tooltip-section">
          <TokenDetailRow label="输入 Token" value={formatInteger(row.inputTokens)} tone="input" />
          <TokenDetailRow label="输出 Token" value={formatInteger(row.outputTokens)} tone="output" />
          {row.cacheCreationTokens > 0 && <TokenDetailRow label="缓存创建 Token" value={formatInteger(row.cacheCreationTokens)} tone="cache-create" />}
          {row.cacheReadTokens > 0 && <TokenDetailRow label="缓存读取 Token" value={formatInteger(row.cacheReadTokens)} tone="cache-read" />}
        </div>
        <div className="usage-token-tooltip-summary">
          <TokenDetailRow label="总 Token" value={formatInteger(tokenTotal(row))} tone="total" />
        </div>
      </div>,
      document.body,
    )}
  </span>;
}

function TokenDetailRow({ label, value, tone }: { label: string; value: string; tone: "input" | "output" | "cache-create" | "cache-read" | "total" }) {
  return <div className="usage-token-tooltip-row"><span>{label}</span><strong className={`tone-${tone}`}>{value}</strong></div>;
}

function TokenCell({ row }: { row: UsageLog }) {
  const hasCache = row.cacheCreationTokens > 0 || row.cacheReadTokens > 0;
  return <div className="usage-token-cell">
    <div className="usage-token-values">
      <div className="usage-token-primary">
        <span className="usage-token-value usage-token-input"><ArrowDown size={14} strokeWidth={1.8} aria-hidden="true" />{formatInteger(row.inputTokens)}</span>
        <span className="usage-token-value usage-token-output"><ArrowUp size={14} strokeWidth={1.8} aria-hidden="true" />{formatInteger(row.outputTokens)}</span>
      </div>
      {hasCache && <div className="usage-token-cache">
        {row.cacheReadTokens > 0 && <span className="usage-token-value usage-token-cache-read"><Archive size={13} strokeWidth={1.8} aria-hidden="true" />{formatCacheTokens(row.cacheReadTokens)}</span>}
        {row.cacheCreationTokens > 0 && <span className="usage-token-value usage-token-cache-create"><PencilLine size={13} strokeWidth={1.8} aria-hidden="true" />{formatCacheTokens(row.cacheCreationTokens)}</span>}
      </div>}
    </div>
    <TokenDetails row={row} />
  </div>;
}

function latencyTone(value: number | null | undefined, kind: "first" | "duration") {
  if (value == null) return "muted";
  const threshold = kind === "first" ? 10_000 : 60_000;
  if (value >= threshold * 3) return "slow";
  if (value >= threshold) return "warn";
  return "good";
}

function LatencyCell({ row }: { row: UsageLog }) {
  const firstTone = latencyTone(row.firstTokenMs, "first");
  const durationTone = latencyTone(row.durationMs, "duration");
  return <div className="usage-latency-cell">
    <span className={`usage-latency-bar usage-latency-${durationTone}`} aria-hidden="true" />
    <div className="usage-latency-values">
      <span><small>首字</small><strong className={`usage-latency-${firstTone}`}>{compactDuration(row.firstTokenMs)}</strong></span>
      <span><small>总耗时</small><strong className={`usage-latency-${durationTone}`}>{compactDuration(row.durationMs)}</strong></span>
    </div>
  </div>;
}

const labels: Record<keyof UsageColumns, string> = {
  key: "API 密钥", model: "模型", reasoning: "推理强度", endpoint: "端点", ip: "IP", source: "来源", group: "分组", type: "类型", billing: "计费模式", tokens: "Token", cost: "费用", latency: "延迟", time: "时间",
};

function cells(row: UsageLog): Record<keyof UsageColumns, ReactNode> {
  return {
    key: row.apiKeyName ?? "-", model: row.model || "-", reasoning: row.reasoningEffort ?? "-", endpoint: row.endpoint ?? "-", ip: row.ipAddress ?? "-",
    source: <><strong>{row.stationName}</strong><small>{row.stationUrl ?? "-"}</small></>, group: row.groupName ?? "-",
    type: <span className={`usage-label-badge usage-request-${requestTypeTone(row.requestType)}`}>{requestTypeLabel(row.requestType)}</span>,
    billing: <span className={`usage-label-badge usage-billing-${billingModeTone(row)}`}>{billingModeLabel(row)}</span>,
    tokens: <TokenCell row={row} />,
    cost: <span className="usage-cost-cell"><span>{formatMoney(row.actualCost)}</span><CostDetails row={row} /></span>, latency: <LatencyCell row={row} />, time: formatTime(row.createdAt),
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
  return <div className="sub2-mobile-cards">{rows.map((row) => <article className="sub2-record-card" key={row.id}><div><strong>{row.model || "未知模型"}</strong><span className={`usage-label-badge usage-request-${requestTypeTone(row.requestType)}`}>{requestTypeLabel(row.requestType)}</span></div><small>{formatTime(row.createdAt)}</small><dl>{columns.source && <><div><dt>来源</dt><dd>{row.stationName}</dd></div><div><dt>网址</dt><dd>{row.stationUrl ?? "-"}</dd></div></>}{columns.endpoint && <div><dt>端点</dt><dd>{row.endpoint ?? "-"}</dd></div>}{columns.key && <div><dt>API 密钥</dt><dd>{row.apiKeyName ?? "-"}</dd></div>}{columns.group && <div><dt>分组</dt><dd>{row.groupName ?? "-"}</dd></div>}{columns.type && <div><dt>类型</dt><dd><span className={`usage-label-badge usage-request-${requestTypeTone(row.requestType)}`}>{requestTypeLabel(row.requestType)}</span></dd></div>}{columns.billing && <div><dt>计费模式</dt><dd><span className={`usage-label-badge usage-billing-${billingModeTone(row)}`}>{billingModeLabel(row)}</span></dd></div>}{columns.tokens && <div><dt>Token</dt><dd><TokenCell row={row} /></dd></div>}{columns.cost && <div><dt>费用</dt><dd className="usage-mobile-cost"><span>{formatMoney(row.actualCost)}</span><CostDetails row={row} /></dd></div>}{columns.latency && <div><dt>延迟</dt><dd><LatencyCell row={row} /></dd></div>}</dl></article>)}</div>;
}
