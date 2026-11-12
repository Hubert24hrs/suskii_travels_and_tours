import type { Metadata } from 'next';

import { accountMetadata } from '../../../components/account/account-metadata';
import { WalletSection } from '../../../components/account/membership-sections';

export function generateMetadata(): Promise<Metadata> {
  return accountMetadata('wallet', '/account/wallet');
}

export default function AccountWalletPage() {
  return <WalletSection />;
}
