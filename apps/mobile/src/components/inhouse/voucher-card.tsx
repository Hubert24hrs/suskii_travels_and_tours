import type { Schemas } from '@suskii/api-client';
import { color } from '@suskii/design-tokens';
import { useFormatters } from '@suskii/i18n/react';
import { Card } from '@suskii/ui-native';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { encode } from 'uqr';

import { useT } from '../../providers/app-provider';

type Voucher = NonNullable<Schemas['Booking']['voucher']>;

/** Large enough to scan at arm's length from a phone screen. */
const QR_SIZE = 200;

/** The QR modules as one SVG path (one unit square per dark module, quiet zone included). */
export function qrPath(value: string): { path: string; size: number } {
  const { data, size } = encode(value, { ecc: 'M', border: 2 });
  const parts: string[] = [];
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) parts.push(`M${x} ${y}h1v1h-1z`);
    }),
  );
  return { path: parts.join(''), size };
}

/**
 * The voucher to show on arrival (ADR-028): the grouped code and its QR code, drawn on the phone
 * from the booking saved offline, so it works without a connection. No personal data is encoded.
 */
export function VoucherCard({ voucher }: { voucher: Voucher }) {
  const { t } = useT();
  const format = useFormatters();
  const qr = useMemo(() => qrPath(voucher.qrPayload), [voucher.qrPayload]);
  return (
    <Card className="items-center gap-3 p-4">
      <Text accessibilityRole="header" className="self-start font-heading text-h4 text-heading">
        {t('booking.inhouse.voucher')}
      </Text>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('mobile.trip.voucherQr', { code: voucher.code })}
        testID="voucher-qr"
        className="rounded-lg bg-surface p-2"
      >
        <Svg width={QR_SIZE} height={QR_SIZE} viewBox={`0 0 ${qr.size} ${qr.size}`}>
          <Rect x={0} y={0} width={qr.size} height={qr.size} fill={color.surface} />
          <Path d={qr.path} fill={color.foreground} />
        </Svg>
      </View>
      <Text testID="voucher-code" selectable className="font-heading text-h4 text-heading">
        {voucher.code}
      </Text>
      <Text className="font-body text-body-sm text-foreground">
        {voucher.redeemedAt
          ? t('booking.inhouse.voucherRedeemed', { date: format.dateTime(voucher.redeemedAt) })
          : t('mobile.trip.voucherHint')}
      </Text>
    </Card>
  );
}
