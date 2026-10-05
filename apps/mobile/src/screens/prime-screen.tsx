import type { Schemas } from '@suskii/api-client';
import { useFormatters } from '@suskii/i18n/react';
import {
  BOOKING_TERMS_VERSION,
  isSupportedCurrency,
  normalisePhone,
  phoneSchema,
} from '@suskii/shared';
import { Badge, Button, Card, Input } from '@suskii/ui-native';
import { useQuery } from '@tanstack/react-query';
import { randomUUID } from 'expo-crypto';
import { useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';

import { Checkbox } from '../components/booking/form-controls';
import { Loading, Notice } from '../components/states';
import { useSensitiveScreen } from '../hooks/use-sensitive-screen';
import { problemSlug } from '../lib/api';
import { openHostedCheckout, startPayment } from '../lib/payment';
import { useApp, useT } from '../providers/app-provider';

type Plan = Schemas['PrimePlan'];

/**
 * The member's details for one plan, then a membership quote, a booking on the usual pipeline
 * and the hosted payment (ADR-030). The trip screen shows the term once the webhook confirms it.
 */
function JoinForm({ plan, onCancel }: { plan: Plan; onCancel: () => void }) {
  const { api, user } = useApp();
  const { t } = useT();
  const router = useRouter();
  useSensitiveScreen();
  const [first = '', ...rest] = (user?.displayName ?? '').trim().split(/\s+/);
  const [givenNames, setGivenNames] = useState(first);
  const [surname, setSurname] = useState(rest.join(' '));
  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const parsedPhone = phoneSchema.safeParse(normalisePhone(phone));
    if (!givenNames.trim() || !surname.trim() || !email.trim() || !parsedPhone.success) {
      setError(t('checkout.issues.summary'));
      return;
    }
    const currency = plan.price?.currency;
    if (!currency || !isSupportedCurrency(currency)) return;
    setBusy(true);
    try {
      const quote = await api.POST('/v1/inhouse-quotes', {
        body: { kind: 'membership', planSlug: plan.slug, currency },
      });
      if (!quote.data) {
        setError(quote.response.status === 410 ? t('prime.unavailable') : t('prime.error'));
        return;
      }
      const created = await api.POST('/v1/bookings', {
        params: { header: { 'Idempotency-Key': randomUUID() } },
        body: {
          quoteId: quote.data.quoteId,
          contact: { email: email.trim(), phone: parsedPhone.data },
          guests: [{ givenNames: givenNames.trim(), surname: surname.trim() }],
          termsVersion: BOOKING_TERMS_VERSION,
          acceptTerms: true,
        },
      });
      if (!created.data) {
        setError(
          problemSlug(created.error) === 'validation-failed'
            ? t('checkout.issues.summary')
            : t('prime.error'),
        );
        return;
      }
      const bookingId = created.data.booking.id;
      const started = await startPayment(api, bookingId, {}, {});
      if (started.kind === 'redirect') await openHostedCheckout(started.checkoutUrl);
      // The trip screen polls the outcome and offers payment again if it did not start.
      router.push(`/trips/${bookingId}` as Href);
    } catch {
      setError(t('mobile.networkError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-3">
      <Text accessibilityRole="header" className="font-heading text-h4 text-heading">
        {t('mobile.prime.joinTitle', { plan: plan.name })}
      </Text>
      <Input
        testID="prime-given-names"
        label={t('prime.memberGivenNames')}
        value={givenNames}
        onChangeText={setGivenNames}
        autoComplete="given-name"
        textContentType="givenName"
      />
      <Input
        testID="prime-surname"
        label={t('prime.memberSurname')}
        value={surname}
        onChangeText={setSurname}
        autoComplete="family-name"
        textContentType="familyName"
      />
      <Input
        testID="prime-email"
        label={t('prime.contactEmail')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
      />
      <Input
        testID="prime-phone"
        label={t('prime.contactPhone')}
        hint={t('auth.signIn.phoneHint')}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
      />
      <Checkbox testID="prime-terms" label={t('prime.terms')} checked={terms} onChange={setTerms} />
      <Text className="font-body text-caption text-muted">{t('mobile.prime.payNote')}</Text>
      {error ? (
        <Text accessibilityRole="alert" className="font-body text-body-sm text-danger">
          {error}
        </Text>
      ) : null}
      <Button
        testID="prime-continue"
        loading={busy}
        disabled={!terms}
        onPress={() => void submit()}
      >
        {t('prime.continue')}
      </Button>
      <Button variant="ghost" onPress={onCancel}>
        {t('account.cancel')}
      </Button>
    </View>
  );
}

function PlanCard({
  plan,
  joining,
  onJoin,
  onCancel,
}: {
  plan: Plan;
  joining: boolean;
  onJoin: () => void;
  onCancel: () => void;
}) {
  const { user } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const router = useRouter();
  const benefits = [
    plan.benefits.memberFares ? t('prime.benefits.memberFares') : null,
    plan.benefits.waivedFeeCodes.length > 0 ? t('prime.benefits.waivedFees') : null,
    plan.benefits.prioritySupport ? t('prime.benefits.prioritySupport') : null,
  ].filter((benefit): benefit is string => benefit !== null);

  return (
    <Card testID={`plan-${plan.slug}`} className="gap-3 p-4">
      <View className="flex-row flex-wrap items-center gap-2">
        <Text accessibilityRole="header" className="font-heading text-h3 text-heading">
          {plan.name}
        </Text>
        {plan.sample ? <Badge variant="warning">{t('prime.sample')}</Badge> : null}
      </View>
      <Text className="font-body text-body text-foreground">{plan.summary}</Text>
      {plan.price ? (
        <Text className="font-heading text-h4 text-foreground">
          {t(plan.period === 'year' ? 'prime.perYear' : 'prime.perMonth', {
            price: format.money(plan.price),
          })}
        </Text>
      ) : (
        <Text className="font-body text-body-sm text-muted">{t('prime.unavailable')}</Text>
      )}
      <View className="gap-1">
        {benefits.map((benefit) => (
          <Text key={benefit} className="font-body text-body text-foreground">
            • {benefit}
          </Text>
        ))}
      </View>
      {!plan.price ? null : joining ? (
        <JoinForm plan={plan} onCancel={onCancel} />
      ) : user ? (
        <Button testID={`join-${plan.slug}`} variant="secondary" onPress={onJoin}>
          {t('prime.join', { plan: plan.name })}
        </Button>
      ) : (
        <Button testID="prime-sign-in" onPress={() => router.push('/sign-in')}>
          {t('prime.signInToJoin')}
        </Button>
      )}
    </Card>
  );
}

/** Suskii Prime: published plans in the app's currency and the member's current term. */
export function PrimeScreen() {
  const { api, user, currency } = useApp();
  const { t } = useT();
  const format = useFormatters();
  const [joining, setJoining] = useState<string | null>(null);

  const plans = useQuery({
    queryKey: ['prime-plans', currency],
    queryFn: async () => {
      const { data } = await api.GET('/v1/prime/plans', { params: { query: { currency } } });
      if (!data) throw new Error('prime-plans');
      return data.plans;
    },
  });
  const mine = useQuery({
    queryKey: ['my-prime', user?.id],
    enabled: Boolean(user),
    queryFn: async () => (await api.GET('/v1/me/prime')).data ?? null,
  });

  if (plans.isPending) return <Loading label={t('mobile.loading')} />;
  if (!plans.data) {
    return (
      <Notice
        body={t('mobile.networkError')}
        action={t('mobile.retry')}
        onAction={() => void plans.refetch()}
      />
    );
  }
  const current = mine.data?.current;

  return (
    <ScrollView
      testID="prime"
      className="flex-1 bg-background"
      contentContainerClassName="gap-4 p-4 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <View className="gap-2">
        <Text accessibilityRole="header" className="font-heading text-h3 text-heading">
          {t('prime.heading')}
        </Text>
        <Text className="font-body text-body text-foreground">{t('prime.intro')}</Text>
        <Text className="font-body text-body-sm text-muted">{t('prime.noRenewal')}</Text>
      </View>
      {current ? (
        <Card testID="prime-member" className="gap-2 p-4">
          <Badge variant="success">{t('mobile.prime.memberBadge')}</Badge>
          <Text className="font-body text-body text-foreground">
            {t('prime.member', { date: format.date(current.until.slice(0, 10)) })}
          </Text>
          <Text className="font-body text-body-sm text-muted">
            {t('account.prime.refreshNote')}
          </Text>
        </Card>
      ) : null}
      {plans.data.length === 0 ? (
        <Card testID="prime-coming-soon" className="p-4">
          <Text className="font-body text-body text-foreground">{t('prime.comingSoon')}</Text>
        </Card>
      ) : (
        plans.data.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            joining={joining === plan.id}
            onJoin={() => setJoining(plan.id)}
            onCancel={() => setJoining(null)}
          />
        ))
      )}
    </ScrollView>
  );
}
