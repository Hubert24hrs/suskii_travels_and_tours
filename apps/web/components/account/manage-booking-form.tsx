'use client';

import { Button, Card, Input } from '@suskii/ui-web';
import { useState, type FormEvent } from 'react';

import { browserApi, problemSlug } from '../../lib/browser-api';
import { AppLink } from '../app-link';

import { useAccountT } from './account-messages';
import { useTurnstile } from './use-turnstile';

/**
 * "Manage booking": a traveller who no longer has the booking page asks for its link by reference
 * and email. The API answers the same whether or not they match, and only the booking's own
 * contact address receives the link, so this page never says whether a booking exists.
 */
export function ManageBookingForm({ turnstileSiteKey }: { turnstileSiteKey: string }) {
  const { t } = useAccountT();
  const [reference, setReference] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const {
    containerRef: turnstileRef,
    ensure: ensureTurnstile,
    reset: resetTurnstile,
    currentToken,
  } = useTurnstile(turnstileSiteKey, 'manage-booking', () =>
    setError(t('booking.manage.botCheck')),
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const turnstileToken = currentToken();
    if (!turnstileToken) {
      ensureTurnstile();
      setError(t('booking.manage.botCheck'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: problem, response } = await browserApi().POST('/v1/bookings/link', {
        body: { reference, email, turnstileToken },
      });
      if (response.ok) {
        setSent(true);
        return;
      }
      resetTurnstile();
      const slug = problemSlug(problem);
      setError(
        response.status === 429
          ? t('booking.manage.tooMany')
          : slug === 'bot-check-failed'
            ? t('booking.manage.botCheck')
            : response.status === 400
              ? t('booking.manage.invalidReference')
              : t('booking.manage.error'),
      );
    } catch {
      setError(t('booking.manage.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-6">
      {sent ? (
        <>
          <p
            role="status"
            data-testid="manage-booking-sent"
            className="rounded-md bg-primary-subtle p-4 font-body text-body-sm text-foreground"
          >
            {t('booking.manage.sent')}
          </p>
          <Button type="button" variant="ghost" onClick={() => setSent(false)}>
            {t('booking.manage.again')}
          </Button>
        </>
      ) : (
        <form
          method="post"
          className="flex flex-col gap-4"
          onSubmit={(event) => void submit(event)}
        >
          <Input
            label={t('booking.manage.reference')}
            hint={t('booking.manage.referenceHint')}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={8}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            onFocus={ensureTurnstile}
            required
            data-testid="manage-booking-reference"
          />
          <Input
            label={t('booking.manage.email')}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            onFocus={ensureTurnstile}
            required
            data-testid="manage-booking-email"
          />
          <div ref={turnstileRef} />
          {error ? (
            <p role="alert" className="font-body text-body-sm text-danger">
              {error}
            </p>
          ) : null}
          <Button type="submit" loading={busy} data-testid="manage-booking-submit">
            {t('booking.manage.submit')}
          </Button>
        </form>
      )}
      <p className="font-body text-body-sm text-muted">
        {t('booking.manage.signedIn')}{' '}
        <AppLink href="/account/trips" className="text-primary underline">
          {t('booking.manage.toTrips')}
        </AppLink>
      </p>
    </Card>
  );
}
