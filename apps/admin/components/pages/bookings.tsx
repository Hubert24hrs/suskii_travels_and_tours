'use client';

import { BOOKING_STATUSES, parseMoney, toWire } from '@suskii/shared';
import { Button, useToast } from '@suskii/ui-web';
import { useQueryClient } from '@tanstack/react-query';
import type { Route } from 'next';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { $api, adminApi, idempotencyKey, problemMessage, type Schemas } from '../../lib/api';
import { format, label, t } from '../../lib/i18n';
import { unwrap, useCursorPages } from '../../lib/queries';
import { RequirePermission } from '../console-shell';
import { useStaffSession } from '../staff-session';
import {
  CheckboxField,
  DataTable,
  DetailList,
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

type Row = Schemas['AdminBookingRow'];
type Detail = Schemas['AdminBookingDetail'];
type Status = (typeof BOOKING_STATUSES)[number];

const VERTICALS = ['flights', 'hotels', 'packages', 'tours', 'visa', 'travel_addons', 'prime'];

type StaffRefundReason = Schemas['CreateRefundRequestInput']['reason'];
/** The reasons staff may give (the others are reserved for automatic refunds). */
const STAFF_REFUND_REASONS: readonly StaffRefundReason[] = [
  'customer_cancellation',
  'supplier_cancellation',
  'goodwill',
  'duplicate_payment',
  'ticketing_failed',
  'other',
];

export function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' | 'info' {
  if (status === 'CONFIRMED' || status === 'PAID') return 'success';
  if (status === 'FAILED' || status === 'CANCELLED' || status === 'EXPIRED') return 'danger';
  if (status === 'REFUND_PENDING' || status === 'PARTIALLY_PAID' || status === 'HELD')
    return 'warning';
  if (status === 'REFUNDED' || status === 'DRAFT') return 'neutral';
  return 'info';
}

/** "LOS → ABV, 6 Nov 2026", the hotel or the product, for a booking summary. */
export function tripLabel(trip: Row['trip']): string {
  if (!trip) return t('bookings.detail.membership');
  const date = format.date(trip.startsOn, 'medium');
  if (trip.flight) {
    return t('bookings.detail.tripFlight', {
      origin: trip.flight.origin.code,
      destination: trip.flight.destination.code,
      date,
    });
  }
  if (trip.hotel) return t('bookings.detail.tripStay', { name: trip.hotel.name, date });
  if (trip.product) return t('bookings.detail.tripProduct', { title: trip.product.title, date });
  return date;
}

interface Filters {
  q?: string;
  status?: Status;
  vertical?: string;
  from?: string;
  to?: string;
}

