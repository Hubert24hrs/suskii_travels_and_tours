import type { Vertical } from '@suskii/shared';
import { Clock } from 'lucide-react';

import { getI18n } from '../lib/i18n';

import { AppLink } from './app-link';
import { Container } from './layout/container';

/**
 * Honest notice on search pages whose results arrive in later phases (ADR-010): the search is
 * kept in the URL, and deal alerts are offered instead of an empty results list.
 */
export async function AvailabilityNotice({
  vertical,
  hasSearch,
}: {
  vertical: Vertical;
  hasSearch: boolean;
}) {
  const { t } = await getI18n();
  return (
    <Container className="mt-8">
      <div
        role="status"
        className="flex items-start gap-4 rounded-lg border border-border bg-surface p-6"
      >
        <Clock aria-hidden="true" className="mt-1 size-6 shrink-0 text-primary" />
        <div className="flex flex-col gap-2">
          <h2 className="font-heading text-h4 font-bold text-heading">
            {t('pages.availability.heading')}
          </h2>
          <p className="font-body text-body text-foreground">
            {t(`pages.availability.${vertical}`)}
          </p>
          {hasSearch ? (
            <p className="font-body text-body-sm text-muted">
              {t('pages.availability.searchSaved')}
            </p>
          ) : null}
          <AppLink
            href="/#newsletter"
            className="font-body text-body-sm font-bold text-primary underline"
          >
            {t('pages.availability.alerts')}
          </AppLink>
        </div>
      </div>
    </Container>
  );
}
