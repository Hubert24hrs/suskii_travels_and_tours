'use client';

import { Button, Input } from '@suskii/ui-web';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import type * as RequestModuleNamespace from './describe-trip-request';
import type { DescribeOutcome, NaturalSearchResult } from './describe-trip-request';
import { useSearchT } from './use-search-t';

type RequestModule = typeof RequestModuleNamespace;

let loading: Promise<RequestModule> | null = null;

/** The request, its notices and the API client load on first focus, not with the page. */
function loadRequest(): Promise<RequestModule> {
  loading ??= import('./describe-trip-request').catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

const prefetchRequest = (): void => void loadRequest().catch(() => undefined);

export interface DescribeTripProps {
  locale: string;
  maxLength: number;
  /** Fills the flight form; the traveller checks it and searches as usual. */
  onFill: (result: NaturalSearchResult) => void;
}

/**
 * AI trip search (ADR-061): the traveller describes a trip and the flight form below is filled
 * from it. It never searches by itself, and every failure keeps the text and points to the form.
 */
export function DescribeTrip({ locale, maxLength, onFill }: DescribeTripProps) {
  const { t } = useSearchT();
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<DescribeOutcome | null>(null);
  const field = useRef<HTMLInputElement>(null);

  // The box opens from a button: move focus into it, and start loading the request code.
  useEffect(() => {
    field.current?.focus();
    prefetchRequest();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = new FormData(event.currentTarget).get('text');
    setWorking(true);
    setNotice(null);
    let outcome: DescribeOutcome;
    try {
      const { describeTrip } = await loadRequest();
      outcome = await describeTrip(typeof text === 'string' ? text : '', t, locale);
    } catch {
      outcome = { tone: 'alert', text: t('search.describe.unavailable') };
    }
    if (outcome.result) onFill(outcome.result);
    setNotice(outcome);
    setWorking(false);
  };

  return (
    <form
      method="post"
      noValidate
      onSubmit={(event) => void submit(event)}
      onFocusCapture={prefetchRequest}
      onPointerDownCapture={prefetchRequest}
      aria-busy={working}
      className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3 md:p-4"
    >
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        <div className="flex-1">
          <Input
            ref={field}
            id="describe-trip"
            name="text"
            label={t('search.describe.label')}
            placeholder={t('search.describe.placeholder')}
            maxLength={maxLength}
            autoComplete="off"
            aria-describedby="describe-trip-privacy"
          />
        </div>
        <Button type="submit" variant="ghost" fullWidth="mobile" loading={working}>
          {working ? t('search.describe.working') : t('search.describe.submit')}
        </Button>
      </div>
      <p id="describe-trip-privacy" className="font-body text-caption text-muted">
        {t('search.describe.privacy')}
      </p>
      <p
        role={notice?.tone === 'alert' ? 'alert' : 'status'}
        className={
          notice?.tone === 'alert'
            ? 'font-body text-body-sm text-danger empty:hidden'
            : 'font-body text-body-sm text-foreground empty:hidden'
        }
      >
        {notice?.text ?? ''}
      </p>
    </form>
  );
}
