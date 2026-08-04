import { ChevronDown } from "lucide-react";
import type { DetectionResult } from "../types";
import { endpointDisplay, formatDuration, formatHistoryTime, formatNumber, statusText } from "../utils";

export type DetectionHistoryItem = DetectionResult & { id: string; endpoint: string; model: string; createdAt: number; trendLabel?: "本次下降" | "持续漂移" | "结果不稳定" };

export function DetectionHistory({ history, expandedId, onSelect, onClear }: { history: DetectionHistoryItem[]; expandedId?: string; onSelect: (item: DetectionHistoryItem) => void; onClear: () => void }) {
  return <section className="api-detection-history" aria-label="本次检测历史">
    <div className="api-detection-history-header"><h2>最近检测</h2>{history.length > 0 && <button type="button" onClick={onClear}>清空</button>}</div>
    {history.length === 0 ? <p className="api-detection-history-empty">本次检测结果会显示在这里。</p> : <div className="api-detection-history-list">{history.map((item) => {
      const expanded = expandedId === item.id;
      return <article className={`api-detection-history-item${expanded ? " expanded" : ""}`} key={item.id}>
        <button type="button" className="api-detection-history-row" onClick={() => onSelect(item)} aria-expanded={expanded}><time>{formatHistoryTime(item.createdAt)}</time><strong title={item.model}>{item.model}</strong><span title={endpointDisplay(item.endpoint)}>{endpointDisplay(item.endpoint)}</span><b>{item.score}%{item.trendLabel ? ` · ${item.trendLabel}` : ""}</b><ChevronDown size={16} aria-hidden="true" /></button>
        {expanded && <div className="api-detection-history-detail"><div className="api-detection-history-score"><span>综合可信度</span><strong>{item.score}%</strong></div><div className="api-detection-history-checks">{item.checks.map((check) => <div key={`${item.id}-${check.name}`}><span>{check.name}</span><b className={check.status}>{statusText(check.status)}</b></div>)}</div><dl className="api-detection-history-metrics"><div><dt>延迟</dt><dd>{formatDuration(item.elapsedMs)}</dd></div>{item.tokensPerSecond !== undefined && <div><dt>Tokens/秒</dt><dd>{item.tokensPerSecond.toFixed(1)}</dd></div>}{item.inputTokens !== undefined && <div><dt>输入 Tokens</dt><dd>{formatNumber(item.inputTokens)}</dd></div>}{item.outputTokens !== undefined && <div><dt>输出 Tokens</dt><dd>{formatNumber(item.outputTokens)}</dd></div>}{item.cacheReadTokens !== undefined && <div><dt>缓存读取 Tokens</dt><dd>{formatNumber(item.cacheReadTokens)}</dd></div>}</dl></div>}
      </article>;
    })}</div>}
  </section>;
}
