import { useFormatters } from '@suskii/i18n/react';
import {
  APPROVAL_REJECT_REASONS,
  canApprove,
  type ApprovalRejectReason,
  type CompanyRole,
} from '@suskii/shared';
import type { Schemas } from '@suskii/api-client';
import { Badge, Button, Card, useToast } from '@suskii/ui-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { RequireAccount } from '../components/account/require-account';
import { Loading, Notice } from '../components/states';
import { useApp, useT } from '../providers/app-provider';

type Trip = Schemas['CompanyBooking'];

/** "Lagos → Abuja", the hotel or the product: what a company trip is. */
const tripTitle = (trip: Trip): string =>
  trip.flight
    ? `${trip.flight.origin.cityName ?? trip.flight.origin.code} → ${trip.flight.destination.cityName ?? trip.flight.destination.code}`
    : (trip.hotel?.name ?? trip.product?.title ?? trip.reference);

function TripCard({
  trip,
  role,
  onDecided,
}: {
  trip: Trip;
  role: CompanyRole;
  onDecided: () => void;
}) {
  const { api } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const { toast } = useToast();
  const [reason, setReason] = useState<ApprovalRejectReason>('other');
  const [busy, setBusy] = useState(false);
  const findings = trip.policyFindings.map((finding) => t(`booking.company.findings.${finding}`));

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      const result = approve
        ? await api.POST('/v1/me/company/bookings/{bookingId}/approve', {
            params: { path: { bookingId: trip.id } },
          })
        : await api.POST('/v1/me/company/bookings/{bookingId}/reject', {
            params: { path: { bookingId: trip.id } },
            body: { reason },
          });
      if (result.data) {
        toast({
          title: t(
            approve ? 'account.company.approvals.approved' : 'account.company.approvals.rejected',
          ),
          variant: 'success',
        });
        onDecided();
      } else toast({ title: t('account.company.error'), variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card testID={`company-trip-${trip.id}`} className="gap-2 p-4">
      <Pressable
        accessibilityRole="link"
        onPress={() => router.push(`/trips/${trip.id}` as Href)}
        className="min-h-12 flex-row items-center justify-between gap-3"
      >
        <Text className="flex-1 font-body-bold text-body text-primary">{tripTitle(trip)}</Text>
        <Text className="font-body-bold text-body text-heading">{format.money(trip.total)}</Text>
      </Pressable>
      <Text className="font-body text-body-sm text-muted">
        {[
          trip.reference,
          format.date(trip.startsOn),
          trip.travellerName
            ? t('account.company.trips.traveller', { name: trip.travellerName })
            : null,
          trip.bookerName ? t('account.company.trips.bookedBy', { name: trip.bookerName }) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>
      <View className="flex-row">
        <Badge variant={trip.approvalStatus === 'rejected' ? 'danger' : 'neutral'}>
          {t(`booking.company.status.${trip.approvalStatus}`)}
        </Badge>
      </View>
      {findings.length > 0 ? (
        <Text className="font-body text-body-sm text-foreground">
          {t('booking.company.outsidePolicy', { findings: format.list(findings) })}
        </Text>
      ) : null}
      {trip.canDecide && canApprove(role) ? (
        <View className="gap-3">
          <Button testID={`approve-${trip.id}`} loading={busy} onPress={() => void decide(true)}>
            {t('account.company.approvals.approve')}
          </Button>
          <Text className="font-body text-body-sm text-foreground">
            {t('account.company.approvals.reason')}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            {APPROVAL_REJECT_REASONS.map((value) => (
              <Pressable
                key={value}
                testID={`reject-reason-${trip.id}-${value}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: reason === value }}
                onPress={() => setReason(value)}
                className={
                  reason === value
                    ? 'min-h-12 justify-center rounded-md bg-primary-subtle px-3'
                    : 'min-h-12 justify-center rounded-md border border-border-strong px-3'
                }
              >
                <Text className="font-body text-body-sm text-foreground">
                  {value === 'other'
                    ? t('account.company.approvals.otherReason')
                    : t(`account.company.approvals.reasons.${value}`)}
                </Text>
              </Pressable>
            ))}
          </View>
          <Button
            testID={`reject-${trip.id}`}
            variant="secondary"
            disabled={busy}
            onPress={() => void decide(false)}
          >
            {t('account.company.approvals.reject')}
          </Button>
        </View>
      ) : null}
    </Card>
  );
}

function Company() {
  const { api } = useApp();
  const { t } = useT();
  const queries = useQueryClient();
  const company = useQuery({
    queryKey: ['company'],
    queryFn: async () => {
      const { data, response } = await api.GET('/v1/me/company');
      if (data) return data;
      if (response.status === 404) return null;
      throw new Error('company');
    },
  });
  const trips = useQuery({
    queryKey: ['company', 'bookings'],
    enabled: Boolean(company.data),
    queryFn: async () => {
      const { data } = await api.GET('/v1/me/company/bookings', {
        params: { query: { limit: 50 } },
      });
      if (!data) throw new Error('company-bookings');
      return data.items;
    },
  });

  if (company.isPending) return <Loading label={t('mobile.loading')} />;
  if (company.isError) {
    return (
      <Notice
        body={t('account.loadError')}
        action={t('account.retry')}
        onAction={() => void company.refetch()}
      />
    );
  }
  if (!company.data) {
    return (
      <Notice
        testID="company-none"
        title={t('account.company.heading')}
        body={t('account.company.none')}
      />
    );
  }
  const { myRole } = company.data;
  const waiting = (trips.data ?? []).filter((trip) => trip.canDecide);
  const refresh = () => void queries.invalidateQueries({ queryKey: ['company'] });

  return (
    <ScrollView
      testID="company"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
    >
      <Card className="gap-2 p-4">
        <Text accessibilityRole="header" className="font-heading text-h3 text-heading">
          {company.data.name}
        </Text>
        <Text testID="company-role" className="font-body text-body text-foreground">
          {t('account.company.yourRole', { role: t(`account.company.roles.${myRole}`) })}
        </Text>
        {company.data.status === 'suspended' ? (
          <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
            {t('account.company.suspended')}
          </Text>
        ) : null}
        <Text className="font-body text-body-sm text-muted">{t('account.company.intro')}</Text>
      </Card>
      {canApprove(myRole) ? (
        <View className="gap-3">
          <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
            {t('account.company.approvals.heading')}
          </Text>
          {waiting.length === 0 ? (
            <Text className="font-body text-body text-muted">
              {t('account.company.approvals.empty')}
            </Text>
          ) : (
            waiting.map((trip) => (
              <TripCard key={trip.id} trip={trip} role={myRole} onDecided={refresh} />
            ))
          )}
        </View>
      ) : null}
      <View className="gap-3">
        <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
          {t('account.company.trips.heading')}
        </Text>
        {trips.isPending ? (
          <Loading label={t('mobile.loading')} />
        ) : (trips.data ?? []).length === 0 ? (
          <Text className="font-body text-body text-muted">{t('account.company.trips.empty')}</Text>
        ) : (
          (trips.data ?? [])
            .filter((trip) => !trip.canDecide)
            .map((trip) => <TripCard key={trip.id} trip={trip} role={myRole} onDecided={refresh} />)
        )}
      </View>
    </ScrollView>
  );
}

/**
 * The account's company (ADR-078): trips waiting for the caller's approval and the company
 * trips they may see. Members, the policy and reports are managed on the website.
 */
export function CompanyScreen() {
  return (
    <RequireAccount>
      <Company />
    </RequireAccount>
  );
}
