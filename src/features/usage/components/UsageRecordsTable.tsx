import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { UsageLog } from "../types";

export type UsageColumns = Record<"key" | "model" | "reasoning" | "endpoint" | "ip" | "source" | "group" | "type" | "billing" | "tokens" | "cost" | "latency" | "time", boolean>;

const formatMoney = (value?: number) => value == null ? "-" : `${value.toFixed(4)} 额度`;
const formatNumber = (value?: number) => new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value ?? 0);
const formatTime = (value?: number) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(value * 1000) : "尚未同步";
const compactDuration = (value?: number) => value == null ? "-" : value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`;
const formatCostDetail = (value?: number) => value == null ? "-" : `$${value.toFixed(6)}`;
const formatTokenPrice = (cost?: number, tokens?: number) => cost == null || !tokens ? "-" : `$${((cost / tokens) * 1_000_000).toFixed(4)} / 1M Token`;

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

const labels: Record<keyof UsageColumns, string> = {
  key: "API 密钥", model: "模型", reasoning: "推理强度", endpoint: "端点", ip: "IP", source: "来源", group: "分组", type: "类型", billing: "计费", tokens: "Token", cost: "费用", latency: "延迟", time: "时间",
};

function cells(row: UsageLog): Record<keyof UsageColumns, ReactNode> {
  return {
    key: row.apiKeyName ?? "-", model: row.model || "-", reasoning: row.reasoningEffort ?? "-", endpoint: row.endpoint ?? "-", ip: row.ipAddress ?? "-",
    source: <><strong>{row.stationName}</strong><small>{row.stationUrl ?? "-"}</small></>, group: row.groupName ?? "-", type: row.requestType || "-", billing: [row.billingType, row.billingMode].filter(Boolean).join(" / ") || "-",
    tokens: <><strong>{formatNumber(row.inputTokens + row.outputTokens + row.cacheCreationTokens + row.cacheReadTokens)}</strong><small>输 {formatNumber(row.inputTokens)} / 出 {formatNumber(row.outputTokens)}</small></>,
    cost: <span className="usage-cost-cell"><span>{formatMoney(row.actualCost)}</span><CostDetails row={row} /></span>, latency: compactDuration(row.durationMs), time: formatTime(row.createdAt),
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
  return <div className="sub2-mobile-cards">{rows.map((row) => <article className="sub2-record-card" key={row.id}><div><strong>{row.model || "未知模型"}</strong><span className="sub2-request-type">{row.requestType || "-"}</span></div><small>{formatTime(row.createdAt)}</small><dl>{columns.source && <><div><dt>来源</dt><dd>{row.stationName}</dd></div><div><dt>网址</dt><dd>{row.stationUrl ?? "-"}</dd></div></>}{columns.endpoint && <div><dt>端点</dt><dd>{row.endpoint ?? "-"}</dd></div>}{columns.key && <div><dt>API 密钥</dt><dd>{row.apiKeyName ?? "-"}</dd></div>}{columns.group && <div><dt>分组</dt><dd>{row.groupName ?? "-"}</dd></div>}{columns.tokens && <div><dt>Token</dt><dd>{formatNumber(row.inputTokens + row.outputTokens)}</dd></div>}{columns.cost && <div><dt>费用</dt><dd className="usage-mobile-cost"><span>{formatMoney(row.actualCost)}</span><CostDetails row={row} /></dd></div>}{columns.latency && <div><dt>延迟</dt><dd>{compactDuration(row.durationMs)}</dd></div>}</dl></article>)}</div>;
}
