'use client';

import {
  NO_OPTIONAL_COOKIES,
  OPTIONAL_COOKIE_CATEGORIES,
  type CookieChoices,
} from '@suskii/shared/lite';
import { Button } from '@suskii/ui-web';
import { useState, type FormEvent } from 'react';

import { COOKIE_CATALOG, type CookieCategory } from '../../lib/cookie-catalog';
import { readCookieConsent, saveCookieConsent } from '../../lib/cookie-consent';

import type { CookieLabels } from './cookie-settings';

const CATEGORIES: readonly CookieCategory[] = ['necessary', ...OPTIONAL_COOKIE_CATEGORIES];

function CookieList({ category, labels }: { category: CookieCategory; labels: CookieLabels }) {
  const entries = COOKIE_CATALOG.filter((entry) => entry.category === category);
  if (entries.length === 0) {
    return <p className="font-body text-body-sm text-muted">{labels.notInUse}</p>;
  }
  return (
    <ul className="flex flex-col gap-2" data-testid={`cookie-list-${category}`}>
      {entries.map((entry) => (
        <li key={entry.name} className="flex flex-col gap-1 rounded-lg bg-background p-3">
          <span className="break-all font-body text-body-sm font-bold text-foreground">
            {entry.name}
          </span>
          <span className="font-body text-body-sm text-foreground">
            {labels.items[entry.purpose]}
          </span>
          <span className="font-body text-caption text-muted">
            {labels.columns.provider}: {labels.providers[entry.provider]} ·{' '}
            {labels.columns.duration}: {labels.durations[entry.duration]}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Lists every cookie by category; optional categories are off until a recorded choice. */
export default function CookiePanel({ labels }: { labels: CookieLabels }) {
  // Mounted only after the dialog opens, so reading the cookie here never runs on the server.
  const [choices, setChoices] = useState<CookieChoices>(
    () => readCookieConsent()?.choices ?? NO_OPTIONAL_COOKIES,
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'saved' | 'error' | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setStatus(null);
    const saved = await saveCookieConsent(choices);
    setBusy(false);
    setStatus(saved ? 'saved' : 'error');
  };

  return (
    <form method="post" className="flex flex-col gap-6" onSubmit={(event) => void submit(event)}>
      {CATEGORIES.map((category) => {
        const copy = labels.categories[category];
        return (
          <section
            key={category}
            className="flex flex-col gap-3"
            aria-labelledby={`cookies-${category}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h3
                  id={`cookies-${category}`}
                  className="font-heading text-body font-bold text-heading"
                >
                  {copy.title}
                </h3>
                <p className="font-body text-body-sm text-muted">{copy.body}</p>
              </div>
              {category === 'necessary' ? (
                <span className="shrink-0 font-body text-body-sm font-bold text-foreground">
                  {labels.alwaysOn}
                </span>
              ) : (
                <label className="flex min-h-12 shrink-0 items-center gap-2 font-body text-body-sm text-foreground">
                  <input
                    type="checkbox"
                    name={category}
                    className="size-5 accent-primary"
                    checked={choices[category]}
                    onChange={(event) =>
                      setChoices((current) => ({ ...current, [category]: event.target.checked }))
                    }
                    aria-describedby={`cookies-${category}`}
                    data-testid={`cookie-choice-${category}`}
                  />
                  <span className="sr-only">{copy.title}</span>
                </label>
              )}
            </div>
            <CookieList category={category} labels={labels} />
          </section>
        );
      })}
      <p className="font-body text-caption text-muted">{labels.payments}</p>
      {status === 'saved' ? (
        <p role="status" className="font-body text-body-sm text-success">
          {labels.saved}
        </p>
      ) : null}
      {status === 'error' ? (
        <p role="alert" className="font-body text-body-sm text-danger">
          {labels.error}
        </p>
      ) : null}
      <Button type="submit" loading={busy} data-testid="cookie-save">
        {labels.save}
      </Button>
    </form>
  );
}
