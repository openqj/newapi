import type { NotificationMessage } from "./types";

/** Notification messages are currently projected from station offers. */
export const notificationsApi = {
  fromOffers: (offers: NotificationMessage[]) => offers,
};
