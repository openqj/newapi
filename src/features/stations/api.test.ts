import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeDesktop } = vi.hoisted(() => ({ invokeDesktop: vi.fn() }));
vi.mock("../../lib/tauri", () => ({ invokeDesktop }));

import { stationApi } from "./api";

describe("stationApi", () => {
  beforeEach(() => invokeDesktop.mockReset());

  it("registers a merchant free offer without exposing its redemption code", async () => {
    const request = {
      offerId: "offer-1",
      name: "Example",
      baseUrl: "https://example.com",
      email: "user@example.com",
      password: "password",
      verificationCode: "123456",
      kind: "newapi",
    };

    await stationApi.registerAndRedeemMerchantFreeOffer(request);

    expect(invokeDesktop).toHaveBeenCalledWith("register_and_redeem_merchant_free_offer", { request });
  });
});
