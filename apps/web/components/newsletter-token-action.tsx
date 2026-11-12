'use client';

import { Button } from '@suskii/ui-web';
import { useEffect, useState } from 'react';

import { AppLink } from './app-link';

export interface NewsletterTokenActionProps {
  action: 'confirm' | 'unsubscribe';
  apiBaseUrl: string;
  labels: {
    submit: string;
    done: string;
    invalidLink: string;
    missingToken: string;
    error: string;
    backHome: string;
  };
}

type Status = 'idle' | 'sending' | 'done' | 'invalid' | 'missing' | 'error';

/**
 * Email-link page action (ADR-012). The token is read from the URL fragment (never sent to our
 * servers in a GET or a Referer), removed from the address bar, and only used when the reader
 * presses the button, so link scanners cannot confirm or unsubscribe on their behalf.
 */
export function NewsletterTokenAction({ action, apiBaseUrl, labels }: NewsletterTokenActionProps) {
  const [token, setToken] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    const found = new URLSearchParams(window.location.hash.slice(1)).get('token');
    window.history.replaceState(null, '', window.location.pathname);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the fragment only exists in the browser.
    if (found) setToken(found);
    else setStatus('missing');
  }, []);

  const submit = async () => {
    if (!token) return;
    setStatus('sending');
    try {
      const response = await fetch(`${apiBaseUrl}/v1/newsletter/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      setStatus(response.ok ? 'done' : response.status === 400 ? 'invalid' : 'error');
    } catch {
      setStatus('error');
    }
  };

  const message = {
    done: labels.done,
    invalid: labels.invalidLink,
    missing: labels.missingToken,
    error: labels.error,
  } as Partial<Record<Status, string>>;

  return (
    <div className="flex flex-col items-start gap-4">
      {status === 'idle' || status === 'sending' || status === 'error' ? (
        <Button
          type="button"
          onClick={() => void submit()}
          loading={status === 'sending'}
          disabled={!token}
        >
          {labels.submit}
        </Button>
      ) : null}
      <p role="status" className="font-body text-body text-foreground empty:hidden">
        {message[status] ?? ''}
      </p>
      {status === 'done' || status === 'invalid' || status === 'missing' ? (
        <AppLink href="/" className="font-body text-body-sm font-bold text-primary underline">
          {labels.backHome}
        </AppLink>
      ) : null}
    </div>
  );
}
