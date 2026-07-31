import { invokeDesktop } from "../../lib/tauri";
import type { AdminMerchantFreeAccount, AdminMerchantFreeAccountInput, AdminMerchantProfile, AdminMerchantProfileInput, AdminMerchantRateShare, AdminMerchantRateShareInput, ClaimedMerchantAccount, MerchantFreeAccountInput, MerchantFreeOffer, MerchantProfile, MerchantRateShare, PublishMerchantRateRequest } from "./types";

export const merchantApi = {
  profile: () => invokeDesktop<MerchantProfile | null>("get_merchant_profile"),
  saveProfile: (profile: MerchantProfile) => invokeDesktop<MerchantProfile>("save_merchant_profile", { profile }),
  rates: () => invokeDesktop<MerchantRateShare[]>("list_merchant_rate_shares"),
  publishRate: (request: PublishMerchantRateRequest) => invokeDesktop<void>("publish_merchant_rate_share", { request }),
  importAccounts: (accounts: MerchantFreeAccountInput[]) => invokeDesktop<void>("import_merchant_free_accounts", { accounts }),
  freeOffers: () => invokeDesktop<MerchantFreeOffer[]>("list_merchant_free_offers"),
  claimAccount: (offerId: string) => invokeDesktop<ClaimedMerchantAccount>("claim_merchant_free_account", { offerId }),
  releaseAccount: (offerId: string) => invokeDesktop<void>("release_merchant_free_account", { offerId }),
  adminProfiles: () => invokeDesktop<AdminMerchantProfile[]>("list_admin_merchant_profiles"),
  saveAdminProfile: (profile: AdminMerchantProfileInput) => invokeDesktop<void>("save_admin_merchant_profile", { profile }),
  adminRates: () => invokeDesktop<AdminMerchantRateShare[]>("list_admin_merchant_rate_shares"),
  saveAdminRate: (share: AdminMerchantRateShareInput) => invokeDesktop<void>("save_admin_merchant_rate_share", { share }),
  deleteAdminRate: (id: string) => invokeDesktop<void>("delete_admin_merchant_rate_share", { id }),
  adminFreeAccounts: () => invokeDesktop<AdminMerchantFreeAccount[]>("list_admin_merchant_free_accounts"),
  saveAdminFreeAccount: (account: AdminMerchantFreeAccountInput) => invokeDesktop<void>("save_admin_merchant_free_account", { account }),
  deleteAdminFreeAccount: (id: string) => invokeDesktop<void>("delete_admin_merchant_free_account", { id }),
};
