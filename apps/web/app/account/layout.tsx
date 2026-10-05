import { I18nProvider } from '@suskii/i18n/react';
import type { ReactNode } from 'react';

import { AccountShell } from '../../components/account/account-shell';
import { pickAccountMessages } from '../../components/account/pick-account-messages';
import { Container } from '../../components/layout/container';
import { getI18n } from '../../lib/i18n';

/** The account area: private, client-rendered against the API with the session cookies. */
export default async function AccountLayout({ children }: { children: ReactNode }) {
  const { t, locale, messages } = await getI18n();
  return (
    <Container className="flex flex-col gap-6 pt-8 pb-16">
      <h1 className="font-heading text-h2 font-extrabold text-heading">{t('account.title')}</h1>
      <I18nProvider locale={locale} messages={pickAccountMessages(messages)}>
        <AccountShell>{children}</AccountShell>
      </I18nProvider>
    </Container>
  );
}
