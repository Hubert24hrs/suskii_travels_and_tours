import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Button, Card, Input } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Text } from 'react-native';

import { ISO_DAY } from '../../lib/cars';
import { problemSlug } from '../../lib/api';
import { pickDocument } from '../../lib/visa-upload';
import { useApp, useT } from '../../providers/app-provider';

type Reservation = Schemas['RentalReservation'];

// `other` (and anything new) reads as the generic reason; a key named `other` would be a plural.
const REJECTIONS = ['unreadable', 'expired', 'name_mismatch', 'not_a_licence'] as const;
const rejection = (reason: string | null): (typeof REJECTIONS)[number] | 'generic' =>
  REJECTIONS.find((known) => known === reason) ?? 'generic';

/**
 * The renter's driving licence for a self-drive rental (ADR-051): number and expiry first, then a
 * photo or scan from the system document picker. Staff check it before the car is collected; the
 * card follows the virus scan until it settles.
 */
export function RentalLicence({ reservationId }: { reservationId: string }) {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const [number, setNumber] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = { params: { path: { reservationId } } };

  const query = useQuery({
    queryKey: ['rental-reservation', reservationId],
    // A scan in progress settles in seconds.
    refetchInterval: (state) =>
      state.state.data?.licence?.status === 'pending_scan' ? 3_000 : false,
    queryFn: async (): Promise<Reservation> => {
      const { data, response } = await api.GET('/v1/rentals/reservations/{reservationId}', path);
      if (!data) throw new Error(String(response.status));
      return data;
    },
  });
  const reservation = query.data;
  if (!reservation) return null;
  const licence = reservation.licence;
  const open = reservation.status === 'reserved' && licence?.status !== 'approved';

  const failure = (slug: string | null, status: number): string =>
    status === 413
      ? t('booking.cars.rental.licence.errors.size')
      : status === 415
        ? t('booking.cars.rental.licence.errors.type')
        : slug === 'rental-conflict' && status === 409
          ? t('booking.cars.rental.licence.errors.closed')
          : t('booking.cars.rental.licence.errors.generic');

  const save = async () => {
    setError(null);
    if (!number.trim() || !ISO_DAY.test(expiresOn)) {
      setError(t('booking.cars.rental.licence.errors.generic'));
      return;
    }
    setBusy(true);
    try {
      const {
        data,
        error: problem,
        response,
      } = await api.PUT('/v1/rentals/reservations/{reservationId}/licence', {
        ...path,
        body: { number: number.trim(), expiresOn },
      });
      if (data) {
        setNumber('');
        await query.refetch();
      } else {
        const detail = (problem as { detail?: string } | undefined)?.detail ?? '';
        setError(
          /expires/i.test(detail)
            ? t('booking.cars.rental.licence.errors.expires')
            : failure(problemSlug(problem), response.status),
        );
      }
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  const upload = async () => {
    setError(null);
    let picked: Awaited<ReturnType<typeof pickDocument>>;
    try {
      picked = await pickDocument();
    } catch {
      setError(t('mobile.visa.pickerFailed'));
      return;
    }
    if (picked === 'cancelled') return;
    if (picked === 'unsupported') {
      setError(t('booking.cars.rental.licence.errors.type'));
      return;
    }
    setBusy(true);
    try {
      const {
        data,
        error: problem,
        response,
      } = await api.PUT('/v1/rentals/reservations/{reservationId}/licence/document', {
        ...path,
        // The raw bytes are the body (no JSON); the declared type only picks the parser.
        body: picked.bytes as unknown as string,
        bodySerializer: (body) => body,
        headers: { 'Content-Type': picked.type },
      });
      if (data) await query.refetch();
      else setError(failure(problemSlug(problem), response.status));
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID="rental-licence" className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('booking.cars.rental.licence.heading')}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {t('booking.cars.rental.licence.intro')}
      </Text>
      {licence ? (
        <>
          <Text className="font-body text-body-sm text-foreground">
            {t('booking.cars.rental.licence.endsWith', {
              hint: licence.numberEndsWith,
              date: format.date(licence.expiresOn, 'medium'),
            })}
          </Text>
          <Text
            testID="licence-status"
            accessibilityLiveRegion="polite"
            className="font-body-bold text-body text-foreground"
          >
            {licence.status === 'rejected'
              ? t('booking.cars.rental.licence.states.rejected', {
                  reason: t(
                    `booking.cars.rental.licence.reasons.${rejection(licence.rejectionReason)}`,
                  ),
                })
              : t(`booking.cars.rental.licence.states.${licence.status}`)}
          </Text>
        </>
      ) : null}
      {open && (!licence || licence.status === 'rejected') ? (
        <>
          <Input
            testID="licence-number"
            label={t('booking.cars.rental.licence.number')}
            value={number}
            onChangeText={setNumber}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            maxLength={30}
          />
          <Input
            testID="licence-expiry"
            label={t('booking.cars.rental.licence.expiresOn')}
            hint={t('mobile.cars.dateHint')}
            value={expiresOn}
            onChangeText={setExpiresOn}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
          />
          <Button testID="licence-save" loading={busy} onPress={() => void save()}>
            {t('booking.cars.rental.licence.save')}
          </Button>
        </>
      ) : null}
      {open && licence && licence.status !== 'rejected' ? (
        <Button
          testID="licence-upload"
          variant="secondary"
          loading={busy}
          onPress={() => void upload()}
        >
          {busy
            ? t('booking.cars.rental.licence.uploading')
            : t('booking.cars.rental.licence.upload')}
        </Button>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}
    </Card>
  );
}
