'use client';

import type { Messages } from '@suskii/i18n';
import { useTranslator } from '@suskii/i18n/react';

/** Catalog namespaces the sign-in, account, Prime and alert widgets need on the client. */
export type AccountMessages = Pick<
  Messages,
  'auth' | 'account' | 'prime' | 'alerts' | 'common' | 'booking' | 'cabins'
> & {
  /** Only what the list of combined trips shows (ADR-099), not the planner's copy. */
  trips: Pick<Messages['trips'], 'route' | 'states' | 'receipt'>;
};

export const useAccountT = () => useTranslator<AccountMessages>();
