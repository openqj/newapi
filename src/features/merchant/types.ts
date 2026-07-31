export type AccountRole = "member" | "pro" | "merchant" | "admin";
export type MerchantModel = "claude" | "chatgpt" | "grok";

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
  pinned: boolean;
  model?: MerchantModel;
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
  pinned: boolean;
  model?: MerchantModel;
  publishedAt: number;
};

export type AdminMerchantProfile = {
  userId: string;
  merchantName: string;
  qq?: string;
  qqLink?: string;
  wechatQrUrl?: string;
};

export type AdminMerchantProfileInput = AdminMerchantProfile;

export type AdminMerchantRateShare = {
  id: string;
  merchantId: string;
  merchantName: string;
  stationName: string;
  stationUrl: string;
  groupName: string;
  multiplierSummary: string;
  pinned: boolean;
  model?: MerchantModel;
  publishedAt: number;
};

export type AdminMerchantRateShareInput = Omit<AdminMerchantRateShare, "id" | "merchantName" | "publishedAt"> & { id?: string };

export type AdminMerchantFreeAccount = {
  id: string;
  merchantId: string;
  merchantName: string;
  stationName: string;
  stationUrl: string;
  username: string;
  password: string;
  stationKind: "auto" | "newapi" | "sub2api";
  quota: number;
  pinned: boolean;
  model?: MerchantModel;
  claimed: boolean;
  createdAt: number;
};

export type AdminMerchantFreeAccountInput = Omit<AdminMerchantFreeAccount, "id" | "merchantName" | "claimed" | "createdAt"> & { id?: string };

export type ClaimedMerchantAccount = {
  id: string;
  stationName: string;
  stationUrl: string;
  username: string;
  password: string;
  stationKind: "auto" | "newapi" | "sub2api";
};
