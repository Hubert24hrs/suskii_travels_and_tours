import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { tripTitle } from '@suskii/shared';
import { Button, Card } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { Loading, Notice } from '../components/states';
import { useSensitiveScreen } from '../hooks/use-sensitive-screen';
import { isNetworkError } from '../lib/api';
import { sharePlanPdf } from '../lib/plan-pdf';
import { tripBookingLine } from '../lib/trip-builder';
import { useApp, useT } from '../providers/app-provider';

type Receipt = Schemas['TripReceipt'];
type Loaded = { kind: 'ready'; receipt: Receipt } | { kind: 'not_paid' };

/** The channels a payment provider reports that the receipt puts into words (ADR-120). */
const METHODS = [
  'card',
  'bank',
  'bank_transfer',
  'ussd',
  'qr',
  'mobile_money',
  'apple_pay',
  'google_pay',
  'agent',
] as const;
type ReceiptMethod = (typeof METHODS)[number];

/** A channel the receipt can name; any other is left out rather than shown as a code. */
const knownMethod = (method: string | null): ReceiptMethod | null =>
  METHODS.find((entry) => entry === method) ?? null;

function Row({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View className="flex-row justify-between gap-4">
      <Text className="flex-1 font-body text-body-sm text-foreground">{label}</Text>
      <Text testID={testID} className="shrink font-body-bold text-body-sm text-foreground">
        {value}
      </Text>
    </View>
  );
}

/**
 * A paid trip's receipt, read in the app (ADR-120): each payment that went through, what each
 * part took of it with the service taxes inside, and the total paid. It is the receipt PDF's
 * own content (`GET /v1/trips/{tripId}/receipt/details`), put into the app's words; the PDF
 * itself goes to the share sheet to keep or send on.
 */
