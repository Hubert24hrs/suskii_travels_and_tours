'use client';

import {
  ASSISTED_BOOKING_FAILURES,
  ASSISTED_QUOTE_CLOSE_REASONS,
  type AssistedBookingFailure,
  type AssistedQuoteCloseReason,
} from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';

import { $api, type Schemas } from '../../lib/api';
import { fieldIssues, minorFromInput, nullable } from '../../lib/form';
import { format, label, t } from '../../lib/i18n';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import {
  CheckboxField,
  DetailList,
  FormDialog,
  FormGrid,
  PageHeader,
  ProblemAlert,
  QueryState,
  Section,
  SelectField,
  StatusBadge,
  TextAreaField,
  TextField,
} from '../ui';

type Quote = Schemas['AdminAssistedQuote'];
type Queue = 'to_verify' | 'to_book' | 'all';

const PATH = '/v1/admin/assisted-quotes';
const QUEUES: readonly Queue[] = ['to_verify', 'to_book', 'all'];
const LINK = 'font-bold text-primary underline focus-visible:focus-ring';

const useRefresh = () => {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['get', PATH] });
};

const tone = (status: Quote['status']) =>
  status === 'requested'
    ? 'warning'
    : status === 'offered'
      ? 'info'
      : status === 'booked'
        ? 'success'
        : 'neutral';

interface OfferForm {
  supplierName: string;
  amount: string;
  currency: string;
  evidenceUrl: string;
  title: string;
  summary: string;
  startDate: string;
  endDate: string;
  cityName: string;
  countryCode: string;
  refundable: boolean;
}

/** Staff verified the live price with the supplier: the request becomes an offer (ADR-104). */
function VerifyDialog({ quote }: { quote: Quote }) {
  const initial = (): OfferForm => ({
    supplierName: quote.supplierName ?? '',
    amount: '',
    currency: quote.supplierPrice?.currency ?? quote.currency,
    evidenceUrl: '',
    title: quote.offer?.details.title ?? quote.title,
    summary: quote.offer?.details.summary ?? '',
    startDate: quote.request.startDate,
    endDate: quote.request.endDate ?? quote.request.startDate,
    cityName: quote.offer?.details.cityName ?? quote.request.destination,
    countryCode: quote.offer?.details.countryCode ?? '',
    refundable: quote.offer?.details.refundable ?? false,
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<OfferForm>(initial);
  const [amountError, setAmountError] = useState<string>();
  const { toast } = useToast();
  const refresh = useRefresh();
  const offer = $api.useMutation('post', `${PATH}/{assistedQuoteId}/offer`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('assistedQuotes.offered'), variant: 'success' });
      await refresh();
    },
  });
  const errors = fieldIssues(offer.error);
  const set = <K extends keyof OfferForm>(key: K, value: OfferForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const currency = form.currency.trim().toUpperCase();
    const amountMinor = minorFromInput(form.amount, currency);
    if (amountMinor === null || Number.isNaN(amountMinor) || amountMinor <= 0) {
      setAmountError(t('common.validation'));
      return;
    }
    setAmountError(undefined);
    offer.mutate({
      params: { path: { assistedQuoteId: quote.id } },
      body: {
        supplierName: form.supplierName.trim(),
        supplierPrice: { amountMinor, currency },
        evidenceUrl: form.evidenceUrl.trim(),
        details: {
          title: form.title.trim(),
          summary: form.summary.trim(),
          startDate: form.startDate,
          endDate: form.endDate,
          cityName: nullable(form.cityName),
          countryCode: nullable(form.countryCode.toUpperCase()),
          refundable: form.refundable,
        },
      },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('assistedQuotes.verify')}
      triggerVariant="primary"
      triggerAriaLabel={t('assistedQuotes.verifyLabel', { reference: quote.reference })}
      title={t('assistedQuotes.verifyTitle', { reference: quote.reference })}
      description={t('assistedQuotes.verifyNote')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setForm(initial());
          setAmountError(undefined);
          offer.reset();
        }
      }}
      testId={`verify-${quote.reference}`}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('assistedQuotes.supplierName')}
          hint={t('assistedQuotes.supplierNameHint')}
          name="supplierName"
          value={form.supplierName}
          maxLength={120}
          required
          error={errors.supplierName}
          onChange={(event) => set('supplierName', event.target.value)}
        />
        <FormGrid>
          <TextField
            label={t('assistedQuotes.supplierAmount')}
            name="amount"
            inputMode="decimal"
            value={form.amount}
            required
            error={amountError ?? errors.supplierPrice}
            onChange={(event) => set('amount', event.target.value)}
          />
          <TextField
            label={t('assistedQuotes.supplierCurrency')}
            name="currency"
            value={form.currency}
            maxLength={3}
            required
            onChange={(event) => set('currency', event.target.value)}
          />
        </FormGrid>
        <TextField
          label={t('assistedQuotes.evidenceUrl')}
          hint={t('assistedQuotes.evidenceUrlHint')}
          name="evidenceUrl"
          type="url"
          value={form.evidenceUrl}
          maxLength={500}
          required
          error={errors.evidenceUrl}
          onChange={(event) => set('evidenceUrl', event.target.value)}
        />
        <TextField
          label={t('assistedQuotes.offerTitle')}
          name="title"
          value={form.title}
          maxLength={160}
          required
          onChange={(event) => set('title', event.target.value)}
        />
        <TextAreaField
          label={t('assistedQuotes.offerSummary')}
          hint={t('assistedQuotes.offerSummaryHint')}
          name="summary"
          value={form.summary}
          maxLength={1200}
          required
          error={errors.details}
          onChange={(event) => set('summary', event.target.value)}
        />
        <FormGrid>
          <TextField
            label={t('assistedQuotes.startDate')}
            name="startDate"
            type="date"
            value={form.startDate}
            required
            onChange={(event) => set('startDate', event.target.value)}
          />
          <TextField
            label={t('assistedQuotes.endDate')}
            name="endDate"
            type="date"
            value={form.endDate}
            required
            onChange={(event) => set('endDate', event.target.value)}
          />
          <TextField
            label={t('assistedQuotes.cityName')}
            name="cityName"
            value={form.cityName}
            maxLength={80}
            onChange={(event) => set('cityName', event.target.value)}
          />
          <TextField
            label={t('assistedQuotes.countryCode')}
            name="countryCode"
            value={form.countryCode}
            maxLength={2}
            onChange={(event) => set('countryCode', event.target.value)}
          />
        </FormGrid>
        <CheckboxField
          label={t('assistedQuotes.refundable')}
          name="refundable"
          checked={form.refundable}
          onChange={(event) => set('refundable', event.target.checked)}
        />
        <ProblemAlert error={offer.error} />
        <Button type="submit" loading={offer.isPending}>
          {t('assistedQuotes.verifySubmit')}
        </Button>
      </form>
    </FormDialog>
  );
}

