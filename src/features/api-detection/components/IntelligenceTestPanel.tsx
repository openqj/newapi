import { Brain, CheckCircle2, CircleAlert, Clock3, Minus, TrendingDown, TrendingUp, XCircle } from "lucide-react";
import type { IntelligenceDetectionResult, IntelligenceTestItem } from "../types";
import { formatDuration, formatNumber } from "../utils";

const statusLabel = (status: IntelligenceTestItem["status"]) =>
  status === "pass" ? "通过" : status === "warning" ? "波动" : "失败";

export function IntelligenceTestPanel({
  result,
  model,
  baselineScore,
}: {
  result: IntelligenceDetectionResult;
  model: string;
  baselineScore?: number;
}) {
  const delta = baselineScore === undefined ? undefined : result.score - baselineScore;
  const DeltaIcon = delta === undefined ? Minus : delta < 0 ? TrendingDown : TrendingUp;
  return <section className="api-intelligence-result" aria-live="polite">
    <header className="api-intelligence-result-header">
      <div><div className="api-intelligence-kicker"><Brain size={15} /> 推理能力基准</div><h2>检测智商</h2><p>固定题组的行为分数，不代表心理学 IQ；用于观察同一模型是否出现推理能力下降。</p>{result.telemetryAttempted && <small className={`api-intelligence-telemetry${result.telemetryUploaded ? " uploaded" : ""}`}>{result.telemetryUploaded ? "统计已上传" : "统计待重试"}</small>}</div>
      <strong className={`api-intelligence-score ${result.score >= 80 ? "good" : result.score >= 60 ? "warn" : "bad"}`}>{result.score}</strong>
    </header>
    <div className="api-intelligence-summary">
      <div><span>目标模型</span><strong>{model}</strong></div>
      <div><span>正确试验</span><strong>{result.correct}/{result.total}</strong></div>
      <div><span>重复置信度</span><strong>{Math.round(result.confidence * 100)}%</strong></div>
      <div className={delta === undefined ? "" : delta < 0 ? "negative" : delta > 0 ? "positive" : ""}><span>相较上次</span><strong><DeltaIcon size={14} />{delta === undefined ? "暂无基线" : `${delta > 0 ? "+" : ""}${delta} 分`}</strong></div>
    </div>
    <div className="api-intelligence-items">{result.items.map((item) => {
      const Icon = item.status === "pass" ? CheckCircle2 : item.status === "warning" ? CircleAlert : XCircle;
      return <article key={item.id} className={`api-intelligence-item ${item.status}`}><Icon size={17} /><div><strong>{item.name}</strong><p>{item.detail}</p>{item.trace && <details><summary>查看回答证据</summary><pre>{item.trace}</pre></details>}</div><b>{statusLabel(item.status)}</b></article>;
    })}</div>
    <footer className="api-intelligence-metrics"><span><Clock3 size={14} />{formatDuration(result.elapsedMs)}</span><span>输入 {formatNumber(result.inputTokens)}</span><span>输出 {formatNumber(result.outputTokens)}</span><span>缓存 {formatNumber(result.cacheReadTokens)}</span></footer>
  </section>;
}
