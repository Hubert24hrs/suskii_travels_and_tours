import type { ReactNode } from 'react';

import { NoAskSuskii } from '../../components/assistant/ask-suskii';
import { PaymentPageGuard } from '../../components/payments/payment-page-guard';

/** A page that starts a payment: only our own scripts run here (ADR-089). */
export default function PaymentLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PaymentPageGuard />
      <NoAskSuskii />
      {children}
    </>
  );
}
