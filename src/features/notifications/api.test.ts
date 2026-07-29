import { describe, expect, it } from "vitest";
import { notificationsApi } from "./api";

describe("notificationsApi", () => {
  it("combines sync, warning, and offer messages in newest-first order", () => {
    const messages = notificationsApi.compose({
      stations: [
        { id: "alpha", name: "Alpha", status: "online", lastSyncedAt: 200 },
        { id: "beta", name: "Beta", status: "error", lastSyncedAt: 180, lastError: "登录已失效" },
      ],
      offers: [{ id: "summer", title: "夏季优惠", summary: "限时折扣", publishedAt: 220 }],
      unavailable: ["余额数据"],
      syncing: false,
    });

    expect(messages.map(({ kind }) => kind)).toEqual(["warning", "offer", "sync", "warning"]);
    expect(messages.find(({ id }) => id === "sync-summary-200")?.summary).toBe("1/2 个站点状态正常。");
    expect(messages.find(({ id }) => id === "station-error-beta-180")?.summary).toBe("登录已失效");
  });

  it("shows the active synchronization progress", () => {
    const messages = notificationsApi.compose({
      stations: [{ id: "alpha", name: "Alpha", status: "online" }],
      offers: [],
      unavailable: [],
      syncing: true,
      syncProgress: { operationId: "sync-1", completed: 1, total: 3, currentStation: "Alpha" },
    });

    expect(messages).toMatchObject([{ id: "sync-active-sync-1", kind: "sync", summary: "Alpha · 1/3" }]);
  });
});
