import type { Metadata } from 'next';

import { AuthPage } from '../../../components/account/auth-page';
import { AppSignInRelay } from '../../../components/account/social-callback';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('auth.signIn.title'),
    description: t('auth.signIn.intro'),
    path: '/sign-in/app',
    noIndex: true,
  });
}

const one = (value: string | string[] | undefined): string | null =>
  typeof value === 'string' ? value : null;

/** The app's Google and Apple sign-in starts here, in the system browser (ADR-067). */
export default async function AppSignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    provider?: string | string[];
    nonce?: string | string[];
    state?: string | string[];
  }>;
}) {
  const { t } = await getI18n();
  const params = await searchParams;
  return (
    <AuthPage heading={t('auth.signIn.heading')} intro={t('auth.signIn.intro')}>
      <AppSignInRelay
        provider={one(params.provider)}
        nonce={one(params.nonce)}
        state={one(params.state)}
      />
    </AuthPage>
  );
}
