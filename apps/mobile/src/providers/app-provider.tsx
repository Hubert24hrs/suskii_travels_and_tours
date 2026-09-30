import { getMessages, type Messages } from '@suskii/i18n';
import { I18nProvider, useTranslator } from '@suskii/i18n/react';
import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  isSupportedCurrency,
  isSupportedLocale,
  type CurrencyCode,
  type LocaleCode,
} from '@suskii/shared';
import { ToastProvider } from '@suskii/ui-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getLocales } from 'expo-localization';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { createAppApi, createBareApi, type ApiClient } from '../lib/api';
import { preferences } from '../lib/cache';
import { SessionStore, type AuthUser, type RefreshOutcome } from '../lib/session';

interface AppContextValue {
  api: ApiClient;
  session: SessionStore;
  user: AuthUser | null;
  locale: LocaleCode;
  currency: CurrencyCode;
  setCurrency: (currency: CurrencyCode) => void;
  queryClient: QueryClient;
}

const AppContext = createContext<AppContextValue | null>(null);

/** The device language when we support it (en-NG, en-GB, en-US), else en-NG. */
export function deviceLocale(): LocaleCode {
  for (const locale of getLocales()) {
    if (locale.languageTag && isSupportedLocale(locale.languageTag)) return locale.languageTag;
  }
  return DEFAULT_LOCALE;
}

const CURRENCY_KEY = 'preferences.currency';

function storedCurrency(): CurrencyCode {
  const value = preferences.getString(CURRENCY_KEY);
  return value && isSupportedCurrency(value) ? value : DEFAULT_CURRENCY;
}

export function createSessionStore(): SessionStore {
  const bare = createBareApi();
  return new SessionStore(async (refreshToken): Promise<RefreshOutcome> => {
    try {
      const { data, response } = await bare.POST('/v1/auth/refresh', { body: { refreshToken } });
      if (data) return data;
      return response.status === 401 || response.status === 403 ? 'invalid' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  });
}

export const createQueryClient = (): QueryClient =>
  new QueryClient({
    defaultOptions: { queries: { retry: 1, staleTime: 30_000, gcTime: 10 * 60_000 } },
  });

/**
 * App-wide services: the API client, the session, language, currency, queries and toasts. Tests
 * pass their own `queryClient` (no retries, no garbage-collection timers).
 */
export function AppProvider({
  session,
  queryClient: injected,
  children,
}: {
  session: SessionStore;
  queryClient?: QueryClient;
  children: ReactNode;
}) {
  const [locale] = useState(deviceLocale);
  const [currency, setCurrencyState] = useState(storedCurrency);
  const [queryClient] = useState(() => injected ?? createQueryClient());
  const api = useMemo(() => createAppApi(session, () => locale), [session, locale]);
  const user = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.user,
  );
  const setCurrency = useCallback((next: CurrencyCode) => {
    preferences.set(CURRENCY_KEY, next);
    setCurrencyState(next);
  }, []);
  const messages = useMemo(() => getMessages(locale), [locale]);
  const value = useMemo(
    () => ({ api, session, user, locale, currency, setCurrency, queryClient }),
    [api, session, user, locale, currency, setCurrency, queryClient],
  );
  return (
    <AppContext.Provider value={value}>
      <I18nProvider locale={locale} messages={messages}>
        <QueryClientProvider client={queryClient}>
          <Toasts>{children}</Toasts>
        </QueryClientProvider>
      </I18nProvider>
    </AppContext.Provider>
  );
}

function Toasts({ children }: { children: ReactNode }) {
  const { t } = useT();
  return <ToastProvider closeLabel={t('common.close')}>{children}</ToastProvider>;
}

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside <AppProvider>');
  return value;
}

/** The full catalog: the app bundles every namespace it uses. */
export const useT = () => useTranslator<Messages>();
