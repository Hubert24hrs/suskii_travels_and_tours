'use client';

import { useTranslator } from '@suskii/i18n/react';

import type { SupportMessages } from './support-messages';

export const useSupportT = () => useTranslator<SupportMessages>();
