import { CalendarClock, CheckCircle2, ChevronDown, CircleAlert, Clock3, Copy, Database, Gauge, KeyRound, ShieldCheck, XCircle } from "lucide-react";
import type { DetectionCheck, DetectionEvidenceStatus, DetectionResult } from "../types";
import { formatDuration, formatNumber, scoreText } from "../utils";

const checkLabels: Record<string, string> = {
  knowledge_freshness: "知识时效核验",
  model_fingerprint: "型号指纹匹配",
  logic_stability: "逻辑求解稳定性",
  structure_constraints: "结构约束遵循",
  parameter_fidelity: "调用参数保真",
  instruction_hierarchy: "指令层级遵循",
  protocol_fields: "协议字段规范",
  stream_integrity: "流式响应完整性",
};
const orderedCheckNames = Object.keys(checkLabels);

const iconFor = (name: string) => {
  if (name === "knowledge_freshness") return CalendarClock;
  if (name === "model_fingerprint") return ShieldCheck;
  if (name === "logic_stability") return Gauge;
  if (name === "structure_constraints") return Database;
  if (name === "parameter_fidelity") return KeyRound;
  if (name === "instruction_hierarchy") return Copy;
  return name === "stream_integrity" ? Clock3 : ShieldCheck;
};

const statusLabel = (status: DetectionCheck["status"] | DetectionEvidenceStatus) => status === "pass" ? "通过" : status === "warning" ? "需复核" : status === "unsupported" ? "不支持" : "失败";
const sourceLabel = (classification: NonNullable<DetectionResult["source"]>["classification"]) =>
  classification === "official_direct" ? "官方直连" : classification === "compatible_relay" ? "兼容中转" : "未知代理";

const detectionTitle = (model?: string) => {
  const lower = model?.toLowerCase() ?? "";
  if (lower.includes("claude")) return "Claude 鉴定结果";
  if (lower.includes("gpt") || lower.includes("chatgpt")) return "ChatGPT 鉴定结果";
  if (lower.includes("gemini")) return "Gemini 鉴定结果";
  return model ? `${model} 鉴定结果` : "模型鉴定结果";
};

export function DetectionResultPanel({ result, expandedTrace, onToggleTrace }: { result: DetectionResult; expandedTrace?: string; onToggleTrace: (name: string) => void }) {
  const checks = [...result.checks].sort((left, right) => orderedCheckNames.indexOf(left.name) - orderedCheckNames.indexOf(right.name));
  return <section className="api-detection-result" aria-live="polite">
    <header className="api-detection-result-header"><div><h2>{detectionTitle(result.model)}</h2><p className="api-detection-result-subtitle">八项独立探针用于识别接口是否混入其它模型或改变了目标模型行为。</p></div><div className="api-detection-result-header-actions">{result.telemetryAttempted && <span className={`api-detection-telemetry-status${result.telemetryUploaded ? " uploaded" : ""}`}>{result.telemetryUploaded ? "统计已上传" : "统计待重试"}</span>}<button type="button" className="button-secondary api-detection-share" onClick={() => void navigator.clipboard?.writeText(window.location.href)}><Copy size={14} />分享链接</button></div></header>
    <div className="api-detection-result-body">
      <aside className="api-detection-result-summary">
        <div className="api-detection-result-model"><span>检测模型</span><strong>{result.model ?? "目标模型"}</strong></div>
        <div className={`api-detection-score ${result.score >= 88 ? "good" : result.score >= 60 ? "warn" : "bad"}`}><small>综合可信度</small><strong>{result.score}%</strong><span>{scoreText(result.score)}</span></div>
        <dl className="api-detection-result-meta"><div><dt><Clock3 size={14} />检测时间</dt><dd>{result.detectedAt ? new Date(result.detectedAt).toLocaleString("zh-CN", { hour12: false }) : "刚刚"}</dd></div><div><dt><ShieldCheck size={14} />检测站</dt><dd>{result.endpoint ?? "当前接口"}</dd></div></dl>
        <a href="#" onClick={(event) => event.preventDefault()}>查看同类推荐 ↑</a>
      </aside>
      <div className="api-detection-checks">{checks.map((check, index) => {
        const checkName = checkLabels[check.name] ? check.name : orderedCheckNames[index];
        const Icon = check.status === "pass" ? CheckCircle2 : check.status === "warning" ? CircleAlert : XCircle;
        const LeadingIcon = iconFor(checkName);
        return <div className={`api-detection-check ${check.status}`} key={`${check.name}-${index}`}><Icon className="api-detection-check-status-icon" size={17} /><LeadingIcon className="api-detection-check-type-icon" size={15} /><div><strong>{checkLabels[checkName] ?? check.name}</strong><p>{check.detail}</p>{check.trace && <><button type="button" className="api-detection-trace-button" onClick={() => onToggleTrace(check.name)}>响应摘要 <ChevronDown size={14} /></button>{expandedTrace === check.name && <pre>{check.trace}</pre>}</>}</div><b>{statusLabel(check.status)}</b></div>;
      })}</div>
    </div>
    {(result.source || result.behavior) && <section className="api-detection-evidence">
      {result.source && <div className="api-detection-evidence-column"><header><div><span>来源层</span><strong>{sourceLabel(result.source.classification)} · {result.source.score}%</strong></div><b>{Math.round(result.source.confidence * 100)}% 证据置信度</b></header><div className="api-detection-evidence-list">{result.source.signals.map((signal) => <div key={signal.id} className={signal.status}><strong>{signal.name}</strong><span>{signal.detail}</span><b>{statusLabel(signal.status)}</b></div>)}</div></div>}
      {result.behavior && <div className="api-detection-evidence-column"><header><div><span>行为指纹层</span><strong>{result.behavior.score}%</strong></div><b>重复置信度 {Math.round(result.behavior.confidence * 100)}%</b></header><div className="api-detection-evidence-list">{result.behavior.probes.map((probe) => <div key={probe.id} className={probe.status}><strong>{probe.name}</strong><span>{probe.detail}</span><b>{statusLabel(probe.status)}</b></div>)}</div></div>}
    </section>}
    <footer className="api-detection-result-metrics"><div><span>延迟</span><strong>{formatDuration(result.elapsedMs)}</strong></div><div><span>Tokens/秒</span><strong>{result.tokensPerSecond?.toFixed(1) ?? "-"}</strong></div><div className="alert"><span>输入 Tokens</span><strong>{formatNumber(result.inputTokens ?? 0)}</strong></div><div><span>输出 Tokens</span><strong>{formatNumber(result.outputTokens ?? 0)}</strong></div><div className="alert"><span>缓存读取 Tokens</span><strong>{formatNumber(result.cacheReadTokens ?? 0)}</strong></div></footer>
  </section>;
}
