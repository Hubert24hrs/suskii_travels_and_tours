'use client';

import type { CurrencyCode, ToursFormDraft, Vertical, VisaFormDraft } from '@suskii/shared';
import type { AddonsFormDraft, PackagesFormDraft } from '@suskii/shared';
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@suskii/ui-web';
import { BedDouble, FileCheck, Luggage, Map, Palmtree, Plane } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState } from 'react';

import type { CityOption } from './city-field';
import { FlightsForm } from './flights-form';
import type { FlightFormState, HotelFormState } from './form-state';
import { useSearchT } from './use-search-t';

function FormSkeleton() {
  const { t } = useSearchT();
  return (
    <div role="status" aria-label={t('search.loadingForm')} className="grid gap-3 lg:grid-cols-3">
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
    </div>
  );
}

// Only the flights form ships with the page; the other tabs load when first opened (ADR-010).
const HotelsForm = dynamic(() => import('./hotels-form'), { loading: FormSkeleton });
const PackagesForm = dynamic(() => import('./packages-form'), { loading: FormSkeleton });
const ToursForm = dynamic(() => import('./tours-form'), { loading: FormSkeleton });
const VisaForm = dynamic(() => import('./visa-form'), { loading: FormSkeleton });
const AddonsForm = dynamic(() => import('./addons-form'), { loading: FormSkeleton });

export interface SearchInitialState {
  flights?: FlightFormState | undefined;
  hotels?: HotelFormState | undefined;
  packages?: { draft: PackagesFormDraft; city: CityOption | null } | undefined;
  tours?: ToursFormDraft | undefined;
  visa?: VisaFormDraft | undefined;
  addons?: { draft: AddonsFormDraft; city: CityOption | null } | undefined;
}

export interface SearchModuleProps {
  defaultTab: Vertical;
  apiBaseUrl: string;
  locale: string;
  currency: CurrencyCode;
  citySuggestions: CityOption[];
  initial?: SearchInitialState | undefined;
}

const TABS: { value: Vertical; icon: React.ReactNode }[] = [
  { value: 'flights', icon: <Plane className="size-5" /> },
  { value: 'hotels', icon: <BedDouble className="size-5" /> },
  { value: 'packages', icon: <Palmtree className="size-5" /> },
  { value: 'tours', icon: <Map className="size-5" /> },
  { value: 'visa', icon: <FileCheck className="size-5" /> },
  { value: 'travel_addons', icon: <Luggage className="size-5" /> },
];

/** The search card: one tab and form per vertical (PROJECT_SPEC.json#/homepage_spec). */
export function SearchModule({
  defaultTab,
  apiBaseUrl,
  locale,
  currency,
  citySuggestions,
  initial,
}: SearchModuleProps) {
  const { t } = useSearchT();
  const [tab, setTab] = useState<Vertical>(defaultTab);
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-card-hover md:p-6">
      <Tabs value={tab} onValueChange={(value) => setTab(value as Vertical)}>
        <TabsList aria-label={t('search.label')} className="-mx-4 px-4 md:mx-0 md:px-0">
          {TABS.map((entry) => (
            <TabsTrigger key={entry.value} value={entry.value} icon={entry.icon}>
              {t(`search.tabs.${entry.value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="flights">
          <FlightsForm apiBaseUrl={apiBaseUrl} locale={locale} initial={initial?.flights} />
        </TabsContent>
        <TabsContent value="hotels">
          <HotelsForm
            apiBaseUrl={apiBaseUrl}
            locale={locale}
            suggestions={citySuggestions}
            initial={initial?.hotels}
          />
        </TabsContent>
        <TabsContent value="packages">
          <PackagesForm
            apiBaseUrl={apiBaseUrl}
            locale={locale}
            currency={currency}
            suggestions={citySuggestions}
            initial={initial?.packages}
          />
        </TabsContent>
        <TabsContent value="tours">
          <ToursForm locale={locale} initial={initial?.tours} />
        </TabsContent>
        <TabsContent value="visa">
          <VisaForm apiBaseUrl={apiBaseUrl} locale={locale} initial={initial?.visa} />
        </TabsContent>
        <TabsContent value="travel_addons">
          <AddonsForm
            apiBaseUrl={apiBaseUrl}
            locale={locale}
            suggestions={citySuggestions}
            initial={initial?.addons}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
