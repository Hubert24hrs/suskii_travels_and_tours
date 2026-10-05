import type { Metadata } from 'next';

import { getI18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

type Section =
  | 'overview'
  | 'trips'
  | 'travellers'
  | 'notifications'
  | 'security'
  | 'prime'
  | 'referrals'
  | 'alerts'
  | 'wallet'
  | 'privacy';

/** Account pages are personal: never indexed. */
export async function accountMetadata(section: Section, path: string): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: `${t(`account.nav.${section}`)} · ${t('account.title')}`,
    description: t('account.title'),
    path,
    noIndex: true,
  });
}
