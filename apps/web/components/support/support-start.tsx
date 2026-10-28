'use client';

import { SUPPORT_CATEGORIES, SUPPORT_MESSAGE_MAX, type SupportCategory } from '@suskii/shared/lite';
import { Button, Card, Input } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type FormEvent } from 'react';

import { bookingHeaders } from '../../lib/booking-token';
import { browserApi, problemSlug } from '../../lib/browser-api';
import { hasSession } from '../../lib/session';
import { saveSupportToken } from '../../lib/support-token';
import { useHydrated } from '../../lib/use-hydrated';
import { useTurnstile } from '../account/use-turnstile';
import { NativeSelect } from '../search/native-select';

import { useSupportT } from './use-support-t';

export const SUPPORT_TEXTAREA =
  'min-h-28 w-full rounded-md border border-border-strong bg-surface px-4 py-3 font-body text-body text-foreground focus-visible:focus-ring';

/**
 * Starts a support conversation (ADR-083), optionally about one booking. Visitors without a
 * session give an email and pass Turnstile; guests of a booking send its token so the API can
 * tie the conversation to it. On success the conversation opens.
 */
export function SupportStart({
  turnstileSiteKey,
  bookingId,
}: {
  turnstileSiteKey: string;
  bookingId: string | null;
}) {
  const { t } = useSupportT();
  const router = useRouter();
  const signedIn = useHydrated() && hasSession();
  const messageId = useId();
  const [category, setCategory] = useState<SupportCategory>(
    bookingId ? 'booking_change' : 'pre_booking',
  );
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    containerRef: turnstileRef,
    ensure: ensureHuman,
    reset: resetTurnstile,
    currentToken,
  } = useTurnstile(turnstileSiteKey, 'support', () => setError(t('support.errors.generic')));
  const [bookingReference, setBookingReference] = useState<string | null>(null);

  // The booking page links here with the booking's id; its reference comes from the API, with
  // the guest's booking token when there is no session.
  useEffect(() => {
    if (!bookingId) return;
    let cancelled = false;
    browserApi()
      .GET('/v1/bookings/{bookingId}', {
        params: { path: { bookingId } },
        headers: bookingHeaders(bookingId),
      })
      .then(({ data }) => {
        if (!cancelled && data) setBookingReference(data.reference);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bookingId]);

  const ensureTurnstile = () => {
    if (!signedIn) ensureHuman();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const turnstileToken = signedIn ? null : currentToken();
    if (!signedIn && !turnstileToken) {
      ensureHuman();
      setError(t('support.errors.generic'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data, error: problem } = await browserApi().POST('/v1/support/conversations', {
        headers: bookingId ? bookingHeaders(bookingId) : {},
        body: {
          category,
          message,
          bookingId,
          email: signedIn || email.trim() === '' ? null : email,
          turnstileToken,
        },
      });
      if (data) {
        if (data.accessToken) saveSupportToken(data.conversation.id, data.accessToken);
        router.push(`/support/${data.conversation.id}`);
        return;
      }
      resetTurnstile();
      const slug = problemSlug(problem);
      setError(
        slug === 'support-limit'
          ? t('support.errors.limit')
          : slug === 'support-email-required'
            ? t('support.errors.email')
            : t('support.errors.generic'),
      );
    } catch {
      setError(t('support.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-6" data-testid="support-start">
      <h2 className="font-heading text-h3 font-bold text-heading">{t('support.start.heading')}</h2>
      {bookingReference ? (
        <p className="font-body text-body-sm text-muted">
          {t('support.start.booking', { reference: bookingReference })}
        </p>
      ) : null}
      <form method="post" className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <NativeSelect
          label={t('support.start.category')}
          name="category"
          value={category}
          onChange={(event) => setCategory(event.target.value as SupportCategory)}
          options={SUPPORT_CATEGORIES.map((value) => ({
            value,
            label: t(`support.start.categories.${value}`),
          }))}
          data-testid="support-category"
        />
        <div className="flex flex-col gap-1">
          <label htmlFor={messageId} className="font-body text-body-sm font-medium text-foreground">
            {t('support.start.message')}
          </label>
          <textarea
            id={messageId}
            name="message"
            value={message}
            required
            maxLength={SUPPORT_MESSAGE_MAX}
            aria-describedby={`${messageId}-hint`}
            onChange={(event) => setMessage(event.target.value)}
            onFocus={ensureTurnstile}
            className={SUPPORT_TEXTAREA}
            data-testid="support-message"
          />
          <p id={`${messageId}-hint`} className="font-body text-body-sm text-muted">
            {t('support.start.messageHint')}
          </p>
        </div>
        {signedIn ? null : (
          <Input
            label={t('support.start.email')}
            hint={t('support.start.emailHint')}
            type="email"
            autoComplete="email"
            value={email}
            required={bookingId === null}
            onChange={(event) => setEmail(event.target.value)}
            onFocus={ensureTurnstile}
            data-testid="support-email"
          />
        )}
        <div ref={turnstileRef} />
        {error ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {error}
          </p>
        ) : null}
        <Button type="submit" loading={busy} data-testid="support-submit">
          {t('support.start.submit')}
        </Button>
      </form>
    </Card>
  );
}
