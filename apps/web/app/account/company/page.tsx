import type { Metadata } from 'next';

import { accountMetadata } from '../../../components/account/account-metadata';
import { CompanySection } from '../../../components/account/company-section';
import { api } from '../../../lib/api';
import { getI18n } from '../../../lib/i18n';

export function generateMetadata(): Promise<Metadata> {
  return accountMetadata('company', '/account/company');
}

/** Company accounts (ADR-078): members, the travel policy, approvals, trips and spend. */
export default async function AccountCompanyPage() {
  const { locale } = await getI18n();
  const countries = (await api.countries())?.items ?? [];
  const collator = new Intl.Collator(locale);
  return (
    <CompanySection
      countries={countries
        .map(({ code, name }) => ({ code, name }))
        .sort((a, b) => collator.compare(a.name, b.name))}
    />
  );
}