export function BookingsPage() {
  const params = useSearchParams();
  const initialStatus = params.get('status');
  const [filters, setFilters] = useState<Filters>(
    initialStatus && (BOOKING_STATUSES as readonly string[]).includes(initialStatus)
      ? { status: initialStatus as Status }
      : {},
  );
  const [draft, setDraft] = useState<Filters>(filters);
  const pages = useCursorPages(['get', '/v1/admin/bookings', filters], async (cursor) =>
    unwrap(
      await adminApi.GET('/v1/admin/bookings', {
        params: {
          query: {
            ...filters,
            vertical: filters.vertical as Row['vertical'] | undefined,
            ...(cursor ? { cursor } : {}),
          },
        },
      }),
    ),
  );
  const rows = pages.data?.pages.flatMap((page) => page.items) ?? [];

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const next: Filters = {};
    if (draft.q?.trim()) next.q = draft.q.trim();
    if (draft.status) next.status = draft.status;
    if (draft.vertical) next.vertical = draft.vertical;
    if (draft.from) next.from = draft.from;
    if (draft.to) next.to = draft.to;
    setFilters(next);
  };

  return (
    <RequirePermission permission="bookings:read">
      <PageHeader title={t('bookings.title')} />
      <form
        method="post"
        onSubmit={apply}
        className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-6 lg:items-end"
      >
        <div className="md:col-span-3 lg:col-span-2">
          <TextField
            label={t('bookings.search')}
            hint={t('bookings.searchHint')}
            name="q"
            value={draft.q ?? ''}
            onChange={(event) => setDraft((current) => ({ ...current, q: event.target.value }))}
          />
        </div>
        <SelectField
          label={t('bookings.status')}
          name="status"
          value={draft.status ?? ''}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              status: (event.target.value || undefined) as Status | undefined,
            }))
          }
          options={[
            { value: '', label: t('common.all') },
            ...BOOKING_STATUSES.map((status) => ({
              value: status,
              label: label('bookingStatus', status),
            })),
          ]}
        />
        <SelectField
          label={t('bookings.vertical')}
          name="vertical"
          value={draft.vertical ?? ''}
          onChange={(event) =>
            setDraft((current) => ({ ...current, vertical: event.target.value || undefined }))
          }
          options={[
            { value: '', label: t('common.all') },
            ...VERTICALS.map((vertical) => ({
              value: vertical,
              label: label('verticals', vertical),
            })),
          ]}
        />
        <TextField
          label={t('bookings.from')}
          type="date"
          name="from"
          value={draft.from ?? ''}
          onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
        />
        <TextField
          label={t('bookings.to')}
          type="date"
          name="to"
          value={draft.to ?? ''}
          onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
        />
        <Button type="submit">{t('common.search')}</Button>
      </form>
      <QueryState query={{ ...pages, data: pages.data ? rows : undefined }}>
        {(items) => (
          <>
            <DataTable
              caption={t('bookings.title')}
              rows={items}
              rowKey={(row) => row.id}
              columns={[
                {
                  key: 'reference',
                  header: t('bookings.reference'),
                  cell: (row) => (
                    <Link
                      href={`/bookings/${row.id}` as Route}
                      className="font-bold text-primary underline focus-visible:focus-ring"
                      aria-label={t('bookings.open', { reference: row.reference })}
                    >
                      {row.reference}
                    </Link>
                  ),
                },
                {
                  key: 'status',
                  header: t('bookings.status'),
                  cell: (row) => (
                    <StatusBadge tone={statusTone(row.status)}>
                      {label('bookingStatus', row.status)}
                    </StatusBadge>
                  ),
                },
                {
                  key: 'vertical',
                  header: t('bookings.vertical'),
                  cell: (row) => label('verticals', row.vertical),
                },
                { key: 'trip', header: t('bookings.trip'), cell: (row) => tripLabel(row.trip) },
                {
                  key: 'total',
                  header: t('bookings.total'),
                  cell: (row) => format.money(row.total),
                },
                {
                  key: 'account',
                  header: t('bookings.account'),
                  cell: (row) => (row.accountId ? t('common.yes') : t('bookings.guest')),
                },
                {
                  key: 'created',
                  header: t('bookings.created'),
                  cell: (row) => format.dateTime(row.createdAt),
                },
              ]}
            />
            {pages.hasNextPage ? (
              <Button
                variant="ghost"
                loading={pages.isFetchingNextPage}
                onClick={() => void pages.fetchNextPage()}
              >
                {t('common.loadMore')}
              </Button>
            ) : null}
          </>
        )}
      </QueryState>
    </RequirePermission>
  );
}

// ---------------------------------------------------------------------------
// One booking
// ---------------------------------------------------------------------------

function useInvalidateBooking(bookingId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/bookings/{bookingId}'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/bookings'] }),
      queryClient.invalidateQueries({ queryKey: ['get', '/v1/admin/refunds'] }),
    ]).then(() => bookingId);
}

function ContactSection({ detail }: { detail: Detail }) {
  const reveal = $api.useMutation('post', '/v1/admin/bookings/{bookingId}/contact');
  const { contact } = detail.booking;
  return (
    <Section title={t('bookings.detail.contact')}>
      <p className="font-body text-body-sm text-foreground">
        {t('bookings.detail.contactMasked', { email: contact.email, phone: contact.phone })}
      </p>
      {reveal.data ? (
        <p
          className="font-body text-body-sm font-bold text-foreground"
          data-testid="revealed-contact"
        >
          {reveal.data.redacted
            ? t('bookings.detail.redacted')
            : t('bookings.detail.revealed', { email: reveal.data.email, phone: reveal.data.phone })}
        </p>
      ) : (
        <div>
          <Button
            variant="ghost"
            loading={reveal.isPending}
            onClick={() => reveal.mutate({ params: { path: { bookingId: detail.booking.id } } })}
          >
            {t('bookings.detail.reveal')}
          </Button>
        </div>
      )}
      <ProblemAlert error={reveal.error} />
    </Section>
  );
}

