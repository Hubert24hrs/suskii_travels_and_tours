'use client';

import { useFormatters, useTranslator } from '@suskii/i18n/react';
import { VISA_DOCUMENT_TYPES } from '@suskii/shared/lite';
import { Badge, Button, Card, type BadgeProps } from '@suskii/ui-web';
import { FileUp } from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';

import { bookingHeaders } from '../../lib/booking-token';
import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';
import { publicEnv } from '../../lib/env';
import { AppLink } from '../app-link';
import { ResultsLoading } from '../results/result-states';

import type { VisaApplicationMessages } from './visa-application-messages';

type Application = Schemas['VisaApplication'];
type Item = Application['checklist'][number];
type DocumentStatus = NonNullable<Item['document']>['status'];
type Phase =
  { kind: 'loading' } | { kind: 'ready'; application: Application } | { kind: 'missing' };

const POLL_MS = 3000;
const STOP_AFTER_MS = 3 * 60_000;

const DOCUMENT_VARIANT: Record<DocumentStatus, NonNullable<BadgeProps['variant']>> = {
  pending_scan: 'info',
  clean: 'success',
  infected: 'danger',
  scan_failed: 'warning',
  rejected: 'warning',
};

const ACCEPT = [...VISA_DOCUMENT_TYPES, '.pdf', '.jpg', '.jpeg', '.png'].join(',');

/** The upload's declared type; the API sniffs the bytes anyway and ignores this. */
function declaredType(file: File): string | null {
  if ((VISA_DOCUMENT_TYPES as readonly string[]).includes(file.type)) return file.type;
  const extension = /\.([A-Za-z]+)$/.exec(file.name)?.[1]?.toLowerCase();
  if (extension === 'pdf') return 'application/pdf';
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  return null;
}

/**
 * One applicant's visa application (ADR-026): the checklist with uploads (encrypted at rest and
 * virus-scanned before they count), short-lived signed links to view a file, updates from the
 * visa team and submission. Guests are recognised by the booking token saved in this tab.
 */
