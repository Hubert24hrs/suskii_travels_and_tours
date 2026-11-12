import { getI18n } from '../../lib/i18n';

import { Section } from './section';

/** How flexible payment works, in the honest terms of PROJECT_SPEC.json#/features.flexible_payment. */
export async function FlexiblePayment() {
  const { t } = await getI18n();
  const steps = [
    {
      title: t('sections.flexiblePayment.step1Title'),
      body: t('sections.flexiblePayment.step1Body'),
    },
    {
      title: t('sections.flexiblePayment.step2Title'),
      body: t('sections.flexiblePayment.step2Body'),
    },
    {
      title: t('sections.flexiblePayment.step3Title'),
      body: t('sections.flexiblePayment.step3Body'),
    },
  ];
  return (
    <Section
      id="flexible-payment"
      title={t('sections.flexiblePayment.heading')}
      className="bg-surface"
    >
      <p className="max-w-dialog font-body text-body text-foreground">
        {t('sections.flexiblePayment.intro')}
      </p>
      <ol className="grid gap-6 md:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-4">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-pill bg-primary font-heading text-h4 font-extrabold text-on-primary"
            >
              {index + 1}
            </span>
            <div className="flex flex-col gap-1">
              <h3 className="font-heading text-h4 font-bold text-heading">{step.title}</h3>
              <p className="font-body text-body-sm text-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="font-body text-caption text-muted">{t('sections.flexiblePayment.footnote')}</p>
    </Section>
  );
}
