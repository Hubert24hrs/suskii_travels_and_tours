'use client';

import { useTranslator } from '@suskii/i18n/react';

import type { AssistantMessages } from './assistant-messages';

export const useAssistantT = () => useTranslator<AssistantMessages>();
