export type ModelType =
  | "ChatGPT"
  | "Claude"
  | "Grok"
  | "Gemini"
  | "DeepSeek"
  | "Qwen"
  | "Llama"
  | "混合"
  | "其他"
  | "未知";

const modelFamilies: ReadonlyArray<{ label: Exclude<ModelType, "混合" | "其他" | "未知">; pattern: RegExp }> = [
  { label: "ChatGPT", pattern: /(?:^|[-_:/])(?:gpt|chatgpt)(?:[-_:/]|$)|openai|(?:^|[-_:/])o[134](?:[-_:/]|$)/i },
  { label: "Claude", pattern: /(?:^|[-_:/])claude(?:[-_:/]|$)|anthropic/i },
  { label: "Grok", pattern: /(?:^|[-_:/])grok(?:[-_:/]|$)|xai/i },
  { label: "Gemini", pattern: /(?:^|[-_:/])gemini(?:[-_:/]|$)|google/i },
  { label: "DeepSeek", pattern: /deepseek/i },
  { label: "Qwen", pattern: /qwen|通义/i },
  { label: "Llama", pattern: /llama|meta/i },
];

export function identifyModelType(models: readonly string[]): ModelType {
  const names = models.map((model) => model.trim()).filter(Boolean);
  if (!names.length) return "未知";

  const families = new Set<ModelType>();
  for (const name of names) {
    const family = modelFamilies.find(({ pattern }) => pattern.test(name));
    if (family) families.add(family.label);
  }

  if (families.size === 0) return "其他";
  if (families.size > 1) return "混合";
  return [...families][0];
}

export function modelTypeTitle(models: readonly string[]): string {
  return models.length ? models.join(", ") : "未发现可用模型";
}
