export type AccountRole = "member" | "pro" | "merchant" | "admin";
export type MerchantTier = "diamond" | "gold" | "silver";

export type MerchantProfile = {
  merchantName: string;
  description?: string;
  qq?: string;
  qqLink?: string;
  wechatQrUrl?: string;
  tier?: MerchantTier;
};

export type MerchantRateShare = MerchantProfile & {
  id: string;
  stationName: string;
  stationUrl: string;
  groupName: string;
  multiplierSummary: string;
  pinned: boolean;
  publishedAt: number;
};

export type PublishMerchantRateRequest = {
  stationName: string;
  stationUrl: string;
  groupName: string;
  multiplierSummary: string;
};

export type MerchantFreeCodeInput = {
  stationName: string;
  stationUrl: string;
  redeemCode: string;
  quota: number;
};

export type MerchantImportResult = {
  imported: number;
  skipped: number;
};

export type MerchantFreeOffer = {
  id: string;
  merchantName: string;
  description?: string;
  stationName: string;
  stationUrl: string;
  quota: number;
  pinned: boolean;
  tier?: MerchantTier;
  publishedAt: number;
};

export type AdminMerchantProfile = {
  userId: string;
  merchantName: string;
  description?: string;
  qq?: string;
  qqLink?: string;
  wechatQrUrl?: string;
  tier?: MerchantTier;
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
  publishedAt: number;
};

export type AdminMerchantRateShareInput = Omit<AdminMerchantRateShare, "id" | "merchantName" | "publishedAt"> & { id?: string };

export type AdminMerchantFreeCode = {
  id: string;
  merchantId: string;
  merchantName: string;
  stationName: string;
  stationUrl: string;
  redeemCode: string;
  quota: number;
  pinned: boolean;
  claimed: boolean;
  createdAt: number;
};

export type AdminMerchantFreeCodeInput = Omit<AdminMerchantFreeCode, "id" | "merchantName" | "claimed" | "createdAt"> & { id?: string };

export type ClaimedMerchantCode = {
  id: string;
  stationName: string;
  stationUrl: string;
  redeemCode: string;
};
