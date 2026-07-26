import { FormEvent, useMemo, useState } from "react";
import { detectModelAuthenticity } from "../features/api-detection/api";
import type {
  DetectionResult,
  DetectionStatus,
  SavedApiKeyRow,
} from "../features/api-detection/types";
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Eye,
  EyeOff,
  KeyRound,
  Play,
  Search,
  XCircle,
} from "lucide-react";

type HistoryItem = DetectionResult & {
  id: string;
  endpoint: string;
  model: string;
  createdAt: number;
};


const modelOptions = [
  { label: "Opus 5", value: "claude-opus-5", protocol: "anthropic", isNew: true },
  { label: "Fable 5", value: "claude-fable-5", protocol: "anthropic" },
  { label: "Opus 4.8", value: "claude-opus-4-8", protocol: "anthropic" },
  { label: "Sonnet 5", value: "claude-sonnet-5", protocol: "anthropic" },
  { label: "GPT 5.6 Sol", value: "gpt-5.6-sol", protocol: "openai", isNew: true },
  { label: "GPT 5.6 Terra", value: "gpt-5.6-terra", protocol: "openai", isNew: true },
  { label: "GPT 5.5", value: "gpt-5.5", protocol: "openai" },
  { label: "Gemini 3.1 Pro", value: "gemini-3.1-pro", protocol: "openai" },
];

const protocolForModel = (model: string) =>
  modelOptions.find((option) => option.value === model)?.protocol ??
  (model.toLowerCase().includes("claude") ? "anthropic" : "openai");

const scoreText = (score: number) =>
  score >= 88 ? "信号良好" : score >= 60 ? "需要复核" : "风险较高";
const statusText = (status: DetectionStatus) =>
  status === "pass" ? "通过" : status === "warning" ? "部分合格" : "失败";

const endpointDisplay = (endpoint: string) => {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint.replace(/^https?:\/\//i, "").split("/")[0] || "-";
  }
};

