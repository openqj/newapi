import { describe, expect, it } from "vitest";
import { identifyModelType } from "./modelType";

describe("identifyModelType", () => {
  it("识别 ChatGPT、Claude 和 Grok 模型", () => {
    expect(identifyModelType(["gpt-4o"])).toBe("ChatGPT");
    expect(identifyModelType(["claude-sonnet-4-5"])).toBe("Claude");
    expect(identifyModelType(["grok-4"])).toBe("Grok");
  });

  it("识别混合模型和未知模型", () => {
    expect(identifyModelType(["gpt-4o", "claude-sonnet-4-5"])).toBe("混合");
    expect(identifyModelType(["custom-relay-model"])).toBe("其他");
    expect(identifyModelType([])).toBe("未知");
  });
});
