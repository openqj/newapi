import type { AdminMerchantFreeAccount, AdminMerchantProfile, AdminMerchantRateShare, MerchantFreeOffer, MerchantModel, MerchantRateShare } from "./types";

const demoCount = 50;
const demoModels: MerchantModel[] = ["claude", "chatgpt", "grok"];

export const demoMerchantRates: MerchantRateShare[] = Array.from({ length: demoCount }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return {
    id: `demo-rate-${number}`,
    model: demoModels[index % demoModels.length],
    merchantName: `模拟商家 ${number}`,
    stationName: `模拟中转站 ${number}`,
    stationUrl: `https://demo-${number}.example.com`,
    groupName: `GPT 分组 ${number}`,
    multiplierSummary: (0.5 + (index % 10) * 0.1).toFixed(1),
    pinned: index < 2,
    publishedAt: Date.now() - index * 86_400_000,
    qq: `1000${String(index + 1).padStart(4, "0")}`,
  };
});

export const demoMerchantOffers: MerchantFreeOffer[] = Array.from({ length: demoCount }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return {
    id: `demo-offer-${number}`,
    model: demoModels[index % demoModels.length],
    merchantName: `模拟商家 ${number}`,
    stationName: `免费额度站 ${number}`,
    stationUrl: `https://free-${number}.example.com`,
    quota: 10 + index * 2.5,
    pinned: index < 2,
    publishedAt: Date.now() - index * 86_400_000,
  };
});

export const DEMO_MERCHANT_STORAGE_KEY = "relayhub-demo-merchant-marketplace";
export const DEMO_MERCHANT_CHANGED_EVENT = "relayhub:merchant-marketplace-changed";

export type DemoMerchantState = {
  profiles: AdminMerchantProfile[];
  rates: AdminMerchantRateShare[];
  accounts: AdminMerchantFreeAccount[];
};

const demoProfile = (index: number): AdminMerchantProfile => {
  const number = String(index + 1).padStart(2, "0");
  return { userId: `demo-merchant-${number}`, merchantName: `模拟商家 ${number}`, qq: `1000${String(index + 1).padStart(4, "0")}`, qqLink: `https://qm.qq.com/demo-${number}`, wechatQrUrl: `https://demo-${number}.example.com/wechat-qr.png` };
};

export function createDemoMerchantState(): DemoMerchantState {
  const profiles = Array.from({ length: demoCount }, (_, index) => demoProfile(index));
  return {
    profiles,
    rates: demoMerchantRates.map((item, index) => ({ id: item.id, merchantId: profiles[index].userId, merchantName: item.merchantName, stationName: item.stationName, stationUrl: item.stationUrl, groupName: item.groupName, multiplierSummary: item.multiplierSummary, pinned: item.pinned, model: item.model, publishedAt: item.publishedAt })),
    accounts: demoMerchantOffers.map((item, index) => ({ id: item.id.replace("demo-offer", "demo-account"), merchantId: profiles[index].userId, merchantName: item.merchantName, stationName: item.stationName, stationUrl: item.stationUrl, username: `demo-user-${String(index + 1).padStart(2, "0")}`, password: "demo-password", stationKind: "auto", quota: item.quota, pinned: item.pinned, model: item.model, claimed: false, createdAt: item.publishedAt })),
  };
}

export function loadDemoMerchantState(): DemoMerchantState {
  if (typeof window === "undefined") return createDemoMerchantState();
  try {
    const raw = window.localStorage.getItem(DEMO_MERCHANT_STORAGE_KEY);
    if (!raw) return createDemoMerchantState();
    const parsed = JSON.parse(raw) as DemoMerchantState;
    if (!Array.isArray(parsed.profiles) || !Array.isArray(parsed.rates) || !Array.isArray(parsed.accounts)) return createDemoMerchantState();
    return parsed;
  } catch {
    return createDemoMerchantState();
  }
}

export function saveDemoMerchantState(state: DemoMerchantState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(DEMO_MERCHANT_STORAGE_KEY, JSON.stringify(state));
}

export function demoMarketplaceData(state = loadDemoMerchantState()): { rates: MerchantRateShare[]; offers: MerchantFreeOffer[] } {
  const profiles = new Map(state.profiles.map((profile) => [profile.userId, profile]));
  return {
    rates: state.rates.map((item) => {
      const profile = profiles.get(item.merchantId);
      return { ...item, merchantName: profile?.merchantName ?? item.merchantName, qq: profile?.qq, qqLink: profile?.qqLink, wechatQrUrl: profile?.wechatQrUrl };
    }),
    offers: state.accounts.filter((item) => !item.claimed).map((item) => {
      const profile = profiles.get(item.merchantId);
      return { id: item.id, merchantName: profile?.merchantName ?? item.merchantName, stationName: item.stationName, stationUrl: item.stationUrl, quota: item.quota, pinned: item.pinned, model: item.model, publishedAt: item.createdAt };
    }),
  };
}
