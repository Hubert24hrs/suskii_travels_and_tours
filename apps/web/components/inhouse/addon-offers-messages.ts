import type { Messages } from '@suskii/i18n';

/** The catalog subset the add-ons list needs on the client (plain module). */
export type AddonOffersMessages = Record<'addons', Messages['addons']> &
  Record<'booking', Pick<Messages['booking'], 'inhouse'>> &
  Record<'inhouse', Pick<Messages['inhouse'], 'sample'>>;

export const pickAddonOffersMessages = (messages: Messages): AddonOffersMessages => ({
  addons: messages.addons,
  booking: { inhouse: messages.booking.inhouse },
  inhouse: { sample: messages.inhouse.sample },
});