function NotesSection({ detail }: { detail: Detail }) {
  const [text, setText] = useState('');
  const invalidate = useInvalidateBooking(detail.booking.id);
  const add = $api.useMutation('post', '/v1/admin/bookings/{bookingId}/notes', {
    onSuccess: async () => {
      setText('');
      await invalidate();
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    add.mutate({ params: { path: { bookingId: detail.booking.id } }, body: { text } });
  };
  return (
    <Section title={t('bookings.detail.notes')} intro={t('bookings.detail.notesHint')}>
      {detail.notes.length === 0 ? (
        <p className="font-body text-body-sm text-muted">{t('bookings.detail.noNotes')}</p>
      ) : (
        <ul className="flex flex-col gap-3" data-testid="booking-notes">
          {detail.notes.map((note) => (
            <li key={note.id} className="flex flex-col gap-1 border-b border-border pb-3">
              <p className="font-body text-body-sm whitespace-pre-wrap text-foreground">
                {note.text}
              </p>
              <p className="font-body text-caption text-muted">{format.dateTime(note.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
      <form method="post" onSubmit={submit} className="flex flex-col gap-3">
        <TextAreaField
          label={t('bookings.detail.noteText')}
          name="note"
          value={text}
          maxLength={2000}
          required
          onChange={(event) => setText(event.target.value)}
        />
        <ProblemAlert error={add.error} />
        <div>
          <Button type="submit" loading={add.isPending}>
            {t('bookings.detail.addNote')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function RefundRequestForm({ detail }: { detail: Detail }) {
  const { toast } = useToast();
  const invalidate = useInvalidateBooking(detail.booking.id);
  const succeeded = detail.payments.filter((payment) => payment.status === 'succeeded');
  const [key, setKey] = useState(idempotencyKey);
  const [form, setForm] = useState({
    paymentId: succeeded[0]?.id ?? '',
    amount: '',
    reason: 'goodwill' as StaffRefundReason,
    destination: 'original' as 'original' | 'wallet',
    note: '',
    cancelBooking: false,
  });
  const [amountError, setAmountError] = useState<string | undefined>();
  const create = $api.useMutation('post', '/v1/admin/bookings/{bookingId}/refunds', {
    onSuccess: async () => {
      toast({ title: t('bookings.detail.refundRequested'), variant: 'success' });
      setKey(idempotencyKey());
      setForm((current) => ({ ...current, amount: '', note: '', cancelBooking: false }));
      await invalidate();
    },
  });
  if (succeeded.length === 0) return null;
  const payment = succeeded.find((candidate) => candidate.id === form.paymentId) ?? succeeded[0];
  const currency = payment?.amount.currency ?? detail.booking.price.currency;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    let amount: { amountMinor: number; currency: string };
    try {
      amount = toWire(parseMoney(form.amount.trim(), currency));
      setAmountError(undefined);
    } catch {
      setAmountError(t('common.validation'));
      return;
    }
    create.mutate({
      params: { path: { bookingId: detail.booking.id }, header: { 'Idempotency-Key': key } },
      body: {
        paymentId: form.paymentId,
        amount,
        reason: form.reason,
        destination: form.destination,
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
        cancelBooking: form.cancelBooking,
      },
    });
  };

  return (
    <form
      method="post"
      onSubmit={submit}
      className="flex flex-col gap-4"
      aria-label={t('bookings.detail.requestRefund')}
    >
      <h3 className="font-heading text-body font-bold text-heading">
        {t('bookings.detail.requestRefund')}
      </h3>
      <FormGrid>
        <SelectField
          label={t('bookings.detail.payment')}
          name="paymentId"
          value={form.paymentId}
          onChange={(event) =>
            setForm((current) => ({ ...current, paymentId: event.target.value }))
          }
          options={succeeded.map((candidate) => ({
            value: candidate.id,
            label: `${format.money(candidate.amount)} · ${candidate.provider} · ${format.date(candidate.createdAt.slice(0, 10), 'medium')}`,
          }))}
        />
        <TextField
          label={t('bookings.detail.refundAmount', { currency })}
          name="amount"
          inputMode="decimal"
          value={form.amount}
          error={amountError}
          required
          onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
          data-testid="refund-amount"
        />
        <SelectField
          label={t('bookings.detail.refundReason')}
          name="reason"
          value={form.reason}
          onChange={(event) =>
            setForm((current) => ({ ...current, reason: event.target.value as typeof form.reason }))
          }
          options={STAFF_REFUND_REASONS.map((reason) => ({
            value: reason,
            label: label('refunds.reasons', reason),
          }))}
        />
        <SelectField
          label={t('bookings.detail.destination')}
          name="destination"
          value={form.destination}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              destination: event.target.value as typeof form.destination,
            }))
          }
          options={[
            { value: 'original', label: t('bookings.detail.destinations.original') },
            ...(detail.accountId
              ? [{ value: 'wallet', label: t('bookings.detail.destinations.wallet') }]
              : []),
          ]}
        />
      </FormGrid>
      <TextAreaField
        label={t('bookings.detail.refundNote')}
        name="refundNote"
        value={form.note}
        maxLength={500}
        rows={2}
        onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
      />
      <CheckboxField
        label={t('bookings.detail.cancelBooking')}
        name="cancelBooking"
        checked={form.cancelBooking}
        onChange={(event) =>
          setForm((current) => ({ ...current, cancelBooking: event.target.checked }))
        }
      />
      <ProblemAlert error={create.error} />
      <div>
        <Button type="submit" loading={create.isPending}>
          {t('bookings.detail.requestRefund')}
        </Button>
      </div>
    </form>
  );
}

function BookingDetailBody({ detail }: { detail: Detail }) {
  const { can } = useStaffSession();
  const { toast } = useToast();
  const { booking } = detail;
  const resend = $api.useMutation('post', '/v1/admin/bookings/{bookingId}/confirmation', {
    onSuccess: () => toast({ title: t('bookings.detail.resent'), variant: 'success' }),
    onError: (error) => toast({ title: problemMessage(error), variant: 'error' }),
  });
  return (
    <>
      <PageHeader
        title={t('bookings.detail.title', { reference: booking.reference })}
        actions={
          can('bookings:manage') && booking.status === 'CONFIRMED' ? (
            <Button
              variant="ghost"
              loading={resend.isPending}
              onClick={() => resend.mutate({ params: { path: { bookingId: booking.id } } })}
            >
              {t('bookings.detail.resend')}
            </Button>
          ) : undefined
        }
      />
      <Section title={t('bookings.detail.summary')}>
        <DetailList
          items={[
            {
              term: t('common.status'),
              value: (
                <StatusBadge tone={statusTone(booking.status)}>
                  {label('bookingStatus', booking.status)}
                </StatusBadge>
              ),
            },
            { term: t('bookings.vertical'), value: label('verticals', booking.vertical) },
            { term: t('bookings.total'), value: format.money(booking.price.total) },
            { term: t('bookings.detail.paid'), value: format.money(booking.paid) },
            {
              term: t('bookings.detail.due'),
              value: booking.amountDue ? format.money(booking.amountDue) : t('common.none'),
            },
            { term: t('bookings.created'), value: format.dateTime(booking.createdAt) },
            {
              term: t('bookings.detail.confirmedAt'),
              value: booking.confirmedAt ? format.dateTime(booking.confirmedAt) : t('common.none'),
            },
            {
              term: t('bookings.account'),
              value:
                detail.accountId && can('users:read') ? (
                  <Link
                    href={`/users/${detail.accountId}` as Route}
                    className="text-primary underline focus-visible:focus-ring"
                  >
                    {t('bookings.detail.openAccount')}
                  </Link>
                ) : (
                  (detail.accountId ?? t('bookings.guest'))
                ),
            },
          ]}
        />
      </Section>
      <ContactSection detail={detail} />
      <Section title={t('bookings.detail.travellers')}>
        <ul className="flex flex-col gap-1 font-body text-body-sm">
          {booking.passengers.map((passenger) => (
            <li key={passenger.position}>
              {t('bookings.detail.traveller', {
                name: `${passenger.givenNames} ${passenger.surname}`,
                type: label('bookings.detail.passengerTypes', passenger.type),
              })}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t('bookings.detail.payments')}>
        <DataTable
          caption={t('bookings.detail.payments')}
          rows={detail.payments}
          rowKey={(row) => row.id}
          empty={t('bookings.detail.noPayments')}
          columns={[
            { key: 'amount', header: t('common.amount'), cell: (row) => format.money(row.amount) },
            {
              key: 'status',
              header: t('common.status'),
              cell: (row) => label('bookings.detail.paymentStatuses', row.status),
            },
            { key: 'provider', header: t('bookings.detail.provider'), cell: (row) => row.provider },
            {
              key: 'kind',
              header: t('bookings.detail.kind'),
              cell: (row) => label('bookings.detail.kinds', row.kind),
            },
            {
              key: 'method',
              header: t('bookings.detail.method'),
              cell: (row) => row.method ?? t('common.none'),
            },
            {
              key: 'created',
              header: t('bookings.detail.when'),
              cell: (row) => format.dateTime(row.createdAt),
            },
          ]}
        />
      </Section>
      <Section title={t('bookings.detail.refunds')}>
        <DataTable
          caption={t('bookings.detail.refunds')}
          rows={booking.refunds}
          rowKey={(row) => row.id}
          empty={t('bookings.detail.noRefunds')}
          columns={[
            { key: 'amount', header: t('common.amount'), cell: (row) => format.money(row.amount) },
            {
              key: 'status',
              header: t('common.status'),
              cell: (row) => label('refunds.statuses', row.status),
            },
            {
              key: 'destination',
              header: t('bookings.detail.destination'),
              cell: (row) => label('bookings.detail.destinations', row.destination),
            },
            {
              key: 'created',
              header: t('bookings.detail.when'),
              cell: (row) => format.dateTime(row.createdAt),
            },
          ]}
        />
        {can('refunds:request') ? <RefundRequestForm detail={detail} /> : null}
      </Section>
      <Section title={t('bookings.detail.history')}>
        <DataTable
          caption={t('bookings.detail.history')}
          rows={detail.history}
          rowKey={(row) => `${row.occurredAt}-${row.toStatus}-${row.event}`}
          columns={[
            {
              key: 'status',
              header: t('common.status'),
              cell: (row) => label('bookingStatus', row.toStatus),
            },
            { key: 'event', header: t('bookings.detail.event'), cell: (row) => row.event },
            {
              key: 'actor',
              header: t('bookings.detail.actor'),
              cell: (row) => label('actors', row.actorType),
            },
            {
              key: 'reason',
              header: t('common.reason'),
              cell: (row) => row.reason ?? t('common.none'),
            },
            {
              key: 'when',
              header: t('bookings.detail.when'),
              cell: (row) => format.dateTime(row.occurredAt),
            },
          ]}
        />
      </Section>
      <NotesSection detail={detail} />
    </>
  );
}

export function BookingDetailPage({ bookingId }: { bookingId: string }) {
  const query = $api.useQuery('get', '/v1/admin/bookings/{bookingId}', {
    params: { path: { bookingId } },
  });
  return (
    <RequirePermission permission="bookings:read">
      <div>
        <Link
          href="/bookings"
          className="font-body text-body-sm text-primary underline focus-visible:focus-ring"
        >
          {t('common.back')}
        </Link>
      </div>
      <QueryState query={query}>{(detail) => <BookingDetailBody detail={detail} />}</QueryState>
    </RequirePermission>
  );
}
