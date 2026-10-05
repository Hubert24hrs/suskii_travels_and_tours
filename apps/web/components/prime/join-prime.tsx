'use client';

import { BOOKING_TERMS_VERSION, type CurrencyCode } from '@suskii/shared/lite';
import { Button, Card, Input } from '@suskii/ui-web';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { browserApi, idempotencyKey, problemSlug } from '../../lib/browser-api';
import { useAccountT } from '../account/account-messages';
import { useAccount } from '../account/use-account';
import { AppLink } from '../app-link';

/**
 * Joining Suskii Prime (ADR-030): a membership quote, then a booking with one member name on the
 * usual pipeline, then the booking page, which takes the payment and shows the term once the
 * payment is confirmed. Signed-in accounts only.
 */
export function JoinPrime({
  planSlug,
  planName,
  currency,
}: {
  planSlug: string;
  planName: string;
  currency: CurrencyCode;
}) {
  const { t } = useAccountT();
  const router = useRouter();
  const { phase } = useAccount();
  const [open, setOpen] = useState(false);
  const [givenNames, setGivenNames] = useState('');
  const [surname, setSurname] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memberUntil, setMemberUntil] = useState<string | null>(null);

  const user = phase.kind === 'ready' ? phase.user : null;
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void browserApi()
      .GET('/v1/me/prime')
      .then(({ data }) => {
        if (!cancelled && data?.current) setMemberUntil(data.current.until.slice(0, 10));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (phase.kind === 'loading') return null;
  if (!user) {
    return (
      <AppLink
        href={`/sign-in?next=${encodeURIComponent('/prime')}`}
        className="inline-flex min-h-12 items-center justify-center rounded-md bg-accent px-6 font-body text-body font-bold text-on-accent focus-visible:focus-ring"
      >
        {t('prime.signInToJoin')}
      </AppLink>
    );
  }

  const start = () => {
    const [first = '', ...rest] = (user.displayName ?? '').trim().split(/\s+/);
    setGivenNames((value) => value || first);
    setSurname((value) => value || rest.join(' '));
    setEmail((value) => value || (user.email ?? ''));
    setPhone((value) => value || (user.phone ?? ''));
    setOpen(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const quote = await browserApi().POST('/v1/inhouse-quotes', {
        body: { kind: 'membership', planSlug, currency },
      });
      if (!quote.data) {
        setError(quote.response.status === 410 ? t('prime.unavailable') : t('prime.error'));
        return;
      }
      const created = await browserApi().POST('/v1/bookings', {
        params: { header: { 'Idempotency-Key': idempotencyKey() } },
        body: {
          quoteId: quote.data.quoteId,
          contact: { email, phone },
          guests: [{ givenNames, surname }],
          termsVersion: BOOKING_TERMS_VERSION,
          acceptTerms: true,
        },
      });
      if (!created.data) {
        setError(
          problemSlug(created.error) === 'validation-failed'
            ? t('auth.register.invalid')
            : t('prime.error'),
        );
        return;
      }
      router.push(`/bookings/${created.data.booking.id}`);
    } catch {
      setError(t('prime.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {memberUntil ? (
        <p className="font-body text-body-sm text-foreground">
          {t('prime.member', { date: memberUntil })}
        </p>
      ) : null}
      {open ? (
        <Card className="flex flex-col gap-4 p-4">
          <h3 className="font-heading text-h4 font-bold text-heading">
            {t('prime.checkoutHeading', { plan: planName })}
          </h3>
          <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)}>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                label={t('prime.memberGivenNames')}
                autoComplete="given-name"
                value={givenNames}
                onChange={(event) => setGivenNames(event.target.value)}
                required
                data-testid="prime-given-names"
              />
              <Input
                label={t('prime.memberSurname')}
                autoComplete="family-name"
                value={surname}
                onChange={(event) => setSurname(event.target.value)}
                required
                data-testid="prime-surname"
              />
              <Input
                label={t('prime.contactEmail')}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                data-testid="prime-email"
              />
              <Input
                label={t('prime.contactPhone')}
                type="tel"
                autoComplete="tel"
                hint={t('auth.signIn.phoneHint')}
                value={phone}
                onChange={(event) => setPhone(event.target.value.replace(/[\s-]/g, ''))}
                required
                data-testid="prime-phone"
              />
            </div>
            <label className="flex items-start gap-2 font-body text-body-sm text-foreground">
              <input
                type="checkbox"
                name="terms"
                className="mt-1 size-5 accent-primary"
                checked={terms}
                onChange={(event) => setTerms(event.target.checked)}
                required
                data-testid="prime-terms"
              />
              {t('prime.terms')}
            </label>
            {error ? (
              <p role="alert" className="font-body text-body-sm text-danger">
                {error}
              </p>
            ) : null}
            <Button type="submit" loading={busy} disabled={!terms} data-testid="prime-continue">
              {t('prime.continue')}
            </Button>
          </form>
        </Card>
      ) : (
        <Button variant="secondary" onClick={start} data-testid={`join-${planSlug}`}>
          {t('prime.join', { plan: planName })}
        </Button>
      )}
    </div>
  );
}
