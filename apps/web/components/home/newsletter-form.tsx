'use client';

import { emailSchema, phoneSchema, type LocaleCode } from '@suskii/shared';
import { Button, Input } from '@suskii/ui-web';
import { useId, useRef, useState, type FormEvent } from 'react';

import { AppLink } from '../app-link';

import { loadTurnstile } from './turnstile';

export interface NewsletterFormProps {
  apiBaseUrl: string;
  /** Empty in local development: the API's mock verifier accepts the placeholder token. */
  turnstileSiteKey: string;
  locale: LocaleCode;
  privacyHref: string | null;
  labels: Record<
    | 'email'
    | 'emailPlaceholder'
    | 'whatsappOptIn'
    | 'phone'
    | 'phoneHint'
    | 'consent'
    | 'privacy'
    | 'submit'
    | 'success'
    | 'error'
    | 'rateLimited'
    | 'invalidEmail'
    | 'invalidPhone'
    | 'consentRequired'
    | 'verifying',
    string
  >;
}

const DEVELOPMENT_TOKEN = 'development';

type Status =
  { kind: 'idle' } | { kind: 'sending' } | { kind: 'done' } | { kind: 'failed'; message: string };

/** Deal-alert sign-up (ADR-012): consent checkbox, optional WhatsApp opt-in, Turnstile, double opt-in. */
export function NewsletterForm({
  apiBaseUrl,
  turnstileSiteKey,
  locale,
  privacyHref,
  labels,
}: NewsletterFormProps) {
  const [email, setEmail] = useState('');
  const [whatsapp, setWhatsapp] = useState(false);
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<'email' | 'phone' | 'consent', string>>>({});
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const token = useRef<string | null>(turnstileSiteKey ? null : DEVELOPMENT_TOKEN);
  const widget = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const consentId = useId();
  const whatsappId = useId();

  const ensureTurnstile = () => {
    if (!turnstileSiteKey || widgetId.current || !widget.current) return;
    const container = widget.current;
    loadTurnstile()
      .then((turnstile) => {
        widgetId.current = turnstile.render(container, {
          sitekey: turnstileSiteKey,
          action: 'newsletter',
          appearance: 'interaction-only',
          callback: (value) => {
            token.current = value;
          },
          'expired-callback': () => {
            token.current = null;
          },
        });
      })
      .catch(() => setStatus({ kind: 'failed', message: labels.error }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const found: typeof errors = {};
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success) found.email = labels.invalidEmail;
    const parsedPhone = whatsapp ? phoneSchema.safeParse(phone.replace(/[\s-]/g, '')) : null;
    if (parsedPhone && !parsedPhone.success) found.phone = labels.invalidPhone;
    if (!consent) found.consent = labels.consentRequired;
    setErrors(found);
    if (Object.keys(found).length > 0 || !parsedEmail.success) return;
    if (!token.current) {
      ensureTurnstile();
      setStatus({ kind: 'failed', message: labels.verifying });
      return;
    }
    setStatus({ kind: 'sending' });
    try {
      const response = await fetch(`${apiBaseUrl}/v1/newsletter/subscriptions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Suskii-Client': 'web/0.1' },
        body: JSON.stringify({
          email: parsedEmail.data,
          consent: true,
          locale,
          turnstileToken: token.current,
          ...(parsedPhone?.success ? { whatsapp: { phone: parsedPhone.data } } : {}),
        }),
      });
      if (response.status === 202) {
        setStatus({ kind: 'done' });
        return;
      }
      setStatus({
        kind: 'failed',
        message: response.status === 429 ? labels.rateLimited : labels.error,
      });
    } catch {
      setStatus({ kind: 'failed', message: labels.error });
    } finally {
      // Turnstile tokens are single use.
      if (turnstileSiteKey && widgetId.current) {
        token.current = null;
        window.turnstile?.reset(widgetId.current);
      }
    }
  };

  if (status.kind === 'done') {
    return (
      <p role="status" className="self-center font-body text-body font-bold text-success">
        {labels.success}
      </p>
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      onFocusCapture={ensureTurnstile}
      className="flex flex-col gap-4"
    >
      <Input
        type="email"
        name="email"
        autoComplete="email"
        label={labels.email}
        placeholder={labels.emailPlaceholder}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={errors.email}
      />
      <label
        htmlFor={whatsappId}
        className="flex min-h-12 items-center gap-3 font-body text-body-sm text-foreground"
      >
        <input
          id={whatsappId}
          type="checkbox"
          checked={whatsapp}
          onChange={(event) => setWhatsapp(event.target.checked)}
          className="size-5 shrink-0 accent-primary"
        />
        {labels.whatsappOptIn}
      </label>
      {whatsapp ? (
        <Input
          type="tel"
          name="phone"
          autoComplete="tel"
          inputMode="tel"
          label={labels.phone}
          hint={labels.phoneHint}
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          error={errors.phone}
        />
      ) : null}
      <div className="flex flex-col gap-1">
        <label
          htmlFor={consentId}
          className="flex items-start gap-3 font-body text-body-sm text-foreground"
        >
          <input
            id={consentId}
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
            aria-invalid={errors.consent ? true : undefined}
            aria-describedby={errors.consent ? `${consentId}-error` : undefined}
            className="mt-1 size-5 shrink-0 accent-primary"
          />
          <span>
            {labels.consent}{' '}
            {privacyHref ? (
              <AppLink href={privacyHref} className="font-bold text-primary underline">
                {labels.privacy}
              </AppLink>
            ) : null}
          </span>
        </label>
        {errors.consent ? (
          <p id={`${consentId}-error`} className="font-body text-caption text-danger">
            {errors.consent}
          </p>
        ) : null}
      </div>
      <div ref={widget} />
      <Button type="submit" loading={status.kind === 'sending'} fullWidth="mobile">
        {labels.submit}
      </Button>
      <p
        role="status"
        aria-live="polite"
        className="font-body text-body-sm text-danger empty:hidden"
      >
        {status.kind === 'failed' ? status.message : ''}
      </p>
    </form>
  );
}
