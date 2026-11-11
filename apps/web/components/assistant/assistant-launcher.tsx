'use client';

import { I18nProvider } from '@suskii/i18n/react';
import { DeferredDialog, useDeferredOverlay } from '@suskii/ui-web';
import { MessageCircle } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { lazy, Suspense } from 'react';

import { isPaymentPage } from '../../lib/payment-pages';
import { AppLink } from '../app-link';

import type { AssistantMessages } from './assistant-messages';

// The chat itself loads when the button is first pressed, never with a page (ADR-013).
const AssistantChat = lazy(() =>
  import('./assistant-chat').then((module) => ({ default: module.AssistantChat })),
);

/**
 * The button that opens the assistant, on every page while the API says it is available
 * (the server decides and renders nothing otherwise). It is not shown on payment pages, where
 * nothing may sit over the pay button, or on the assistant's own page, and it sits under the
 * consent prompt, dialogs and toasts.
 */
export function AssistantLauncher({
  labels,
  messages,
  locale,
  turnstileSiteKey,
}: {
  labels: { open: string; title: string; close: string; fullPage: string };
  messages: AssistantMessages;
  locale: string;
  turnstileSiteKey: string;
}) {
  const overlay = useDeferredOverlay();
  const pathname = usePathname();
  if (isPaymentPage(pathname) || pathname.startsWith('/assistant')) return null;
  return (
    <>
      <button
        type="button"
        {...overlay.triggerProps}
        data-testid="assistant-open"
        className="fixed inset-e-4 bottom-4 z-30 inline-flex min-h-12 items-center gap-2 rounded-pill bg-primary px-4 font-body text-body-sm font-bold text-on-primary shadow-card-hover hover:bg-primary-hover focus-visible:focus-ring print:hidden"
      >
        <MessageCircle aria-hidden="true" className="size-5" />
        {labels.open}
      </button>
      <DeferredDialog overlay={overlay} title={labels.title} closeLabel={labels.close}>
        <I18nProvider locale={locale} messages={messages}>
          <Suspense fallback={null}>
            <AssistantChat locale={locale} turnstileSiteKey={turnstileSiteKey} />
          </Suspense>
        </I18nProvider>
        <AppLink
          href="/assistant"
          onClick={() => overlay.setOpen(false)}
          className="mt-4 inline-flex min-h-6 items-center font-body text-body-sm text-muted underline hover:text-primary focus-visible:focus-ring"
        >
          {labels.fullPage}
        </AppLink>
      </DeferredDialog>
    </>
  );
}
