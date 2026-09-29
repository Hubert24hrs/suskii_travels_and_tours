'use client';

import { useTranslator } from '@suskii/i18n/react';

import type { SearchMessages } from './search-messages';

export const useSearchT = () => useTranslator<SearchMessages>();
