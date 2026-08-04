import { invokeDesktop } from "../../lib/tauri";
import type { AdminMerchantFreeCode, AdminMerchantFreeCodeInput, AdminMerchantProfile, AdminMerchantProfileInput, AdminMerchantRateShare, AdminMerchantRateShareInput, MerchantFreeCodeInput, MerchantFreeOffer, MerchantImportResult, MerchantProfile, MerchantRatePublishResult, MerchantRateShare, PublishMerchantRateRequest } from "./types";

export const MERCHANT_FREE_CLAIM_REQUEST_EVENT = "relayhub:merchant-free-claim-request";
export const MERCHANT_FREE_CLAIM_RESULT_EVENT = "relayhub:merchant-free-claim-result";
export const MERCHANT_OFFERS_CHANGED_EVENT = "relayhub:merchant-offers-changed";
export const MERCHANT_RATE_REGISTER_REQUEST_EVENT = "relayhub:merchant-rate-register-request";

export const merchantApi = {
  profile: () => invokeDesktop<MerchantProfile | null>("get_merchant_profile"),
  saveProfile: (profile: MerchantProfile) => invokeDesktop<MerchantProfile>("save_merchant_profile", { profile }),
  rates: () => invokeDesktop<MerchantRateShare[]>("list_merchant_rate_shares"),
  publishRate: (request: PublishMerchantRateRequest) => invokeDesktop<MerchantRatePublishResult>("publish_merchant_rate_share", { request }),
  importCodes: (codes: MerchantFreeCodeInput[]) => invokeDesktop<MerchantImportResult>("import_merchant_free_codes", { codes }),
  freeOffers: () => invokeDesktop<MerchantFreeOffer[]>("list_merchant_free_offers"),
  claimAndRedeemFreeOffer: (offerId: string, stationId: string) => invokeDesktop<string>("claim_and_redeem_merchant_free_offer", { offerId, stationId }),
  adminProfiles: () => invokeDesktop<AdminMerchantProfile[]>("list_admin_merchant_profiles"),
  saveAdminProfile: (profile: AdminMerchantProfileInput) => invokeDesktop<void>("save_admin_merchant_profile", { profile }),
  adminRates: () => invokeDesktop<AdminMerchantRateShare[]>("list_admin_merchant_rate_shares"),
  saveAdminRate: (share: AdminMerchantRateShareInput) => invokeDesktop<void>("save_admin_merchant_rate_share", { share }),
  deleteAdminRate: (id: string) => invokeDesktop<void>("delete_admin_merchant_rate_share", { id }),
  adminFreeCodes: () => invokeDesktop<AdminMerchantFreeCode[]>("list_admin_merchant_free_codes"),
  saveAdminFreeCode: (code: AdminMerchantFreeCodeInput) => invokeDesktop<void>("save_admin_merchant_free_code", { code }),
  deleteAdminFreeCode: (id: string) => invokeDesktop<void>("delete_admin_merchant_free_code", { id }),
};
