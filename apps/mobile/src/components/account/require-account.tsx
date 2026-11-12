import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';

import { useApp, useT } from '../../providers/app-provider';
import { Notice } from '../states';

/** Account screens need a session; without one they offer sign-in instead. */
export function RequireAccount({ children }: { children: ReactNode }) {
  const { user } = useApp();
  const { t } = useT();
  const router = useRouter();
  if (!user) {
    return (
      <Notice
        testID="account-required"
        body={t('mobile.account.signedOutBody')}
        action={t('mobile.account.signIn')}
        onAction={() => router.push('/sign-in')}
      />
    );
  }
  return children;
}
