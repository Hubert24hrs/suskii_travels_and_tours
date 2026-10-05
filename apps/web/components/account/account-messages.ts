'use client';

import type { Messages } from '@suskii/i18n';
import { useTranslator } from '@suskii/i18n/react';

/** Catalog namespaces the sign-in, account, Prime and alert widgets need on the client. */
export type AccountMessages = Pick<
  Messages,
  'auth' | 'account' | 'prime' | 'alerts' | 'common' | 'booking'
>;

export const useAccountT = () => useTranslator<AccountMessages>();