/** A dialog that asks only for a reason from a list. */
function ReasonDialog<Reason extends string>({
  triggerLabel,
  triggerAriaLabel,
  title,
  description,
  reasons,
  group,
  submitLabel,
  pending,
  error,
  onSubmit,
  onOpen,
  open,
  setOpen,
}: {
  triggerLabel: string;
  triggerAriaLabel: string;
  title: string;
  description?: string;
  reasons: readonly Reason[];
  group: string;
  submitLabel: string;
  pending: boolean;
  error: unknown;
  onSubmit: (reason: Reason) => void;
  onOpen: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [reason, setReason] = useState<Reason>(reasons[0]!);
  return (
    <FormDialog
      triggerLabel={triggerLabel}
      triggerAriaLabel={triggerAriaLabel}
      title={title}
      description={description}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) onOpen();
      }}
    >
      <form
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(reason);
        }}
        className="flex flex-col gap-4"
      >
        <SelectField
          label={t('assistedQuotes.closeReason')}
          name="reason"
          value={reason}
          options={reasons.map((value) => ({ value, label: label(group, value) }))}
          onChange={(event) => setReason(event.target.value as Reason)}
        />
        <ProblemAlert error={error} />
        <Button type="submit" loading={pending}>
          {submitLabel}
        </Button>
      </form>
    </FormDialog>
  );
}

function CloseDialog({ quote }: { quote: Quote }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const refresh = useRefresh();
  const close = $api.useMutation('post', `${PATH}/{assistedQuoteId}/close`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('assistedQuotes.closed'), variant: 'success' });
      await refresh();
    },
  });
  return (
    <ReasonDialog<AssistedQuoteCloseReason>
      triggerLabel={t('assistedQuotes.close')}
      triggerAriaLabel={t('assistedQuotes.closeLabel', { reference: quote.reference })}
      title={t('assistedQuotes.closeTitle', { reference: quote.reference })}
      reasons={ASSISTED_QUOTE_CLOSE_REASONS}
      group="assistedQuotes.closeReasons"
      submitLabel={t('assistedQuotes.closeSubmit')}
      pending={close.isPending}
      error={close.error}
      onSubmit={(reason) =>
        close.mutate({ params: { path: { assistedQuoteId: quote.id } }, body: { reason } })
      }
      onOpen={() => close.reset()}
      open={open}
      setOpen={setOpen}
    />
  );
}

