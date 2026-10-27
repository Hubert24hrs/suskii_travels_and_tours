import type { Metadata } from 'next';

import { AuthPage } from '../../../components/account/auth-page';
import { SocialCallback } from '../../../components/account/social-callback';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('auth.signIn.title'),
    description: t('auth.signIn.intro'),
    path: '/sign-in/callback',
    noIndex: true,
  });
}

/** Google and Apple return here with an ID token in the fragment (ADR-067). */
export default async function SocialCallbackPage() {
  const { t } = await getI18n();
  return (
    <AuthPage heading={t('auth.signIn.heading')} intro={t('auth.signIn.intro')}>
      <SocialCallback />
    </AuthPage>
  );
}
