import { I18nProvider } from '@suskii/i18n/react';
import type { ReactNode } from 'react';

import { getI18n } from '../../lib/i18n';
import { Container } from '../layout/container';

import { pickAccountMessages } from './pick-account-messages';

/** Frame for the sign-in, registration and email-link pages: heading, intro and the form. */
export async function AuthPage({
  heading,
  intro,
  children,
}: {
  heading: string;
  intro?: string;
  children: ReactNode;
}) {
  const { locale, messages } = await getI18n();
  return (
    <Container className="flex max-w-dialog flex-col gap-6 pt-10 pb-16">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-h2 font-extrabold text-heading">{heading}</h1>
        {intro ? <p className="font-body text-body text-muted">{intro}</p> : null}
      </div>
      <I18nProvider locale={locale} messages={pickAccountMessages(messages)}>
        {children}
      </I18nProvider>
    </Container>
  );
}