/** Staff booked it with the supplier: their record of the confirmation confirms the booking. */
function BookedDialog({ quote }: { quote: Quote }) {
  const [open, setOpen] = useState(false);
  const [supplierReference, setSupplierReference] = useState('');
  const [evidenceUrl, setEvidenceUrl] = useState('');
  const { toast } = useToast();
  const refresh = useRefresh();
  const booked = $api.useMutation('post', `${PATH}/{assistedQuoteId}/booked`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('assistedQuotes.booked'), variant: 'success' });
      await refresh();
    },
  });
  const errors = fieldIssues(booked.error);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    booked.mutate({
      params: { path: { assistedQuoteId: quote.id } },
      body: { supplierReference: supplierReference.trim(), evidenceUrl: evidenceUrl.trim() },
    });
  };
  return (
    <FormDialog
      triggerLabel={t('assistedQuotes.markBooked')}
      triggerVariant="primary"
      triggerAriaLabel={t('assistedQuotes.markBookedLabel', { reference: quote.reference })}
      title={t('assistedQuotes.markBookedTitle', { reference: quote.reference })}
      description={t('assistedQuotes.markBookedNote')}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSupplierReference('');
          setEvidenceUrl('');
          booked.reset();
        }
      }}
      testId={`booked-${quote.reference}`}
    >
      <form method="post" onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('assistedQuotes.supplierReferenceField')}
          name="supplierReference"
          value={supplierReference}
          maxLength={64}
          required
          error={errors.supplierReference}
          onChange={(event) => setSupplierReference(event.target.value)}
        />
        <TextField
          label={t('assistedQuotes.evidenceUrl')}
          hint={t('assistedQuotes.evidenceUrlHint')}
          name="evidenceUrl"
          type="url"
          value={evidenceUrl}
          maxLength={500}
          required
          error={errors.evidenceUrl}
          onChange={(event) => setEvidenceUrl(event.target.value)}
        />
        <ProblemAlert error={booked.error} />
        <Button type="submit" loading={booked.isPending}>
          {t('assistedQuotes.markBookedSubmit')}
        </Button>
      </form>
    </FormDialog>
  );
}

function UnbookableDialog({ quote }: { quote: Quote }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();
  const refresh = useRefresh();
  const unbookable = $api.useMutation('post', `${PATH}/{assistedQuoteId}/unbookable`, {
    onSuccess: async () => {
      setOpen(false);
      toast({ title: t('assistedQuotes.refunded'), variant: 'success' });
      await refresh();
    },
  });
  return (
    <ReasonDialog<AssistedBookingFailure>
      triggerLabel={t('assistedQuotes.unbookable')}
      triggerAriaLabel={t('assistedQuotes.unbookableLabel', { reference: quote.reference })}
      title={t('assistedQuotes.unbookableTitle', { reference: quote.reference })}
      description={t('assistedQuotes.unbookableNote')}
      reasons={ASSISTED_BOOKING_FAILURES}
      group="assistedQuotes.unbookableReasons"
      submitLabel={t('assistedQuotes.unbookableSubmit')}
      pending={unbookable.isPending}
      error={unbookable.error}
      onSubmit={(reason) =>
        unbookable.mutate({ params: { path: { assistedQuoteId: quote.id } }, body: { reason } })
      }
      onOpen={() => unbookable.reset()}
      open={open}
      setOpen={setOpen}
    />
  );
}

