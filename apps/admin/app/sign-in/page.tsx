import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SignInPage } from '../../components/sign-in-page';
import { t } from '../../lib/i18n';

export const metadata: Metadata = { title: t('auth.title') };

export default function Page() {
  // The form reads `?next=` on the client.
  return (
    <Suspense>
      <SignInPage />
    </Suspense>
  );
}
