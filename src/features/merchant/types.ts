export type AccountRole = "member" | "pro" | "merchant" | "admin";

export type MerchantProfile = {
  merchantName: string;
  qq?: string;
  qqLink?: string;
  wechatQrUrl?: string;
};

export type MerchantRateShare = MerchantProfile & {
  id: string;
  stationName: string;
  stationUrl: string;
  groupName: string;
  multiplierSummary: string;
  publishedAt: number;
};

export type PublishMerchantRateRequest = {
  stationName: string;
  stationUrl: string;
  groupName: string;
  multiplierSummary: string;
};

export type MerchantFreeAccountInput = {
  stationName: string;
  stationUrl: string;
  username: string;
  password: string;
  stationKind: "auto" | "newapi" | "sub2api";
  quota: number;
};

export type MerchantFreeOffer = {
  id: string;
  merchantName: string;
  stationName: string;
  stationUrl: string;
  quota: number;
  publishedAt: number;
};

export type ClaimedMerchantAccount = {
  id: string;
  stationName: string;
  stationUrl: string;
  username: string;
  password: string;
  stationKind: "auto" | "newapi" | "sub2api";
};
