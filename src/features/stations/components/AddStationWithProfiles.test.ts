import { describe, expect, it } from "vitest";
import { normalizeStationBaseUrl } from "./AddStationWithProfiles";

describe("normalizeStationBaseUrl", () => {
  it("keeps only the HTTPS origin for login-page URLs", () => {
    expect(normalizeStationBaseUrl("https://openkun.xyz/sign-in?redirect=%2Fwallet")).toBe("https://openkun.xyz/");
    expect(normalizeStationBaseUrl("https://chat.178266.xyz/login")).toBe("https://chat.178266.xyz/");
  });

  it("adds HTTPS for a bare host", () => {
    expect(normalizeStationBaseUrl("openkun.xyz/login")).toBe("https://openkun.xyz/");
  });
});
