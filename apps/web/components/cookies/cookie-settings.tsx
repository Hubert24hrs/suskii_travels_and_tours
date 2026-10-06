'use client';

import type { Messages } from '@suskii/i18n';
import { DeferredDialog, useDeferredOverlay } from '@suskii/ui-web';
import { lazy, Suspense } from 'react';

export type CookieLabels = Messages['cookies'];

// The list and the form load with the dialog, not with every page (ADR-013).
const CookiePanel = lazy(() => import('./cookie-panel'));

/** Footer button opening the cookie list and the optional-category choices (ADR-042). */
export function CookieSettings({ labels, className }: { labels: CookieLabels; className: string }) {
  const overlay = useDeferredOverlay();
  return (
    <>
      <button type="button" {...overlay.triggerProps} className={className}>
        {labels.title}
      </button>
      <DeferredDialog
        overlay={overlay}
        title={labels.title}
        description={labels.intro}
        closeLabel={labels.close}
        data-testid="cookie-settings"
      >
        <Suspense fallback={null}>
          <CookiePanel labels={labels} />
        </Suspense>
      </DeferredDialog>
    </>
  );
}
