import { invokeDesktop } from "../../lib/tauri";
import type { AdminMerchantFreeCode, AdminMerchantFreeCodeInput, AdminMerchantProfile, AdminMerchantProfileInput, AdminMerchantRateShare, AdminMerchantRateShareInput, ClaimedMerchantCode, MerchantFreeCodeInput, MerchantFreeOffer, MerchantImportResult, MerchantProfile, MerchantRateShare, PublishMerchantRateRequest } from "./types";

export const MERCHANT_IMPORT_REQUEST_EVENT = "relayhub:merchant-import-request";
export const MERCHANT_OFFERS_CHANGED_EVENT = "relayhub:merchant-offers-changed";

export const merchantApi = {
  profile: () => invokeDesktop<MerchantProfile | null>("get_merchant_profile"),
  saveProfile: (profile: MerchantProfile) => invokeDesktop<MerchantProfile>("save_merchant_profile", { profile }),
  rates: () => invokeDesktop<MerchantRateShare[]>("list_merchant_rate_shares"),
  publishRate: (request: PublishMerchantRateRequest) => invokeDesktop<void>("publish_merchant_rate_share", { request }),
  importCodes: (codes: MerchantFreeCodeInput[]) => invokeDesktop<MerchantImportResult>("import_merchant_free_codes", { codes }),
  freeOffers: () => invokeDesktop<MerchantFreeOffer[]>("list_merchant_free_offers"),
  claimCode: (offerId: string) => invokeDesktop<ClaimedMerchantCode>("claim_merchant_free_code", { offerId }),
  releaseCode: (offerId: string) => invokeDesktop<void>("release_merchant_free_code", { offerId }),
  adminProfiles: () => invokeDesktop<AdminMerchantProfile[]>("list_admin_merchant_profiles"),
  saveAdminProfile: (profile: AdminMerchantProfileInput) => invokeDesktop<void>("save_admin_merchant_profile", { profile }),
  adminRates: () => invokeDesktop<AdminMerchantRateShare[]>("list_admin_merchant_rate_shares"),
  saveAdminRate: (share: AdminMerchantRateShareInput) => invokeDesktop<void>("save_admin_merchant_rate_share", { share }),
  deleteAdminRate: (id: string) => invokeDesktop<void>("delete_admin_merchant_rate_share", { id }),
  adminFreeCodes: () => invokeDesktop<AdminMerchantFreeCode[]>("list_admin_merchant_free_codes"),
  saveAdminFreeCode: (code: AdminMerchantFreeCodeInput) => invokeDesktop<void>("save_admin_merchant_free_code", { code }),
  deleteAdminFreeCode: (id: string) => invokeDesktop<void>("delete_admin_merchant_free_code", { id }),
};
