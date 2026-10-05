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
  const { t } = await getI18n();
  const { next } = await searchParams;
  return (
    <AuthPage heading={t('auth.signIn.heading')} intro={t('auth.signIn.intro')}>
      <SignInForm next={typeof next === 'string' ? next : null} />
    </AuthPage>
  );
}
