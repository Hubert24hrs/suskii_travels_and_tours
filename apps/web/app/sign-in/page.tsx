import type { Metadata } from 'next';

import { AuthPage } from '../../components/account/auth-page';
import { SignInForm } from '../../components/account/auth-forms';
import { getI18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('auth.signIn.title'),
    description: t('auth.signIn.intro'),
    path: '/sign-in',
    noIndex: true,
  });
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  // The card carries its own heading ("Welcome back", ADR-108).
  return (
    <AuthPage>
      <SignInForm next={typeof next === 'string' ? next : null} />
    </AuthPage>
  );
}
