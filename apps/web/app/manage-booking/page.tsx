import type { Metadata } from 'next';

import { AuthPage } from '../../components/account/auth-page';
import { ManageBookingForm } from '../../components/account/manage-booking-form';
import { publicEnv } from '../../lib/env';
import { getI18n } from '../../lib/i18n';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({
    title: t('booking.manage.title'),
    description: t('booking.manage.intro'),
    path: '/manage-booking',
    noIndex: true,
  });
}

/** Where "Manage booking" in the header and footer leads: the link to a booking, by email. */
export default async function ManageBookingPage() {
  const { t } = await getI18n();
  return (
    <AuthPage heading={t('booking.manage.heading')} intro={t('booking.manage.intro')}>
      <ManageBookingForm turnstileSiteKey={publicEnv.turnstileSiteKey} />
    </AuthPage>
  );
}
