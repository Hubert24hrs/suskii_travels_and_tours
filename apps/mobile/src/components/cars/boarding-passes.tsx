import type { Schemas } from '@suskii/api-client';
import { color } from '@suskii/design-tokens';
import { useFormatters } from '@suskii/i18n/react';
import { Card } from '@suskii/ui-native';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';

import { useT } from '../../providers/app-provider';
import { qrPath } from '../inhouse/voucher-card';

type Ticket = Schemas['Booking']['busTickets'][number];

/** Large enough to scan at arm's length from a phone screen. */
const QR_SIZE = 220;

function TicketQr({ ticket }: { ticket: Ticket & { qrPayload: string } }) {
  const { t } = useT();
  const qr = useMemo(() => qrPath(ticket.qrPayload), [ticket.qrPayload]);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('booking.cars.bus.qr', { seat: ticket.seatNumber })}
      testID={`ticket-qr-${ticket.seatNumber}`}
      className="self-center rounded-lg bg-surface p-2"
    >
      <Svg width={QR_SIZE} height={QR_SIZE} viewBox={`0 0 ${qr.size} ${qr.size}`}>
        <Rect x={0} y={0} width={qr.size} height={qr.size} fill={color.surface} />
        <Path d={qr.path} fill={color.foreground} />
      </Svg>
    </View>
  );
}

/**
 * Bus boarding passes (ADR-050): one QR code per seat, drawn on the phone from the signed payload
 * in the booking saved offline, so boarding works without a connection. The payload holds the
 * ticket, trip and boarding window, never a name.
 */
export function BoardingPasses({ tickets }: { tickets: readonly Ticket[] }) {
  const { t } = useT();
  const format = useFormatters();
  return (
    <Card testID="boarding-passes" className="gap-4 p-4">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('booking.cars.bus.tickets')}
      </Text>
      {tickets.length === 0 ? (
        <Text className="font-body text-body-sm text-foreground">
          {t('booking.cars.bus.ticketsPending')}
        </Text>
      ) : (
        tickets.map((ticket) => (
          <View key={ticket.id} className="gap-2 rounded-lg border border-border p-3">
            <Text className="font-body-bold text-body text-foreground">
              {t('booking.cars.bus.ticket', {
                seat: ticket.seatNumber,
                name: ticket.passengerName,
              })}
            </Text>
            <Text
              testID={`ticket-state-${ticket.seatNumber}`}
              className="font-body text-body-sm text-foreground"
            >
              {t(`booking.cars.bus.ticketStates.${ticket.status}`)}
            </Text>
            {ticket.qrPayload && ticket.status === 'valid' ? (
              <TicketQr ticket={{ ...ticket, qrPayload: ticket.qrPayload }} />
            ) : null}
            <Text className="font-body text-caption text-muted">
              {t('booking.cars.bus.window', {
                from: format.dateTime(ticket.validFrom),
                until: format.dateTime(ticket.validUntil),
              })}
            </Text>
          </View>
        ))
      )}
    </Card>
  );
}
