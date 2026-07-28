import { useMemo } from "react";
import { offersApi } from "./api";
import type { Offer } from "./types";

/** Stable offers projection for future snapshot or standalone offer sources. */
export function useOffers(offers: Offer[]) {
  return useMemo(() => ({ offers: offersApi.fromSnapshot(offers) }), [offers]);
}
