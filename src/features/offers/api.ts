import type { Offer } from "./types";

/** Offers are included in the station snapshot; this keeps their read-model boundary local. */
export const offersApi = {
  fromSnapshot: (offers: Offer[]) => offers,
};
