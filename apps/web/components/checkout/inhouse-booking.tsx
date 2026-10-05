'use client';

import { useFormatters } from '@suskii/i18n/react';
import type { BookingStatus } from '@suskii/shared/lite';
import { Badge, Button, Card, Dialog, DialogContent, type BadgeProps } from '@suskii/ui-web';
import { useState } from 'react';

import type { Schemas } from '../../lib/browser-api';
import { AppLink } from '../app-link';

import { useBookingT } from './checkout-messages';

type Booking = Schemas['Booking'];
type ApplicationStatus = Schemas['VisaApplicationSummary']['status'];

/** Bookings an add-on can still be attached to (the API's `addon-links` rule, ADR-027). */
const LINKABLE: readonly BookingStatus[] = [
  'HELD',
  'PARTIALLY_PAID',
  'PAID',
  'TICKETING',
  'CONFIRMED',
];

const APPLICATION_VARIANT: Partial<Record<ApplicationStatus, NonNullable<BadgeProps['variant']>>> =
  {
    action_required: 'warning',
    approved: 'success',
    refused: 'danger',
    withdrawn: 'neutral',
  };

/** The voucher code to show on arrival (ADR-028); the PDF in Documents carries its QR code. */
export function VoucherCard({ voucher }: { voucher: NonNullable<Booking['voucher']> }) {
  const { t } = useBookingT();
  const format = useFormatters();
  return (
    <Card asChild className="flex flex-col gap-2 p-4">
      <section aria-labelledby="booking-voucher">
        <h2 id="booking-voucher" className="font-heading text-h3 font-bold text-heading">
          {t('booking.inhouse.voucher')}
        </h2>
        <p
          className="font-heading text-h3 font-extrabold tracking-wide text-heading"
          data-testid="voucher-code"
        >
          {voucher.code}
        </p>
        <p className="font-body text-body-sm text-foreground">
          {voucher.redeemedAt
            ? t('booking.inhouse.voucherRedeemed', { date: format.dateTime(voucher.redeemedAt) })
            : t('booking.inhouse.voucherHint')}
        </p>
      </section>
    </Card>
  );
}

/**
 * Cancelling a confirmed package, tour or add-on under its policy (ADR-028): the exact refund
 * comes from the API and is confirmed in a dialog before anything happens.
 */
export function CancelUnderPolicy({
  cancellation,
  busy,
  onCancel,
}: {
  cancellation: NonNullable<Booking['cancellation']>;
  busy: boolean;
  onCancel: () => Promise<void>;
}) {
  const { t } = useBookingT();
  const format = useFormatters();
  const [confirming, setConfirming] = useState(false);
  const percent = format.number(cancellation.refundBps / 100);
  return (
    <>
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        {t('booking.inhouse.cancel')}
      </Button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        {confirming ? (
          <DialogContent
            title={t('booking.inhouse.cancelTitle')}
            description={
              cancellation.refund.amountMinor > 0
                ? t('booking.inhouse.cancelRefund', {
                    amount: format.money(cancellation.refund),
                    percent,
                  })
                : t('booking.inhouse.cancelNoRefund')
            }
            closeLabel={t('common.close')}
          >
            <div className="flex flex-col gap-2 md:flex-row md:justify-end">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                {t('booking.inhouse.cancelKeep')}
              </Button>
              <Button
                loading={busy}
                onClick={() => {
                  void onCancel().finally(() => setConfirming(false));
                }}
              >
                {t('booking.inhouse.cancelConfirm')}
              </Button>
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </>
  );
}

/** One application per applicant, opened once the booking is confirmed (ADR-026). */
export function VisaApplications({ booking }: { booking: Booking }) {
  const { t } = useBookingT();
  const applications = booking.visa?.applications ?? [];
  if (applications.length === 0) return null;
  return (
    <Card asChild className="flex flex-col gap-3 p-4">
      <section aria-labelledby="booking-visa-applications">
        <h2 id="booking-visa-applications" className="font-heading text-h3 font-bold text-heading">
          {t('booking.inhouse.applications')}
        </h2>
        <ul className="flex flex-col gap-3">
          {applications.map((application) => {
            const passenger = booking.passengers.find(
              (candidate) => candidate.position === application.applicantPosition,
            );
            return (
              <li
                key={application.id}
                className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between"
              >
                <div className="flex flex-col gap-1">
                  <p className="font-body text-body font-bold text-foreground">
                    {passenger
                      ? `${passenger.givenNames} ${passenger.surname}`
                      : t('booking.inhouse.applicant', {
                          number: application.applicantPosition + 1,
                        })}
                  </p>
                  <Badge
                    variant={APPLICATION_VARIANT[application.status] ?? 'info'}
                    data-testid="visa-application-status"
                  >
                    {t(`booking.inhouse.applicationStatus.${application.status}`)}
                  </Badge>
                </div>
                <Button asChild variant="secondary">
                  <AppLink href={`/bookings/${booking.id}/visa/${application.id}`}>
                    {t('booking.inhouse.openApplication')}
                  </AppLink>
                </Button>
              </li>
            );
          })}
        </ul>
      </section>
    </Card>
  );
}

/** Add-ons bought for this trip, and a way to add more while the trip can take them. */
export function TripExtras({ booking }: { booking: Booking }) {
  const { t } = useBookingT();
  const canAdd = booking.vertical !== 'travel_addons' && LINKABLE.includes(booking.status);
  if (booking.addons.length === 0 && !canAdd) return null;
  return (
    <Card asChild className="flex flex-col gap-3 p-4">
      <section aria-labelledby="booking-extras">
        <h2 id="booking-extras" className="font-heading text-h4 font-bold text-heading">
          {t('booking.inhouse.extras')}
        </h2>
        {booking.addons.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {booking.addons.map((addon) => (
              <li key={addon.id} className="flex flex-col gap-1">
                <AppLink
                  href={`/bookings/${addon.id}`}
                  className="font-body text-body-sm font-bold text-primary underline"
                >
                  {addon.title} ({addon.reference})
                </AppLink>
                <p className="font-body text-caption text-foreground">
                  {t(`booking.inhouse.types.${addon.type}`)} · {t(`booking.status.${addon.status}`)}
                </p>
              </li>
            ))}
          </ul>
        ) : null}
        {canAdd ? (
          <Button asChild variant="secondary">
            <AppLink href={`/travel-add-ons?for=${booking.id}`}>
              {t('booking.inhouse.addExtras')}
            </AppLink>
          </Button>
        ) : null}
      </section>
    </Card>
  );
}
