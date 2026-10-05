import { I18nProvider } from '@suskii/i18n/react';
import { Badge, Card } from '@suskii/ui-web';
import { Check } from 'lucide-react';
import type { Metadata } from 'next';

import { pickAccountMessages } from '../../components/account/pick-account-messages';
import { Breadcrumbs } from '../../components/breadcrumbs';
import { Container } from '../../components/layout/container';
import { JoinPrime } from '../../components/prime/join-prime';
import { api } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { getPreferences } from '../../lib/preferences';
import { pageMetadata } from '../../lib/seo';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return pageMetadata({ title: t('prime.title'), description: t('prime.intro'), path: '/prime' });
}

/**
 * Suskii Prime (ADR-030): the published plans in the visitor's currency, or "coming soon" when
 * staff have published none. Joining needs an account.
 */
export default async function PrimePage() {
  const { t, format, locale, messages } = await getI18n();
  const { currency } = await getPreferences();
  const plans = (await api.primePlans(currency))?.plans ?? [];
  return (
    <Container className="flex flex-col gap-8 pt-8 pb-16">
      <Breadcrumbs items={[{ name: t('prime.title'), path: '/prime' }]} />
      <div className="flex max-w-dialog flex-col gap-3">
        <h1 className="font-heading text-h2 font-extrabold text-heading">{t('prime.heading')}</h1>
        <p className="font-body text-body text-foreground">{t('prime.intro')}</p>
        <p className="font-body text-body-sm text-muted">{t('prime.noRenewal')}</p>
      </div>
      {plans.length === 0 ? (
        <Card className="p-6" data-testid="prime-coming-soon">
          <p className="font-body text-body text-foreground">{t('prime.comingSoon')}</p>
        </Card>
      ) : (
        <I18nProvider locale={locale} messages={pickAccountMessages(messages)}>
          <ul className="grid gap-6 md:grid-cols-2">
            {plans.map((plan) => {
              const benefits = [
                plan.benefits.memberFares ? t('prime.benefits.memberFares') : null,
                plan.benefits.waivedFeeCodes.length > 0 ? t('prime.benefits.waivedFees') : null,
                plan.benefits.prioritySupport ? t('prime.benefits.prioritySupport') : null,
              ].filter((benefit): benefit is string => benefit !== null);
              return (
                <li key={plan.id}>
                  <Card
                    className="flex h-full flex-col gap-4 border-l-4 border-l-accent p-6"
                    data-testid={`plan-${plan.slug}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-heading text-h3 font-bold text-heading">{plan.name}</h2>
                      {plan.sample ? <Badge variant="warning">{t('prime.sample')}</Badge> : null}
                    </div>
                    <p className="font-body text-body text-foreground">{plan.summary}</p>
                    {plan.price ? (
                      <p className="font-heading text-h4 font-bold text-foreground">
                        {t(plan.period === 'year' ? 'prime.perYear' : 'prime.perMonth', {
                          price: format.money(plan.price),
                        })}
                      </p>
                    ) : (
                      <p className="font-body text-body-sm text-muted">{t('prime.unavailable')}</p>
                    )}
                    <ul className="flex flex-col gap-2">
                      {benefits.map((benefit) => (
                        <li
                          key={benefit}
                          className="flex items-center gap-2 font-body text-body text-foreground"
                        >
                          <Check aria-hidden="true" className="size-5 shrink-0 text-success" />
                          {benefit}
                        </li>
                      ))}
                    </ul>
                    {plan.price ? (
                      <div className="mt-auto">
                        <JoinPrime planSlug={plan.slug} planName={plan.name} currency={currency} />
                      </div>
                    ) : null}
                  </Card>
                </li>
              );
            })}
          </ul>
        </I18nProvider>
      )}
    </Container>
  );
}
