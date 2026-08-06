import { describe, expect, it } from "vitest";
import {
  auditActionLabel,
  auditActorLabel,
  maskRedeemCode,
  membershipEffectiveStatus,
  membershipEnabledLabel,
  membershipStatusLabel,
} from "./audit";

describe("personal center audit helpers", () => {
  it("keeps enabled and effective membership states separate", () => {
    expect(membershipEffectiveStatus({ enabled: true, expiresAt: Date.now() - 1 })).toBe("expired");
    expect(membershipEnabledLabel(true)).toBe("已启用");
    expect(membershipStatusLabel("expired")).toBe("已过期");
    expect(membershipEffectiveStatus({ enabled: false })).toBe("disabled");
    expect(membershipStatusLabel("active")).toBe("当前有效");
  });

  it("translates audit actions and preserves operator identity", () => {
    expect(auditActionLabel("membership.updated")).toBe("修改会员权限");
    expect(auditActionLabel("notification.revoked")).toBe("撤回云端通知");
    expect(auditActorLabel({ actorEmail: "admin@example.com", actorId: "admin-1" })).toBe("admin@example.com");
  });

  it("masks short and long redemption codes", () => {
    expect(maskRedeemCode("abc123")).toBe("******");
    expect(maskRedeemCode("abcdefghi")).toBe("abc******ghi");
  });
});
