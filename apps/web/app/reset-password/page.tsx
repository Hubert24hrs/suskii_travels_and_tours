import type { Metadata } from 'next';

import { AuthPage } from '../../components/account/auth-page';
import { ResetPasswordForm } from '../../components/account/auth-forms';
import { getI18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('auth.reset.title'),
    description: t('auth.reset.title'),
    path: '/reset-password',
    noIndex: true,
  });
}

/** Opened from the emailed link; the token stays in the URL fragment. */
export default async function ResetPasswordPage() {
  const { t } = await getI18n();
  return (
    <AuthPage heading={t('auth.reset.heading')}>
      <ResetPasswordForm />
    </AuthPage>
  );
}
