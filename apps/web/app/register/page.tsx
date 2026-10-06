import type { Metadata } from 'next';

import { AuthPage } from '../../components/account/auth-page';
import { RegisterForm } from '../../components/account/auth-forms';
import { publicEnv } from '../../lib/env';
import { getI18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('auth.register.title'),
    description: t('auth.register.intro'),
    path: '/register',
    noIndex: true,
  });
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>;
}) {
  const { t } = await getI18n();
  const { ref } = await searchParams;
  return (
    <AuthPage heading={t('auth.register.heading')} intro={t('auth.register.intro')}>
      <RegisterForm
        referralCode={typeof ref === 'string' ? ref.slice(0, 20) : null}
        turnstileSiteKey={publicEnv.turnstileSiteKey}
      />
    </AuthPage>
  );
}
