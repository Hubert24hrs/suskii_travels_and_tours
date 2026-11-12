'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { createFormatters, type Formatters } from './format';
import { createTranslator, type MessageTree, type Translator } from './translator';

interface I18nValue {
  locale: string;
  messages: MessageTree;
}

const I18nContext = createContext<I18nValue | null>(null);

export interface I18nProviderProps {
  locale: string;
  /** Only the namespaces client components need; the server keeps the rest. */
  messages: MessageTree;
  children: ReactNode;
}

export function I18nProvider({ locale, messages, children }: I18nProviderProps) {
  const value = useMemo(() => ({ locale, messages }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useTranslator/useFormatters must be used inside <I18nProvider>');
  return value;
}

/** Typed against the subset of the catalog the provider received. */
export function useTranslator<T extends MessageTree>(): Translator<T> {
  const { locale, messages } = useI18n();
  return useMemo(() => createTranslator(messages as T, locale), [messages, locale]);
}

export function useFormatters(): Formatters {
  const { locale } = useI18n();
  return useMemo(() => createFormatters(locale), [locale]);
}