const formatHistoryTime = (time: number) => {
  const date = new Date(time);
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

const formatDuration = (elapsedMs: number) => `${(elapsedMs / 1000).toFixed(1)}s`;
const formatNumber = (value: number) => new Intl.NumberFormat("zh-CN").format(value);

const demoResult: DetectionResult = {
  score: 88,
  elapsedMs: 1280,
  tokensPerSecond: 37.2,
  inputTokens: 1180,
  outputTokens: 312,
  cacheReadTokens: 0,
  checks: [
    { name: "协议响应", status: "pass", detail: "请求格式与受支持协议一致" },
    { name: "结构一致性", status: "pass", detail: "受控 JSON 响应符合预期" },
    { name: "身份信号", status: "warning", detail: "模型自述无法确认目标家族" },
    { name: "受控输出", status: "pass", detail: "两次确定性探针均符合预期" },
  ],
};

export function ApiDetectionPage({ keyRows }: { keyRows: SavedApiKeyRow[] }) {
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [savedKeyId, setSavedKeyId] = useState("");
  const [model, setModel] = useState(modelOptions[1].value);
  const [showKey, setShowKey] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DetectionResult>();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [expandedTrace, setExpandedTrace] = useState<string>();
  const [expandedHistoryId, setExpandedHistoryId] = useState<string>();

  const selectedSavedKey = useMemo(
    () => keyRows.find((row) => `${row.stationId}-${row.key.id}` === savedKeyId),
    [keyRows, savedKeyId],
  );

  const chooseSavedKey = (value: string) => {
    setSavedKeyId(value);
    const next = keyRows.find((row) => `${row.stationId}-${row.key.id}` === value);
    if (!next) return;
    setEndpoint(next.stationUrl);
    setApiKey("");
    if (next.models[0]) setModel(next.models[0]);
  };

  const runDetection = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if ((!savedKeyId && (!endpoint.trim() || !apiKey.trim())) || !model.trim()) {
      setError("请填写接口地址、API Key 和目标模型。");
      return;
    }
    setError("");
    setRunning(true);
    setResult(undefined);
    setExpandedTrace(undefined);
    try {
      const protocol = protocolForModel(model);
      const next = await detectModelAuthenticity(
        savedKeyId && selectedSavedKey
          ? { model, protocol, stationId: selectedSavedKey.stationId, keyId: selectedSavedKey.key.id }
          : { endpoint, apiKey, model, protocol },
        demoResult,
      );
      const item: HistoryItem = {
        ...next,
        id: `${Date.now()}`,
        endpoint,
        model,
        createdAt: Date.now(),
      };
      setResult(next);
      setExpandedHistoryId(item.id);
      setHistory((current) => [item, ...current].slice(0, 8));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setRunning(false);
    }
  };

  const selectHistoryItem = (item: HistoryItem) => {
    setExpandedHistoryId((current) => current === item.id ? undefined : item.id);
    setExpandedTrace(undefined);
    setResult(item);
  };

  return (
    <div className="api-detection-page">
      <section className="api-detection-main-module">
        <form className="api-detection-config" onSubmit={runDetection}>
        <div className="api-detection-config-header">
          <div>
            <h2>接口配置</h2>
            <p>API Key 只用于本次检测请求，不会保存到本地。</p>
          </div>
        </div>

        <div className="api-detection-fields">
          <label className="api-detection-saved-key">
            <span>使用本项目 API Key</span>
            <select className={savedKeyId ? undefined : "placeholder"} value={savedKeyId} onChange={(event) => chooseSavedKey(event.target.value)}>
              <option value="">手动填写临时 API Key</option>
              {keyRows.map((row) => (
                <option key={`${row.stationId}-${row.key.id}`} value={`${row.stationId}-${row.key.id}`}>
                  {row.stationName} / {row.key.name || "未命名密钥"} / {row.key.maskedKey}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>API 接口地址</span>
            <div className="api-detection-input">
              <Search size={16} />
              <input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://api.anthropic.com" inputMode="url" autoComplete="url" />
            </div>
          </label>
          <label>
            <span>API Key</span>
            <div className="api-detection-input key-input">
              <KeyRound size={16} />
              <input type={showKey ? "text" : "password"} value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={selectedSavedKey ? "将从安全存储按需读取" : "sk-..."} autoComplete="off" disabled={Boolean(selectedSavedKey)} />
              <button type="button" className="icon-button" onClick={() => setShowKey((value) => !value)} title={showKey ? "隐藏 API Key" : "显示 API Key"} aria-label={showKey ? "隐藏 API Key" : "显示 API Key"} disabled={Boolean(selectedSavedKey)}>
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>
        </div>

        <div className="api-detection-models">
          <div className="api-detection-model-label"><span>目标模型</span></div>
          <div className="api-detection-model-grid" role="list">
            {modelOptions.map((option) => (
              <button type="button" key={option.value} className={`${model === option.value ? "selected " : ""}${option.isNew ? "has-new" : ""}`} onClick={() => setModel(option.value)} role="listitem">
                {option.isNew && <span className="api-detection-model-new">NEW</span>}
                <strong>{option.label}</strong>
                <small>{option.value}</small>
                {model === option.value && <CheckCircle2 size={15} />}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="api-detection-error" role="alert"><CircleAlert size={16} /> {error}</p>}
        <footer className="api-detection-actions">
          <span>将发送 4 个短探针请求</span>
          <button className="button-primary" disabled={running}><Play size={16} />{running ? "检测中" : "开始检测"}</button>
        </footer>
        </form>

      {result && (
        <section className="api-detection-result" aria-live="polite">
          <div className="api-detection-result-summary">
            <div className={`api-detection-score ${result.score >= 88 ? "good" : result.score >= 60 ? "warn" : "bad"}`}>
              <span>可信度线索</span><strong>{result.score}</strong><small>/ 100</small>
            </div>
            <div><h2>{scoreText(result.score)}</h2><p>检测耗时 {result.elapsedMs} ms。结果反映接口行为线索，不能替代模型提供方的正式证明。</p></div>
          </div>
          <div className="api-detection-checks">
            {result.checks.map((check) => {
              const Icon = check.status === "pass" ? CheckCircle2 : check.status === "warning" ? CircleAlert : XCircle;
              return (
                <div className={`api-detection-check ${check.status}`} key={check.name}>
                  <Icon size={18} />
                  <div><strong>{check.name}</strong><p>{check.detail}</p>
                    {check.trace && <><button type="button" className="api-detection-trace-button" onClick={() => setExpandedTrace(expandedTrace === check.name ? undefined : check.name)}>响应摘要 <ChevronDown size={14} /></button>{expandedTrace === check.name && <pre>{check.trace}</pre>}</>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
      </section>

      <section className="api-detection-history" aria-label="本次检测历史">
        <div className="api-detection-history-header">
          <h2>最近检测</h2>
          {history.length > 0 && <button type="button" onClick={() => { setHistory([]); setExpandedHistoryId(undefined); }}>清空</button>}
        </div>
        {history.length === 0 ? (
          <p className="api-detection-history-empty">本次检测结果会显示在这里。</p>
        ) : (
          <div className="api-detection-history-list">
            {history.map((item) => {
              const expanded = expandedHistoryId === item.id;
              return (
                <article className={`api-detection-history-item${expanded ? " expanded" : ""}`} key={item.id}>
                  <button type="button" className="api-detection-history-row" onClick={() => selectHistoryItem(item)} aria-expanded={expanded}>
                    <time>{formatHistoryTime(item.createdAt)}</time>
                    <strong title={item.model}>{item.model}</strong>
                    <span title={endpointDisplay(item.endpoint)}>{endpointDisplay(item.endpoint)}</span>
                    <b>{item.score}%</b>
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                  {expanded && (
                    <div className="api-detection-history-detail">
                      <div className="api-detection-history-score"><span>评分</span><strong>{item.score}%</strong></div>
                      <div className="api-detection-history-checks">
                        {item.checks.map((check) => <div key={`${item.id}-${check.name}`}><span>{check.name}</span><b className={check.status}>{statusText(check.status)}</b></div>)}
                      </div>
                      <dl className="api-detection-history-metrics">
                        <div><dt>延迟</dt><dd>{formatDuration(item.elapsedMs)}</dd></div>
                        {item.tokensPerSecond !== undefined && <div><dt>Tokens/秒</dt><dd>{item.tokensPerSecond.toFixed(1)}</dd></div>}
                        {item.inputTokens !== undefined && <div><dt>输入 Tokens</dt><dd>{formatNumber(item.inputTokens)}</dd></div>}
                        {item.outputTokens !== undefined && <div><dt>输出 Tokens</dt><dd>{formatNumber(item.outputTokens)}</dd></div>}
                        {item.cacheReadTokens !== undefined && <div><dt>缓存读取 Tokens</dt><dd>{formatNumber(item.cacheReadTokens)}</dd></div>}
                      </dl>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
