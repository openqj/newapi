import { describe, expect, it } from "vitest";
import { parsePasswordRecoveryUrl } from "./PasswordResetDialog";

describe("parsePasswordRecoveryUrl", () => {
  it("accepts only RelayHub recovery deep links with both session tokens", () => {
    expect(parsePasswordRecoveryUrl("relayhub://auth/reset-password#access_token=access&refresh_token=refresh&expires_in=1800&type=recovery"))
      .toEqual({ accessToken: "access", refreshToken: "refresh", expiresIn: 1800 });
    expect(parsePasswordRecoveryUrl("https://example.com/reset#access_token=access&refresh_token=refresh&type=recovery")).toBeNull();
    expect(parsePasswordRecoveryUrl("relayhub://auth/reset-password#access_token=access&type=recovery")).toBeNull();
    expect(parsePasswordRecoveryUrl("relayhub://auth/reset-password#access_token=access&refresh_token=refresh&type=signup")).toBeNull();
  });
});
