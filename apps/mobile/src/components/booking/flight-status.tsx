import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { FINAL_FLIGHT_STATES, type FlightState } from '@suskii/shared';
import { Badge, Card } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { Text, View } from 'react-native';

import { tripStore } from '../../lib/trips';
import { useApp, useT } from '../../providers/app-provider';

type Flight = Schemas['FlightStatus']['flights'][number];

/** The API caches a reading for two minutes; once a minute keeps the screen close behind it. */
const POLL_MS = 60_000;

const VARIANT: Record<FlightState, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  scheduled: 'success',
  boarding: 'info',
  departed: 'info',
  landed: 'neutral',
  delayed: 'warning',
  cancelled: 'danger',
  diverted: 'danger',
};

const time = (local: string): string => local.slice(11, 16);
const followed = (flight: Flight): boolean => flight.checkedAt !== null;
const finished = (flight: Flight): boolean => FINAL_FLIGHT_STATES.includes(flight.state);

/**
 * Live status of a confirmed trip's flights (ADR-095), online only: shown from the day before
 * a flight leaves, when the API starts following it, and refreshed once a minute while a
 * followed flight has not finished. Nothing renders before that, when live status is off or
 * when the read fails.
 */
export function FlightStatus({ bookingId }: { bookingId: string }) {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const status = useQuery({
    queryKey: ['flight-status', bookingId],
    refetchInterval: (state) =>
      state.state.data?.live &&
      state.state.data.flights.some((flight) => followed(flight) && !finished(flight))
        ? POLL_MS
        : false,
    queryFn: async () => {
      const { data } = await api.GET('/v1/bookings/{bookingId}/flight-status', {
        params: { path: { bookingId }, header: await tripStore.bookingHeaders(bookingId) },
      });
      if (!data) throw new Error('flight-status');
      return data;
    },
  });

  const flights = status.data?.live ? status.data.flights.filter(followed) : [];
  if (flights.length === 0) return null;

  const duration = (minutes: number): string =>
    minutes < 60
      ? t('booking.flightStatus.minutes', { minutes })
      : t('booking.flightStatus.hours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  /** The time, with its day when that is not the scheduled day. */
  const moment = (local: string, scheduled: string): string =>
    local.slice(0, 10) === scheduled.slice(0, 10)
      ? time(local)
      : `${time(local)}, ${format.date(local.slice(0, 10), 'weekday')}`;
  const updated = flights.reduce((latest, flight) =>
    (flight.checkedAt ?? '') > (latest.checkedAt ?? '') ? flight : latest,
  ).checkedAt;

  return (
    <Card testID="flight-status" className="gap-3 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('booking.flightStatus.heading')}
      </Text>
      {flights.map((flight) => {
        const departure = flight.estimatedDepartureLocal ?? flight.scheduledDepartureLocal;
        const arrival = flight.estimatedArrivalLocal ?? flight.scheduledArrivalLocal;
        const places = [
          flight.departureTerminal
            ? t('booking.flightStatus.terminal', { terminal: flight.departureTerminal })
            : null,
          flight.departureGate
            ? t('booking.flightStatus.gate', { gate: flight.departureGate })
            : null,
          flight.state === 'landed' && flight.baggageBelt
            ? t('booking.flightStatus.belt', { belt: flight.baggageBelt })
            : null,
        ].filter((entry): entry is string => entry !== null);
        const gone = flight.state === 'cancelled' || flight.state === 'diverted';
        return (
          <View key={flight.flight} testID={`flight-status-${flight.flight}`} className="gap-1">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="font-body-bold text-body text-foreground">
                {t('booking.flightStatus.flight', {
                  flight: `${flight.carrier.code} ${flight.flightNumber}`,
                  origin: flight.origin.code,
                  destination: flight.destination.code,
                })}
              </Text>
              <View testID="flight-state">
                <Badge variant={VARIANT[flight.state]}>
                  {t(`booking.flightStatus.states.${flight.state}`)}
                </Badge>
              </View>
            </View>
            {gone ? null : (
              <>
                <Text testID="flight-departure" className="font-body text-body-sm text-foreground">
                  {`${t('booking.flightStatus.departure')}: `}
                  {flight.delayMinutes > 0
                    ? `${t('booking.flightStatus.expected', {
                        time: moment(departure, flight.scheduledDepartureLocal),
                      })} · ${t('booking.flightStatus.late', {
                        duration: duration(flight.delayMinutes),
                      })} · ${t('booking.flightStatus.scheduled', {
                        time: time(flight.scheduledDepartureLocal),
                      })}`
                    : time(departure)}
                </Text>
                <Text className="font-body text-body-sm text-foreground">
                  {`${t('booking.flightStatus.arrival')}: ${moment(arrival, flight.scheduledArrivalLocal)}`}
                </Text>
              </>
            )}
            {places.length > 0 && !gone ? (
              <Text testID="flight-gate" className="font-body text-body-sm text-foreground">
                {places.join(' · ')}
              </Text>
            ) : null}
            {flight.state === 'cancelled' ? (
              <Text className="font-body text-body-sm text-foreground">
                {t('booking.flightStatus.cancelledHelp')}
              </Text>
            ) : null}
          </View>
        );
      })}
      <Text className="font-body text-caption text-muted">
        {updated
          ? `${t('booking.flightStatus.updated', { time: format.dateTime(updated) })} · `
          : ''}
        {t('booking.flightStatus.note')}
      </Text>
    </Card>
  );
}
