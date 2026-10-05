import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import { Badge, Button, Card, type BadgeProps } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Loading, Notice } from '../components/states';
import { appConfig } from '../config';
import { useSensitiveScreen } from '../hooks/use-sensitive-screen';
import { tripStore } from '../lib/trips';
import { pickVisaDocument } from '../lib/visa-upload';
import { useApp, useT } from '../providers/app-provider';

type Application = Schemas['VisaApplication'];
type Item = Application['checklist'][number];
type DocumentStatus = NonNullable<Item['document']>['status'];

const DOCUMENT_VARIANT: Record<DocumentStatus, NonNullable<BadgeProps['variant']>> = {
  pending_scan: 'info',
  clean: 'success',
  infected: 'danger',
  scan_failed: 'warning',
  rejected: 'warning',
};

const POLL_MS = 3000;

/**
 * One applicant's visa application (ADR-026) on the phone: checklist uploads from the document
 * picker (encrypted and virus-scanned by the API), scan results, short-lived links to view a file
 * in the browser, updates from the visa team and submission. Screenshots are blocked here.
 */
export function VisaApplicationScreen() {
  const { id: bookingId, applicationId } = useLocalSearchParams<{
    id: string;
    applicationId: string;
  }>();
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useSensitiveScreen();

  const query = useQuery({
    queryKey: ['visa-application', bookingId, applicationId],
    // Keep polling while a scan runs, so "checking" turns into "received" by itself.
    refetchInterval: (state) =>
      state.state.data?.checklist.some((item) => item.document?.status === 'pending_scan')
        ? POLL_MS
        : false,
    queryFn: async (): Promise<Application | null> => {
      const { data, response } = await api.GET(
        '/v1/bookings/{bookingId}/visa-applications/{applicationId}',
        {
          params: {
            path: { bookingId, applicationId },
            header: await tripStore.bookingHeaders(bookingId),
          },
        },
      );
      if (data) return data;
      if (response.status === 404) return null;
      throw new Error(String(response.status));
    },
  });

  if (query.isPending) return <Loading label={t('visa.application.loading')} />;
  if (query.data === null)
    return <Notice title={t('booking.notFound.heading')} body={t('booking.notFound.body')} />;
  if (!query.data)
    return (
      <Notice
        body={t('mobile.networkError')}
        action={t('mobile.retry')}
        onAction={() => void query.refetch()}
      />
    );
  const application = query.data;

  const upload = async (item: Item) => {
    setError(null);
    let picked: Awaited<ReturnType<typeof pickVisaDocument>>;
    try {
      picked = await pickVisaDocument();
    } catch {
      setError(t('mobile.visa.pickerFailed'));
      return;
    }
    if (picked === 'cancelled') return;
    if (picked === 'unsupported') {
      setError(t('visa.application.errors.type'));
      return;
    }
    setBusy(item.key);
    try {
      const { data, response } = await api.PUT(
        '/v1/bookings/{bookingId}/visa-applications/{applicationId}/documents/{checklistKey}',
        {
          params: {
            path: { bookingId, applicationId, checklistKey: item.key },
            header: {
              'X-File-Name': encodeURIComponent(picked.name),
              ...(await tripStore.bookingHeaders(bookingId)),
            },
          },
          // The raw bytes are the body (no JSON); the declared type only picks the parser.
          body: picked.bytes as unknown as string,
          bodySerializer: (body) => body,
          headers: { 'Content-Type': picked.type },
        },
      );
      if (data) await query.refetch();
      else
        setError(
          response.status === 413
            ? t('visa.application.errors.tooLarge')
            : response.status === 415
              ? t('visa.application.errors.type')
              : response.status === 409
                ? t('visa.application.errors.locked')
                : response.status === 429
                  ? t('visa.application.errors.tooMany')
                  : t('visa.application.errors.generic'),
        );
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(null);
    }
  };

  const view = async (document: NonNullable<Item['document']>) => {
    setError(null);
    const { data } = await api.POST(
      '/v1/bookings/{bookingId}/visa-applications/{applicationId}/documents/{documentId}/link',
      {
        params: {
          path: { bookingId, applicationId, documentId: document.id },
          header: await tripStore.bookingHeaders(bookingId),
        },
      },
    );
    if (!data) {
      setError(t('visa.application.viewFailed'));
      return;
    }
    // A signed link for this viewer only, valid for minutes; the system browser shows the file.
    await openBrowserAsync(new URL(data.url, appConfig.apiBaseUrl).toString());
  };

  const submit = async () => {
    setBusy('submit');
    setError(null);
    const { data, response } = await api.POST(
      '/v1/bookings/{bookingId}/visa-applications/{applicationId}/submit',
      {
        params: {
          path: { bookingId, applicationId },
          header: await tripStore.bookingHeaders(bookingId),
        },
      },
    );
    setBusy(null);
    if (data) await query.refetch();
    else
      setError(
        response.status === 422
          ? t('visa.application.errors.incomplete')
          : response.status === 409
            ? t('visa.application.errors.locked')
            : t('visa.application.errors.generic'),
      );
  };

  return (
    <ScrollView
      testID="visa-application"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
    >
      <View accessibilityLiveRegion="polite" className="items-start gap-2">
        <Text accessibilityRole="header" className="font-heading text-h3 text-heading">
          {t('visa.application.heading', { name: application.applicantName })}
        </Text>
        <View testID="visa-status">
          <Badge variant="info">
            {t(`booking.inhouse.applicationStatus.${application.status}`)}
          </Badge>
        </View>
        <Text className="font-body text-body-sm text-foreground">
          {format.country(application.destination)} ·{' '}
          {t(`booking.inhouse.purposes.${application.purpose}`)} ·{' '}
          {format.date(application.travelDate, 'long')}
        </Text>
        {application.submittedAt ? (
          <Text className="font-body text-body-sm text-foreground">
            {t('visa.application.submitted', { date: format.dateTime(application.submittedAt) })}
          </Text>
        ) : null}
      </View>
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}

      <Card className="gap-4 p-4">
        <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
          {t('visa.application.checklist')}
        </Text>
        {application.canUpload ? (
          <Text className="font-body text-body-sm text-muted">
            {t('visa.application.fileHint')}
          </Text>
        ) : null}
        {application.checklist.map((item) => (
          <View key={item.key} testID={`visa-item-${item.key}`} className="gap-2">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="font-body-bold text-body text-foreground">{item.label}</Text>
              <Badge variant={item.required ? 'info' : 'neutral'}>
                {item.required ? t('visa.application.required') : t('visa.application.optional')}
              </Badge>
            </View>
            {item.description ? (
              <Text className="font-body text-body-sm text-foreground">{item.description}</Text>
            ) : null}
            {item.document ? (
              <View className="flex-row flex-wrap items-center gap-2">
                <Badge variant={DOCUMENT_VARIANT[item.document.status]}>
                  {t(`visa.application.documentStatus.${item.document.status}`)}
                </Badge>
                <Text className="font-body text-caption text-muted">{item.document.fileName}</Text>
              </View>
            ) : null}
            {item.document?.status === 'clean' ? (
              <Button
                variant="ghost"
                onPress={() => void view(item.document!)}
                accessibilityHint={t('mobile.visa.viewHint')}
              >
                {t('visa.application.view', { file: item.document.fileName })}
              </Button>
            ) : null}
            {application.canUpload ? (
              <Button
                testID={`visa-upload-${item.key}`}
                variant="secondary"
                loading={busy === item.key}
                disabled={busy !== null}
                accessibilityLabel={t('mobile.visa.choose', { item: item.label })}
                onPress={() => void upload(item)}
              >
                {item.document
                  ? t('visa.application.replace', { item: item.label })
                  : t('visa.application.upload', { item: item.label })}
              </Button>
            ) : null}
          </View>
        ))}
        {application.canUpload ? (
          <View className="gap-2">
            <Button
              testID="visa-submit"
              fullWidth
              loading={busy === 'submit'}
              disabled={!application.canSubmit || busy !== null}
              onPress={() => void submit()}
            >
              {t('visa.application.submit')}
            </Button>
            {!application.canSubmit ? (
              <Text className="font-body text-caption text-muted">
                {t('visa.application.submitHint')}
              </Text>
            ) : null}
          </View>
        ) : null}
      </Card>

      {application.messages.length > 0 ? (
        <Card className="gap-3 p-4">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('visa.application.messages')}
          </Text>
          {application.messages.map((message, index) => (
            <View key={index} className="gap-1">
              <Text className="font-body-bold text-caption text-muted">
                {format.dateTime(message.occurredAt)}
                {message.status
                  ? ` · ${t(`booking.inhouse.applicationStatus.${message.status}`)}`
                  : ''}
              </Text>
              {message.message ? (
                <Text className="font-body text-body-sm text-foreground">{message.message}</Text>
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}
      <Text className="font-body text-caption text-muted">{application.disclaimer}</Text>
    </ScrollView>
  );
}