function QuoteCard({ quote }: { quote: Quote }) {
  const { can } = useStaffSession();
  const { request, booking } = quote;
  const open = quote.status === 'requested' || quote.status === 'offered';
  const actions: ReactNode[] = [];
  if (!booking && can('ai:approve')) {
    if (open || quote.status === 'expired') {
      actions.push(<VerifyDialog key="verify" quote={quote} />);
    }
    if (open) actions.push(<CloseDialog key="close" quote={quote} />);
  }
  if (booking?.waitsToBeBooked && can('bookings:manage')) {
    actions.push(<BookedDialog key="booked" quote={quote} />);
    actions.push(<UnbookableDialog key="unbookable" quote={quote} />);
  }
  const none = t('common.none');
  return (
    <Section
      title={`${quote.reference} · ${quote.title}`}
      intro={label('assistedQuotes.products', quote.product)}
      actions={actions.length > 0 ? actions : undefined}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={tone(quote.status)}>
          {label('assistedQuotes.statuses', quote.status)}
        </StatusBadge>
        {booking?.waitsToBeBooked ? (
          <StatusBadge tone="warning">{t('assistedQuotes.queues.to_book')}</StatusBadge>
        ) : null}
        <span className="font-body text-body-sm text-muted">
          {t('assistedQuotes.asked')} {format.dateTime(quote.createdAt)}
          {quote.status === 'requested'
            ? ` · ${t('assistedQuotes.answerBy')} ${format.dateTime(quote.answerBy)}`
            : ''}
        </span>
      </div>
      <DetailList
        items={[
          {
            term: t('assistedQuotes.where'),
            value: request.origin
              ? t('assistedQuotes.route', {
                  origin: request.origin,
                  destination: request.destination,
                })
              : request.destination,
          },
          {
            term: t('assistedQuotes.dates'),
            value: request.endDate
              ? format.dateRange(request.startDate, request.endDate)
              : format.date(request.startDate),
          },
          {
            term: t('assistedQuotes.travellers'),
            value: [
              t('assistedQuotes.adults', { count: request.adults }),
              ...(request.children > 0
                ? [t('assistedQuotes.children', { count: request.children })]
                : []),
            ].join(', '),
          },
          {
            term: t('assistedQuotes.seenElsewhere'),
            value: quote.indicative ? (
              <span className="flex flex-col gap-1">
                <span>
                  {t('assistedQuotes.seenElsewhereValue', {
                    price: format.money(quote.indicative.price),
                    source: quote.indicative.source,
                    time: format.dateTime(quote.indicative.seenAt),
                  })}
                </span>
                <span className="text-muted">{t('assistedQuotes.seenElsewhereNote')}</span>
              </span>
            ) : (
              none
            ),
          },
          {
            term: t('assistedQuotes.supplier'),
            value: quote.supplierName ?? none,
          },
          {
            term: t('assistedQuotes.supplierPrice'),
            value: quote.supplierPrice ? format.money(quote.supplierPrice) : none,
          },
          {
            term: t('assistedQuotes.proof'),
            value: quote.evidenceUrl ? (
              <a
                href={quote.evidenceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={LINK}
              >
                {t('assistedQuotes.openProof')}
              </a>
            ) : (
              none
            ),
          },
          {
            term: t('assistedQuotes.offer'),
            value: quote.offer
              ? t('assistedQuotes.offerValue', {
                  total: format.money(quote.offer.total),
                  time: format.dateTime(quote.offer.expiresAt),
                })
              : none,
          },
          {
            term: t('assistedQuotes.booking'),
            value: booking ? (
              <span className="flex flex-col gap-1">
                <span>
                  {t('assistedQuotes.bookingValue', {
                    reference: booking.reference,
                    status: label('bookingStatus', booking.status),
                  })}
                </span>
                <Link href={`/bookings/${booking.id}` as Route} className={LINK}>
                  {t('assistedQuotes.openBooking')}
                </Link>
              </span>
            ) : (
              none
            ),
          },
          {
            term: t('assistedQuotes.supplierReference'),
            value: booking?.supplierReference ?? none,
          },
          ...(quote.closedReason
            ? [
                {
                  term: t('assistedQuotes.closedReason'),
                  value: label('assistedQuotes.closeReasons', quote.closedReason),
                },
              ]
            : []),
        ]}
      />
    </Section>
  );
}

/**
 * The assisted quote queue (ADR-104): prices to verify with a supplier, and paid bookings to
 * book by hand. Verifying and closing need `ai:approve`; recording the supplier's confirmation
 * or that a booking cannot be made needs `bookings:manage`. Only a person's record of the
 * supplier's confirmation confirms such a booking.
 */
export function AssistedQuotesPage() {
  const [queue, setQueue] = useState<Queue>('to_verify');
  const query = $api.useQuery('get', PATH, { params: { query: { queue, limit: 50 } } });
  return (
    <RequirePermission permission="ai:read">
      <div className="flex flex-col gap-6">
        <PageHeader title={t('assistedQuotes.title')} intro={t('assistedQuotes.intro')} />
        <div className="max-w-popover">
          <SelectField
            label={t('assistedQuotes.queue')}
            name="queue"
            value={queue}
            options={QUEUES.map((value) => ({
              value,
              label: label('assistedQuotes.queues', value),
            }))}
            onChange={(event) => setQueue(event.target.value as Queue)}
          />
        </div>
        <QueryState query={query}>
          {(data) =>
            data.quotes.length === 0 ? (
              <p className="font-body text-body-sm text-muted">{t('assistedQuotes.empty')}</p>
            ) : (
              <div className="flex flex-col gap-4">
                {data.quotes.map((quote) => (
                  <QuoteCard key={quote.id} quote={quote} />
                ))}
              </div>
            )
          }
        </QueryState>
      </div>
    </RequirePermission>
  );
}
