import { CheckCircle2, ChevronDown, CircleAlert, XCircle } from "lucide-react";
import type { DetectionResult } from "../types";
import { scoreText } from "../utils";

export function DetectionResultPanel({ result, expandedTrace, onToggleTrace }: { result: DetectionResult; expandedTrace?: string; onToggleTrace: (name: string) => void }) {
  return <section className="api-detection-result" aria-live="polite">
    <div className="api-detection-result-summary"><div className={`api-detection-score ${result.score >= 88 ? "good" : result.score >= 60 ? "warn" : "bad"}`}><span>可信度线索</span><strong>{result.score}</strong><small>/ 100</small></div><div><h2>{scoreText(result.score)}</h2><p>检测耗时 {result.elapsedMs} ms。结果反映接口行为线索，不能替代模型提供方的正式证明。</p></div></div>
    <div className="api-detection-checks">{result.checks.map((check) => {
      const Icon = check.status === "pass" ? CheckCircle2 : check.status === "warning" ? CircleAlert : XCircle;
      return <div className={`api-detection-check ${check.status}`} key={check.name}><Icon size={18} /><div><strong>{check.name}</strong><p>{check.detail}</p>{check.trace && <><button type="button" className="api-detection-trace-button" onClick={() => onToggleTrace(check.name)}>响应摘要 <ChevronDown size={14} /></button>{expandedTrace === check.name && <pre>{check.trace}</pre>}</>}</div></div>;
    })}</div>
  </section>;
}
