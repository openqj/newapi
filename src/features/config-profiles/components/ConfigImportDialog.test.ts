import { describe, expect, it } from "vitest";
import { identifyClientApplication, parseConfigImportUrl } from "./ConfigImportDialog";

describe("config deep-link import", () => {
  it("parses the CC Switch provider link without losing encoded values", () => {
    const result = parseConfigImportUrl(
      "relayhub://v1/import?resource=provider&app=claude&name=Daily%20Claude&endpoint=https%3A%2F%2Frelay.example%2Fv1&apiKey=sk-test-1234&model=claude-sonnet-4-5&protocol=anthropic",
    );

    expect(result).toMatchObject({
      application: "claude",
      name: "Daily Claude",
      baseUrl: "https://relay.example/v1",
      apiKey: "sk-test-1234",
      model: "claude-sonnet-4-5",
      protocol: "anthropic",
      detectedBy: "explicit",
    });
  });

  it("infers Gemini when the app field is absent", () => {
    const result = parseConfigImportUrl(
      "relayhub://v1/import?resource=provider&name=Gemini&endpoint=https%3A%2F%2Frelay.example%2Fv1&apiKey=gem-key&model=gemini-2.5-pro",
    );

    expect(result?.application).toBe("gemini");
    expect(result?.detectedBy).toBe("inferred");
  });

  it("ignores unrelated links and rejects unsupported applications", () => {
    expect(parseConfigImportUrl("relayhub://auth/reset-password#type=recovery")).toBeNull();
    expect(
      parseConfigImportUrl("relayhub://v1/import?resource=provider&app=unknown&endpoint=https%3A%2F%2Frelay.example&apiKey=key"),
    ).toBeNull();
  });

  it("supports common application aliases", () => {
    expect(identifyClientApplication("claude-code")?.application).toBe("claude");
    expect(identifyClientApplication("openai")?.application).toBe("codex");
    expect(identifyClientApplication("gemini-cli")?.application).toBe("gemini");
  });
});
