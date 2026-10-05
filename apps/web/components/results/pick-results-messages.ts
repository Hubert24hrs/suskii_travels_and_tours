import type { Messages } from '@suskii/i18n';

import type { ResultsMessages } from './results-messages';

export const pickResultsMessages = (messages: Messages): ResultsMessages => ({
  results: messages.results,
  cabins: messages.cabins,
  common: messages.common,
  alerts: messages.alerts,
});
