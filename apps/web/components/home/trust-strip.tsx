import { TrustBar } from '@suskii/ui-web';
import { ShieldCheck } from 'lucide-react';

import type { SiteContent } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { Container } from '../layout/container';

import { trustIcon } from './trust-icons';

/**
 * Payment methods the platform actually supports (from the API: none until payment adapters exist
 * in phase 6), the secure checkout note and the verified trust signals.
 */
export async function TrustStrip({ site }: { site: SiteContent | null }) {
  const { t } = await getI18n();
  const methods = site?.paymentMethods ?? [];
  return (
    <section aria-labelledby="trust-heading" className="border-y border-border bg-surface py-6">
      <Container className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <ShieldCheck aria-hidden="true" className="mt-1 size-6 shrink-0 text-success" />
          <div>
            <h2 id="trust-heading" className="font-heading text-body font-bold text-heading">
              {t('sections.trust.secureCheckout')}
            </h2>
            <p className="font-body text-body-sm text-muted">
              {t('sections.trust.secureCheckoutBody')}
            </p>
          </div>
        </div>
        {methods.length > 0 ? (
          <ul aria-label={t('sections.trust.paymentMethods')} className="flex flex-wrap gap-2">
            {methods.map((method) => (
              <li
                key={method.key}
                className="rounded-md border border-border px-3 py-1 font-body text-body-sm font-bold text-foreground"
              >
                {method.label}
              </li>
            ))}
          </ul>
        ) : null}
        <TrustBar
          label={t('sections.trust.heading')}
          items={(site?.trustSignals ?? []).map((signal) => ({
            id: signal.key,
            label: signal.label,
            icon: trustIcon(signal.key),
          }))}
        />
      </Container>
    </section>
  );
}
