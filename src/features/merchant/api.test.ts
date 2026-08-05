import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeDesktop } = vi.hoisted(() => ({ invokeDesktop: vi.fn() }));
vi.mock("../../lib/tauri", () => ({ invokeDesktop }));

import { merchantApi } from "./api";

describe("merchantApi", () => {
  beforeEach(() => invokeDesktop.mockReset());

  it("uses the protected rate publishing command", async () => {
    const request = {
      stationName: "Example",
      stationUrl: "https://example.com",
      groupName: "default",
      multiplierSummary: "1x",
      rechargeUrl: "https://example.com/recharge",
      oneToOneRecharge: true,
      officialPricing: true,
    };
    invokeDesktop.mockResolvedValueOnce({ rateShareId: "rate-1" });

    await merchantApi.publishRate(request);

    expect(invokeDesktop).toHaveBeenNthCalledWith(1, "publish_merchant_rate_share", { request });
  });

  it("keeps free-offer redemption inside the desktop command", async () => {
    await merchantApi.claimAndRedeemFreeOffer("offer-1", "station-1");

    expect(invokeDesktop).toHaveBeenCalledWith("claim_and_redeem_merchant_free_offer", { offerId: "offer-1", stationId: "station-1" });
  });

  it("uses a protected command for admin code access", async () => {
    invokeDesktop.mockResolvedValueOnce("FREE-CODE-1");

    await merchantApi.revealAdminFreeCode("code-1", "copy");

    expect(invokeDesktop).toHaveBeenCalledWith("reveal_admin_merchant_free_code", { id: "code-1", accessMode: "copy" });
  });
});
