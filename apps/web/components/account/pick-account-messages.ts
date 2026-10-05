import type { Messages } from '@suskii/i18n';

import type { AccountMessages } from './account-messages';

/** Server pages pass this subset to `I18nProvider` (never the whole catalog). */
export const pickAccountMessages = (messages: Messages): AccountMessages => ({
  auth: messages.auth,
  account: messages.account,
  prime: messages.prime,
  alerts: messages.alerts,
  common: messages.common,
  booking: messages.booking,
});
