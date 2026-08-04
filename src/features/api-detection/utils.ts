import type { DetectionResult, DetectionStatus } from "./types";

export const modelOptions = [
  { label: "Opus 5", value: "claude-opus-5", protocol: "anthropic", isNew: true },
  { label: "Fable 5", value: "claude-fable-5", protocol: "anthropic" },
  { label: "Opus 4.8", value: "claude-opus-4-8", protocol: "anthropic" },
  { label: "Sonnet 5", value: "claude-sonnet-5", protocol: "anthropic" },
  { label: "GPT 5.6 Sol", value: "gpt-5.6-sol", protocol: "openai", isNew: true },
  { label: "GPT 5.6 Terra", value: "gpt-5.6-terra", protocol: "openai", isNew: true },
  { label: "GPT 5.5", value: "gpt-5.5", protocol: "openai" },
  { label: "Gemini 3.1 Pro", value: "gemini-3.1-pro", protocol: "openai" },
];

export const protocolForModel = (model: string) =>
  modelOptions.find((option) => option.value === model)?.protocol ??
  (model.toLowerCase().includes("claude") ? "anthropic" : "openai");

export const scoreText = (score: number) =>
  score >= 88 ? "综合可信度高" : score >= 60 ? "综合可信度中等" : "综合可信度较低";
export const statusText = (status: DetectionStatus) =>
  status === "pass" ? "通过" : status === "warning" ? "部分合格" : "失败";

export const endpointDisplay = (endpoint: string) => {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint.replace(/^https?:\/\//i, "").split("/")[0] || "-";
  }
};

export const formatHistoryTime = (time: number) => {
  const date = new Date(time);
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

export const formatDuration = (elapsedMs: number) => `${(elapsedMs / 1000).toFixed(1)}s`;
export const formatNumber = (value: number) => new Intl.NumberFormat("zh-CN").format(value);
export const formatCost = (value?: number) => value === undefined ? "-" : value.toFixed(6);

export const demoResult: DetectionResult = {
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

demoResult.checks = [
  { name: "knowledge_freshness", status: "pass", detail: "当前日期知识时效探针响应正常" },
  { name: "model_fingerprint", status: "pass", detail: "模型自述与目标型号家族一致" },
  { name: "logic_stability", status: "pass", detail: "两次逻辑探针结果一致" },
  { name: "structure_constraints", status: "pass", detail: "受控 JSON 响应符合结构约束" },
  { name: "parameter_fidelity", status: "pass", detail: "请求模型与协议参数被正确接收" },
  { name: "instruction_hierarchy", status: "warning", detail: "指令层级探针需要结合响应复核" },
  { name: "protocol_fields", status: "pass", detail: "协议字段与响应元数据规范" },
  { name: "stream_integrity", status: "pass", detail: "流式响应内容完整" },
];
