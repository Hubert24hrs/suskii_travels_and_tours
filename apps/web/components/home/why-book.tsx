import { CalendarClock, Headset, ShieldCheck, Tag } from 'lucide-react';
import type { ReactNode } from 'react';

import type { HomeContent } from '../../lib/api';
import { getI18n } from '../../lib/i18n';

import { Section } from './section';

const ICONS: Record<string, ReactNode> = {
  price: <Tag aria-hidden="true" className="size-6" />,
  installments: <CalendarClock aria-hidden="true" className="size-6" />,
  support: <Headset aria-hidden="true" className="size-6" />,
  secure: <ShieldCheck aria-hidden="true" className="size-6" />,
};

/** Four value props; titles can be edited in the CMS, descriptions come from the catalog. */
export async function WhyBook({ whyBook }: { whyBook: HomeContent['whyBook'] | undefined }) {
  const { t } = await getI18n();
  const fallback = {
    price: { title: t('sections.whyBook.price'), body: t('sections.whyBook.priceBody') },
    installments: {
      title: t('sections.whyBook.installments'),
      body: t('sections.whyBook.installmentsBody'),
    },
    support: { title: t('sections.whyBook.support'), body: t('sections.whyBook.supportBody') },
    secure: { title: t('sections.whyBook.secure'), body: t('sections.whyBook.secureBody') },
  } as Record<string, { title: string; body: string }>;
  const items = whyBook?.items.length
    ? whyBook.items.map((item) => ({
        icon: item.icon,
        title: item.title,
        body: item.body ?? fallback[item.icon]?.body ?? '',
      }))
    : Object.entries(fallback).map(([icon, item]) => ({ icon, ...item }));
  return (
    <Section id="why-book" title={t('sections.whyBook.heading')}>
      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <li key={item.icon} className="flex flex-col gap-2">
            <span className="flex size-12 items-center justify-center rounded-lg bg-primary-subtle text-primary">
              {ICONS[item.icon]}
            </span>
            <h3 className="font-heading text-h4 font-bold text-heading">{item.title}</h3>
            <p className="font-body text-body-sm text-foreground">{item.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
