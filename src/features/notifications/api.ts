import type { NotificationMessage, NotificationPreferences, NotificationSource } from "./types";

const toMillis = (value?: number) => value ? value * 1000 : Date.now();

export const notificationsApi = {
  compose({ stations, offers, unavailable, syncing, syncProgress }: NotificationSource, preferences: NotificationPreferences = {}): NotificationMessage[] {
    const latestSyncAt = Math.max(0, ...stations.map((station) => station.lastSyncedAt ?? 0));
    const syncMessages: NotificationMessage[] = [];

    if (syncing) {
      const completed = syncProgress?.completed ?? 0;
      const total = syncProgress?.total ?? stations.length;
      syncMessages.push({
        id: `sync-active-${syncProgress?.operationId ?? "current"}`,
        kind: "sync",
        title: "站点同步进行中",
        summary: `${syncProgress?.currentStation ?? "准备中"} · ${completed}/${total}`,
        createdAt: Date.now(),
        destination: "overview",
      });
    } else if (latestSyncAt) {
      const successful = stations.filter((station) => station.status === "online").length;
      syncMessages.push({
        id: `sync-summary-${latestSyncAt}`,
        kind: "sync",
        title: "站点同步已完成",
        summary: `${successful}/${stations.length} 个站点状态正常。`,
        createdAt: toMillis(latestSyncAt),
        destination: "overview",
      });
    }

    const warningMessages = [
      ...stations.filter((station) => station.lastError).map((station) => ({
        id: `station-error-${station.id}-${station.lastSyncedAt ?? 0}`,
        kind: "warning" as const,
        title: `${station.name} 同步需要处理`,
        summary: station.lastError ?? "站点数据暂不可用。",
        createdAt: toMillis(station.lastSyncedAt),
        destination: "overview" as const,
      })),
      ...(unavailable.length ? [{
        id: `unavailable-${unavailable.join("|")}`,
        kind: "warning" as const,
        title: "部分数据未能同步",
        summary: unavailable.join("；"),
        createdAt: Date.now(),
        destination: "overview" as const,
      }] : []),
    ];

    const offerMessages = offers.map((offer) => ({
      id: `offer-${offer.id}`,
      kind: "offer" as const,
      title: offer.title,
      summary: offer.summary || "查看站点公告了解详情。",
      createdAt: toMillis(offer.publishedAt),
      destination: "offers" as const,
    }));

    return [
      ...(preferences.syncEnabled === false ? [] : syncMessages),
      ...(preferences.alertEnabled === false ? [] : warningMessages),
      ...(preferences.offerEnabled === false ? [] : offerMessages),
    ]
      .sort((left, right) => right.createdAt - left.createdAt);
  },
};
