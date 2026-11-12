'use client';

import { useTranslator } from '@suskii/i18n/react';

import type { QuotesMessages } from './quotes-messages';

export const useQuotesT = () => useTranslator<QuotesMessages>();
