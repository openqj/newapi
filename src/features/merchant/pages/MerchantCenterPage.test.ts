import { describe, expect, it } from "vitest";
import { buildMerchantCodeBatch, canPublishMerchantRate } from "./MerchantCenterPage";

describe("canPublishMerchantRate", () => {
  const values = {
    stationName: "Example",
    stationUrl: "https://example.com",
    groupName: "default",
    multiplierSummary: "1x",
    rechargeUrl: "https://example.com/recharge",
    oneToOneRecharge: true,
    officialPricing: true,
  };

  it("requires both merchant commitments", () => {
    expect(canPublishMerchantRate(values)).toBe(true);
    expect(canPublishMerchantRate({ ...values, oneToOneRecharge: false })).toBe(false);
    expect(canPublishMerchantRate({ ...values, officialPricing: false })).toBe(false);
  });
});

describe("buildMerchantCodeBatch", () => {
  it("requires a future expiry date for all imported codes", () => {
    const expiresAt = "2099-12-31T23:59";
    const codes = buildMerchantCodeBatch({ stationName: "Example", stationUrl: "https://example.com", quota: "1", expiresAt, codes: "FREE-1\nFREE-2" });

    expect(codes).toHaveLength(2);
    expect(codes[0].expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(() => buildMerchantCodeBatch({ stationName: "Example", stationUrl: "https://example.com", quota: "1", expiresAt: "2020-01-01T00:00", codes: "FREE-1" })).toThrow("有效期");
  });
});