function TripReceipt({ tripId }: { tripId: string }) {
  const { api, session } = useApp();
  const { t } = useT();
  const format = useFormatters();
  useSensitiveScreen();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['trip-receipt', tripId],
    queryFn: async (): Promise<Loaded> => {
      const { data, response } = await api.GET('/v1/trips/{tripId}/receipt/details', {
        params: { path: { tripId } },
      });
      if (data) return { kind: 'ready', receipt: data };
      if (response.status === 409) return { kind: 'not_paid' };
      // The screen opens from a trip the account just read, so a 404 is more likely a server
      // older than the receipt's data than a trip that is gone, and the two answer alike: say
      // only that the receipt could not be read, never that the trip is not there.
      throw new Error('receipt unavailable');
    },
  });
  const { refetch } = query;

  if (query.isPending) return <Loading label={t('common.loading')} />;
  if (!query.data)
    return (
      <Notice
        testID="trip-receipt-error"
        body={isNetworkError(query.error) ? t('mobile.networkError') : t('trips.receipt.loadError')}
        action={t('trips.page.retry')}
        onAction={() => void refetch()}
      />
    );
  if (query.data.kind === 'not_paid')
    return <Notice testID="trip-receipt-not-paid" body={t('trips.receipt.notPaid')} />;

  const { receipt } = query.data;
  const { plan } = receipt;
  const travellers = [
    t('trips.adults', { count: plan.adults }),
    ...(plan.children > 0 ? [t('trips.children', { count: plan.children })] : []),
  ].join(', ');
  // The seller's tax registration, once however many parts name it, as the PDF prints it.
  const registrations = [
    ...new Set(
      receipt.parts.flatMap((part) =>
        part.serviceTaxes.flatMap((tax) =>
          tax.registrationNumber ? [tax.registrationNumber] : [],
        ),
      ),
    ),
  ];

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await sharePlanPdf(
        session,
        `/v1/trips/${receipt.tripId}/receipt`,
        `suskii-receipt-${receipt.reference}.pdf`,
        t('trips.receipt.download'),
      );
    } catch {
      setError(t('trips.receipt.failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      testID="trip-receipt-screen"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
    >
      <View className="gap-2">
        <Text accessibilityRole="header" className="font-heading-extrabold text-h3 text-heading">
          {t('trips.receipt.heading')}
        </Text>
        <Text className="font-body text-body text-foreground">
          {t('trips.route', tripTitle(plan))}
        </Text>
        <Text className="font-body text-body-sm text-foreground">
          {format.dateRange(plan.departDate, plan.returnDate, 'weekday')}
          {' · '}
          {travellers}
        </Text>
        <Text testID="trip-receipt-reference" className="font-body text-body-sm text-muted">
          {t('trips.page.reference', { reference: receipt.reference })}
        </Text>
      </View>

      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}

      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('trips.receipt.paymentsHeading')}
      </Text>
      {receipt.payments.map((payment, index) => {
        const method = knownMethod(payment.method);
        return (
          <Card
            key={payment.reference}
            testID={`trip-receipt-payment-${index}`}
            className="gap-2 p-4"
          >
            <Row
              label={t('trips.receipt.paidOn')}
              value={format.dateTime(payment.paidAt, undefined, { year: true })}
            />
            <Row label={t('trips.receipt.amount')} value={format.money(payment.amount)} />
            {method ? (
              <Row label={t('trips.receipt.method')} value={t(`trips.receipt.methods.${method}`)} />
            ) : null}
            <Row label={t('trips.receipt.reference')} value={payment.reference} />
            {payment.refunded ? (
              <Row
                testID={`trip-receipt-refund-${index}`}
                label={t('trips.receipt.refundStarted')}
                value={format.money(payment.refunded)}
              />
            ) : null}
          </Card>
        );
      })}

      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('trips.receipt.partsHeading')}
      </Text>
      {receipt.parts.map((part) => (
        <Card
          key={part.bookingId}
          testID={`trip-receipt-part-${part.component ?? 'other'}`}
          className="gap-2 p-4"
        >
          <View className="flex-row items-start justify-between gap-3">
            <View className="flex-1 gap-1">
              <Text className="font-heading text-body text-heading">
                {part.component
                  ? t(`trips.components.${part.component}`)
                  : t('trips.receipt.otherPart')}
              </Text>
              {part.booking ? (
                <Text className="font-body text-body-sm text-foreground">
                  {tripBookingLine(part.booking, t)}
                </Text>
              ) : null}
              <Text className="font-body text-body-sm text-muted">
                {t('trips.receipt.booking', { reference: part.bookingReference })}
              </Text>
            </View>
            <Text className="font-body-bold text-body text-heading">
              {format.money(part.amount)}
            </Text>
          </View>
          {part.serviceTaxes.map((tax) => (
            <Row
              key={`${tax.label}:${tax.rateBps}`}
              label={t('trips.receipt.includes', {
                tax: t('checkout.serviceTax', {
                  label: tax.label,
                  rate: format.number(tax.rateBps / 100),
                }),
              })}
              value={format.money(tax.amount)}
            />
          ))}
        </Card>
      ))}

      <View className="flex-row justify-between gap-4 border-t border-border pt-3">
        <Text className="flex-1 font-body-bold text-body text-heading">
          {t('trips.receipt.totalPaid')}
        </Text>
        <Text testID="trip-receipt-total" className="font-heading text-h4 text-heading">
          {format.money(receipt.total)}
        </Text>
      </View>
      {registrations.map((number) => (
        <Row key={number} label={t('trips.receipt.taxRegistration')} value={number} />
      ))}

      <Text className="font-body text-caption text-foreground">{t('trips.receipt.note')}</Text>
      <Button testID="trip-receipt-save" fullWidth loading={saving} onPress={() => void save()}>
        {t('trips.receipt.download')}
      </Button>
    </ScrollView>
  );
}

export function TripReceiptScreen() {
  const { tripId } = useLocalSearchParams<{ tripId: string }>();
  return (
    <RequireAccount>
      <TripReceipt tripId={tripId} />
    </RequireAccount>
  );
}
