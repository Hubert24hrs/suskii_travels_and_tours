import type { Metadata } from 'next';

import { AuthPage } from '../../components/account/auth-page';
import { VerifyEmail } from '../../components/account/auth-forms';
import { getI18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('auth.verifyEmail.title'),
    description: t('auth.verifyEmail.title'),
    path: '/verify-email',
    noIndex: true,
  });
}

/** Opened from the emailed link; the token stays in the URL fragment (never sent to a server). */
export default async function VerifyEmailPage() {
  const { t } = await getI18n();
  return (
    <AuthPage heading={t('auth.verifyEmail.title')}>
      <VerifyEmail />
    </AuthPage>
  );
}
