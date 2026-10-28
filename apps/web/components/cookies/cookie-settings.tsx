'use client';

import type { Messages } from '@suskii/i18n';
import { DeferredDialog, useDeferredOverlay, type DeferredOverlay } from '@suskii/ui-web';
import { lazy, Suspense } from 'react';

export type CookieLabels = Messages['cookies'];

// The list and the form load with the dialog, not with every page (ADR-013).
const CookiePanel = lazy(() => import('./cookie-panel'));

/** The cookie list and the optional-category choices (ADR-042), opened by `overlay`. */
export function CookieDialog({
  overlay,
  labels,
}: {
  overlay: DeferredOverlay;
  labels: CookieLabels;
}) {
  return (
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
  );
}

/** Footer button opening the cookie list and choices. */
export function CookieSettings({ labels, className }: { labels: CookieLabels; className: string }) {
  const overlay = useDeferredOverlay();
  return (
    <>
      <button type="button" {...overlay.triggerProps} className={className}>
        {labels.title}
      </button>
      <CookieDialog overlay={overlay} labels={labels} />
    </>
  );
}
