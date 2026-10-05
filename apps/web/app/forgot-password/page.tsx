import type { Metadata } from 'next';

import { AuthPage } from '../../components/account/auth-page';
import { ForgotPasswordForm } from '../../components/account/auth-forms';
import { getI18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('auth.forgot.title'),
    description: t('auth.forgot.intro'),
    path: '/forgot-password',
    noIndex: true,
  });
}

export default async function ForgotPasswordPage() {
  const { t } = await getI18n();
  return (
    <AuthPage heading={t('auth.forgot.heading')}>
      <ForgotPasswordForm />
    </AuthPage>
  );
}
