import type { Metadata } from 'next';

import { AuthPage } from '../../../components/account/auth-page';
import { JoinCompany } from '../../../components/account/join-company';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('account.company.join.heading'),
    description: t('account.company.join.intro'),
    path: '/company/join',
    noIndex: true,
  });
}

/** Where an emailed company invitation lands (ADR-078); the token stays in the fragment. */
export default async function JoinCompanyPage() {
  const { t } = await getI18n();
  return (
    <AuthPage heading={t('account.company.join.heading')} intro={t('account.company.join.intro')}>
      <JoinCompany />
    </AuthPage>
  );
}
