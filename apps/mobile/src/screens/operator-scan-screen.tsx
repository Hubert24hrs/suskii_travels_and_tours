import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Button, Card, DateRangePicker, Input } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { Notice } from '../components/states';
import { fromIso, toIso, todayIso } from '../lib/dates';
import { useApp, useT } from '../providers/app-provider';

type ScanResult = Schemas['TicketScanResult'];

/** Green to board, red for everything else: readable at a glance in a queue. */
const RESULT_TONE: Record<ScanResult['result'], string> = {
  boarded: 'bg-success',
  already_boarded: 'bg-danger',
  void: 'bg-danger',
  not_found: 'bg-danger',
  invalid: 'bg-danger',
};

function Scanner() {
  const { api } = useApp();
  const { t, locale } = useT();
  const format = useFormatters();
  const [date, setDate] = useState(todayIso);
  // Yesterday too: a late-night departure is still boarding after midnight.
  const [earliest] = useState(() => new Date(Date.now() - 86_400_000));
  const [manual, setManual] = useState('');
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The camera reports the same code many times a second: one check at a time.
  const checking = useRef(false);
  const [permission, requestPermission] = useCameraPermissions();

  const trips = useQuery({
    queryKey: ['operator-trips', date],
    queryFn: async () => {
      const { data, response } = await api.GET('/v1/operator/trips', {
        params: { query: { date } },
      });
      if (!data) throw new Error(String(response.status));
      return data.trips;
    },
  });

  const check = async (qrPayload: string) => {
    const payload = qrPayload.trim();
    if (checking.current || payload.length < 20) return;
    checking.current = true;
    setBusy(true);
    setError(null);
    try {
      const { data } = await api.POST('/v1/operator/tickets/scan', {
        body: { qrPayload: payload },
      });
      if (data) {
        setResult(data);
        setManual('');
        void trips.refetch();
      } else setError(t('mobile.cars.operator.error'));
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      checking.current = false;
      setBusy(false);
    }
  };

  const message = (scan: ScanResult): string => {
    const ticket = scan.ticket;
    switch (scan.result) {
      case 'boarded':
        return t('mobile.cars.operator.results.boarded', {
          seat: ticket?.seatNumber ?? '',
          name: ticket?.passengerName ?? '',
        });
      case 'already_boarded':
        return t('mobile.cars.operator.results.already_boarded', {
          seat: ticket?.seatNumber ?? '',
          time: ticket?.boardedAt ? format.dateTime(ticket.boardedAt) : '',
        });
      case 'void':
      case 'not_found':
      case 'invalid':
        return t(`mobile.cars.operator.results.${scan.result}`);
    }
  };

  return (
    <>
      <Card className="gap-3 p-4">
        <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
          {t('mobile.cars.operator.tripsHeading')}
        </Text>
        <DateRangePicker
          mode="single"
          label={t('mobile.cars.operator.date')}
          value={{ from: fromIso(date), to: undefined }}
          onChange={(range) => setDate(range.from ? toIso(range.from) : todayIso())}
          formatValue={(range) =>
            range.from ? format.date(toIso(range.from), 'weekday') : undefined
          }
          placeholder={t('mobile.cars.operator.date')}
          minDate={earliest}
          locale={locale}
          labels={{ done: t('search.datePicker.done'), close: t('search.datePicker.close') }}
        />
        {(trips.data ?? []).length === 0 ? (
          <Text className="font-body text-body-sm text-foreground">
            {t('mobile.cars.operator.noTrips')}
          </Text>
        ) : (
          (trips.data ?? []).map((trip) => (
            <View key={trip.id} testID={`operator-trip-${trip.id}`} className="gap-1">
              <Text className="font-body-bold text-body-sm text-foreground">
                {t('mobile.cars.operator.trip', {
                  time: trip.departsAtLocal.slice(11, 16),
                  origin: trip.origin,
                  destination: trip.destination,
                })}
              </Text>
              <Text className="font-body text-caption text-muted">
                {t('mobile.cars.operator.boarded', { boarded: trip.boarded, sold: trip.sold })}
              </Text>
            </View>
          ))
        )}
      </Card>

      <Card className="gap-3 p-4">
        {result ? (
          <View className="gap-3">
            <View
              testID="scan-result"
              accessibilityLiveRegion="assertive"
              className={`gap-2 rounded-lg p-4 ${RESULT_TONE[result.result]}`}
            >
              <Text className="font-heading text-h4 text-on-status">{message(result)}</Text>
              {result.reason ? (
                <Text className="font-body text-body-sm text-on-status">
                  {t(`mobile.cars.operator.reasons.${result.reason}`)}
                </Text>
              ) : null}
            </View>
            <Button testID="scan-another" onPress={() => setResult(null)}>
              {t('mobile.cars.operator.scanAnother')}
            </Button>
          </View>
        ) : permission?.granted ? (
          <View className="gap-2">
            <Text className="font-body text-body-sm text-foreground">
              {t('mobile.cars.operator.camera')}
            </Text>
            <View className="aspect-square w-full overflow-hidden rounded-lg bg-skeleton">
              <CameraView
                testID="scan-camera"
                style={StyleSheet.absoluteFill}
                facing="back"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={busy ? undefined : (scan) => void check(scan.data)}
              />
            </View>
          </View>
        ) : (
          <View className="gap-2">
            <Text className="font-body text-body-sm text-foreground">
              {permission && !permission.canAskAgain
                ? t('mobile.cars.operator.cameraDenied')
                : t('mobile.cars.operator.cameraPermission')}
            </Text>
            {permission?.canAskAgain !== false ? (
              <Button
                testID="scan-allow-camera"
                variant="secondary"
                onPress={() => void requestPermission()}
              >
                {t('mobile.cars.operator.allowCamera')}
              </Button>
            ) : null}
          </View>
        )}
        {!result ? (
          <>
            <Input
              testID="scan-manual"
              label={t('mobile.cars.operator.manual')}
              hint={t('mobile.cars.operator.manualHint')}
              value={manual}
              onChangeText={setManual}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="off"
              maxLength={1000}
            />
            <Button
              testID="scan-check"
              loading={busy}
              disabled={manual.trim().length < 20}
              onPress={() => void check(manual)}
            >
              {t('mobile.cars.operator.check')}
            </Button>
          </>
        ) : null}
        {error ? (
          <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
            {error}
          </Text>
        ) : null}
      </Card>
    </>
  );
}

/**
 * Boarding (ADR-050): an operator agent scans each pass with the camera, or pastes the code.
 * The API checks the signature, the boarding window and the agent's operators, and boards a
 * ticket once; a second scan of the same ticket says when it was used.
 */
export function OperatorScanScreen() {
  const { t } = useT();
  const { user } = useApp();
  return (
    <ScrollView
      testID="operator-scan"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: t('mobile.cars.operator.title') }} />
      <RequireAccount>
        {user?.roles.includes('operator_agent') ? (
          <Scanner />
        ) : (
          <Notice body={t('mobile.cars.operator.notAgent')} />
        )}
      </RequireAccount>
    </ScrollView>
  );
}