export function VisaApplicationView({
  bookingId,
  applicationId,
}: {
  bookingId: string;
  applicationId: string;
}) {
  const { t } = useTranslator<VisaApplicationMessages>();
  const format = useFormatters();
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const started = useRef<number | null>(null);

  const reload = () => {
    started.current = Date.now();
    setAttempt((n) => n + 1);
  };

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    started.current ??= Date.now();
    const load = async () => {
      try {
        const { data } = await browserApi().GET(
          '/v1/bookings/{bookingId}/visa-applications/{applicationId}',
          { params: { path: { bookingId, applicationId } }, headers: bookingHeaders(bookingId) },
        );
        if (cancelled) return;
        if (!data) {
          setPhase({ kind: 'missing' });
          return;
        }
        setPhase({ kind: 'ready', application: data });
        // Keep polling while a scan is running, so "checking" turns into "received" by itself.
        const scanning = data.checklist.some((item) => item.document?.status === 'pending_scan');
        if (scanning && Date.now() - (started.current ?? Date.now()) < STOP_AFTER_MS)
          timer = setTimeout(() => void load(), POLL_MS);
      } catch {
        if (!cancelled) setPhase({ kind: 'missing' });
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [bookingId, applicationId, attempt]);

  const upload = async (item: Item, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    const type = declaredType(file);
    if (!type) {
      setError(t('visa.application.errors.type'));
      return;
    }
    setBusy(item.key);
    try {
      const {
        data,
        error: problem,
        response,
      } = await browserApi().PUT(
        '/v1/bookings/{bookingId}/visa-applications/{applicationId}/documents/{checklistKey}',
        {
          params: {
            path: { bookingId, applicationId, checklistKey: item.key },
            header: { 'X-File-Name': encodeURIComponent(file.name), ...bookingHeaders(bookingId) },
          },
          // The raw file is the body (no JSON); the declared type only picks the route's parser.
          body: file as unknown as string,
          bodySerializer: (body) => body,
          headers: { 'Content-Type': type },
        },
      );
      if (data) {
        setPhase({ kind: 'ready', application: data });
        reload();
      } else {
        const slug = problemSlug(problem);
        setError(
          response.status === 413
            ? t('visa.application.errors.tooLarge')
            : response.status === 415
              ? t('visa.application.errors.type')
              : response.status === 409
                ? t('visa.application.errors.locked')
                : response.status === 429
                  ? t('visa.application.errors.tooMany')
                  : slug === 'document-type'
                    ? t('visa.application.errors.type')
                    : t('visa.application.errors.generic'),
        );
      }
    } catch {
      setError(t('visa.application.errors.generic'));
    }
    setBusy(null);
  };

  const view = async (document: NonNullable<Item['document']>) => {
    setError(null);
    const { data } = await browserApi().POST(
      '/v1/bookings/{bookingId}/visa-applications/{applicationId}/documents/{documentId}/link',
      {
        params: { path: { bookingId, applicationId, documentId: document.id } },
        headers: bookingHeaders(bookingId),
      },
    );
    if (!data) {
      setError(t('visa.application.viewFailed'));
      return;
    }
    // A signed, short-lived link for this viewer only; the API always answers with an attachment.
    window.location.assign(new URL(data.url, publicEnv.apiBaseUrl).toString());
  };

  const submit = async () => {
    setBusy('submit');
    setError(null);
    const { data, response } = await browserApi().POST(
      '/v1/bookings/{bookingId}/visa-applications/{applicationId}/submit',
      { params: { path: { bookingId, applicationId } }, headers: bookingHeaders(bookingId) },
    );
    setBusy(null);
    if (data) setPhase({ kind: 'ready', application: data });
    else
      setError(
        response.status === 422
          ? t('visa.application.errors.incomplete')
          : response.status === 409
            ? t('visa.application.errors.locked')
            : t('visa.application.errors.generic'),
      );
  };

  if (phase.kind === 'loading') return <ResultsLoading label={t('visa.application.loading')} />;
  if (phase.kind === 'missing')
    return (
      <Card role="status" className="flex flex-col items-start gap-4 p-6">
        <h1 className="font-heading text-h3 font-bold text-heading">
          {t('booking.notFound.heading')}
        </h1>
        <p className="font-body text-body text-foreground">{t('booking.notFound.body')}</p>
        <Button asChild variant="secondary">
          <AppLink href="/">{t('booking.notFound.home')}</AppLink>
        </Button>
      </Card>
    );

  const { application } = phase;
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3">
        <AppLink
          href={`/bookings/${bookingId}`}
          className="inline-flex min-h-12 items-center font-body text-body-sm font-bold text-primary underline focus-visible:focus-ring"
        >
          {t('visa.application.back')}
        </AppLink>
        <h1 className="font-heading text-h2 font-extrabold text-heading">
          {t('visa.application.heading', { name: application.applicantName })}
        </h1>
        <div role="status" aria-live="polite" className="flex flex-col items-start gap-2">
          <Badge variant="info" data-testid="visa-status">
            {t(`booking.inhouse.applicationStatus.${application.status}`)}
          </Badge>
          <p className="font-body text-body-sm text-foreground">
            {format.country(application.destination)} ·{' '}
            {t(`booking.inhouse.purposes.${application.purpose}`)} ·{' '}
            {format.date(application.travelDate, 'long')}
          </p>
          {application.submittedAt ? (
            <p className="font-body text-body-sm text-foreground">
              {t('visa.application.submitted', {
                date: format.dateTime(application.submittedAt),
              })}
            </p>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="font-body text-body-sm text-danger">
            {error}
          </p>
        ) : null}
      </header>

      <Card asChild className="flex flex-col gap-4 p-4">
        <section aria-labelledby="visa-documents">
          <h2 id="visa-documents" className="font-heading text-h3 font-bold text-heading">
            {t('visa.application.checklist')}
          </h2>
          {application.canUpload ? (
            <p className="font-body text-body-sm text-foreground">
              {t('visa.application.fileHint')}
            </p>
          ) : null}
          <ul className="flex flex-col gap-4">
            {application.checklist.map((item) => {
              const inputId = `visa-file-${item.key}`;
              return (
                <li
                  key={item.key}
                  className="flex flex-col gap-2 border-b border-border pb-4 last:border-b-0 last:pb-0"
                  data-testid={`visa-item-${item.key}`}
                >
                  <p className="flex flex-wrap items-center gap-2 font-body text-body font-bold text-foreground">
                    {item.label}
                    <Badge variant={item.required ? 'info' : 'neutral'}>
                      {item.required
                        ? t('visa.application.required')
                        : t('visa.application.optional')}
                    </Badge>
                  </p>
                  {item.description ? (
                    <p className="font-body text-body-sm text-foreground">{item.description}</p>
                  ) : null}
                  {item.document ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={DOCUMENT_VARIANT[item.document.status]}
                        data-testid="visa-document-status"
                      >
                        {t(`visa.application.documentStatus.${item.document.status}`)}
                      </Badge>
                      {item.document.status === 'clean' ? (
                        <Button variant="ghost" onClick={() => void view(item.document!)}>
                          {t('visa.application.view', { file: item.document.fileName })}
                        </Button>
                      ) : (
                        <span className="font-body text-caption text-foreground">
                          {item.document.fileName}
                        </span>
                      )}
                    </div>
                  ) : null}
                  {application.canUpload ? (
                    <div>
                      {/* A real file input behind a styled label: keyboard and screen readers work. */}
                      <input
                        id={inputId}
                        type="file"
                        accept={ACCEPT}
                        className="peer sr-only"
                        disabled={busy !== null}
                        onChange={(event) => void upload(item, event)}
                      />
                      <label
                        htmlFor={inputId}
                        className="inline-flex min-h-12 cursor-pointer items-center gap-2 rounded-md border border-border-strong px-4 font-body text-body-sm font-bold text-primary peer-focus-visible:focus-ring peer-disabled:cursor-not-allowed"
                      >
                        <FileUp aria-hidden="true" className="size-4" />
                        {busy === item.key
                          ? t('visa.application.uploading')
                          : item.document
                            ? t('visa.application.replace', { item: item.label })
                            : t('visa.application.upload', { item: item.label })}
                      </label>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {application.canUpload ? (
            <div className="flex flex-col items-start gap-2">
              <Button
                loading={busy === 'submit'}
                disabled={!application.canSubmit || busy !== null}
                onClick={() => void submit()}
              >
                {t('visa.application.submit')}
              </Button>
              {!application.canSubmit ? (
                <p className="font-body text-caption text-foreground">
                  {t('visa.application.submitHint')}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      </Card>

      {application.messages.length > 0 ? (
        <Card asChild className="flex flex-col gap-3 p-4">
          <section aria-labelledby="visa-messages">
            <h2 id="visa-messages" className="font-heading text-h3 font-bold text-heading">
              {t('visa.application.messages')}
            </h2>
            <ol className="flex flex-col gap-3">
              {application.messages.map((message, index) => (
                <li key={index} className="flex flex-col gap-1">
                  <p className="font-body text-caption font-bold text-muted">
                    {format.dateTime(message.occurredAt)}
                    {message.status
                      ? ` · ${t(`booking.inhouse.applicationStatus.${message.status}`)}`
                      : ''}
                  </p>
                  {message.message ? (
                    <p className="font-body text-body text-foreground">{message.message}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          </section>
        </Card>
      ) : null}

      <p className="font-body text-caption text-foreground">{application.disclaimer}</p>
    </div>
  );
}
