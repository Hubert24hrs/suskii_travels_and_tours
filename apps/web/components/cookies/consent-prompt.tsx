'use client';

import { Button, buttonVariants, useDeferredOverlay } from '@suskii/ui-web';
import { useState, useSyncExternalStore } from 'react';

import { CONSENT_EVENT, readCookieConsent } from '../../lib/consent-cookie';

import { CookieDialog, type CookieLabels } from './cookie-settings';

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener(CONSENT_EVENT, onChange);
  return () => window.removeEventListener(CONSENT_EVENT, onChange);
};
const chosen = (): boolean => readCookieConsent() !== null;
// The server cannot read the browser's choice: it renders nothing, so hydration never differs.
const chosenOnServer = (): boolean => true;

/**
 * First-visit cookie prompt (ADR-042, ADR-079), shown only while an optional tag is configured
 * and the visitor has no choice under the current policy. "Accept all" and "Reject all" carry the
 * same weight; "Choose" opens the full list. Fixed to the bottom, so it never moves the page.
 */
export default function ConsentPrompt({ labels }: { labels: CookieLabels }) {
  const decided = useSyncExternalStore(subscribe, chosen, chosenOnServer);
  const choices = useDeferredOverlay();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const save = async (all: boolean) => {
    setBusy(true);
    setFailed(false);
    // Saving needs the API client: it loads on the first choice, not with the page.
    const { saveCookieConsent } = await import('../../lib/cookie-consent');
    const saved = await saveCookieConsent({ analytics: all, marketing: all });
    setBusy(false);
    if (!saved) setFailed(true);
  };

  return (
    <>
      {decided ? null : (
        <section
          aria-labelledby="consent-prompt-title"
          data-testid="consent-prompt"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface p-4 shadow-card-hover"
        >
          <div className="mx-auto flex max-w-page flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-1">
              <h2
                id="consent-prompt-title"
                className="font-heading text-body font-bold text-heading"
              >
                {labels.prompt.title}
              </h2>
              <p className="font-body text-body-sm text-foreground">{labels.prompt.body}</p>
              {failed ? (
                <p role="alert" className="font-body text-body-sm text-danger">
                  {labels.error}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => void save(true)}
                data-testid="consent-accept"
              >
                {labels.prompt.accept}
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => void save(false)}
                data-testid="consent-reject"
              >
                {labels.prompt.reject}
              </Button>
              <button
                type="button"
                {...choices.triggerProps}
                className={buttonVariants({ variant: 'ghost' })}
                data-testid="consent-choose"
              >
                {labels.prompt.choose}
              </button>
            </div>
          </div>
        </section>
      )}
      {/* Saving from "Choose" hides the bar; the list stays open to confirm the save. */}
      <CookieDialog overlay={choices} labels={labels} />
    </>
  );
}
