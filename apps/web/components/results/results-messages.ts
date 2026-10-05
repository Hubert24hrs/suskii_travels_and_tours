'use client';

import type { Messages } from '@suskii/i18n';
import { useTranslator } from '@suskii/i18n/react';

/** Catalog namespaces the client-side results need; the rest stays on the server. */
export type ResultsMessages = Pick<Messages, 'results' | 'cabins' | 'common' | 'alerts'>;

export const useResultsT = () => useTranslator<ResultsMessages>();
