import { createFormatters, type Translator } from '@suskii/i18n';
import { NATURAL_SEARCH_MIN_LENGTH, NATURAL_SEARCH_PROBLEMS } from '@suskii/shared/lite';

import { browserApi, problemSlug, type Schemas } from '../../lib/browser-api';

import type { SearchMessages } from './search-messages';

export type NaturalSearchResult = Schemas['NaturalSearchResult'];

type T = Translator<SearchMessages>['t'];

/** What the box shows next; `result` fills the form. */
export interface DescribeOutcome {
  tone: 'status' | 'alert';
  text: string;
  result?: NaturalSearchResult;
}

/** The visitor's IANA zone, so "next Friday" means their Friday; the API defaults to Lagos. */
function visitorTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** "We filled in the form", plus what is still missing and the month the text named. */
function filledText(result: NaturalSearchResult, t: T, locale: string): string {
  const format = createFormatters(locale);
  const parts = [t('search.describe.filled')];
  if (result.missing.length > 0) {
    const fields = result.missing.map((field) => t(`search.describe.fields.${field}`));
    parts.push(t('search.describe.missing', { fields: format.list(fields) }));
  }
  if (result.departureMonth && !result.draft.departureDate && result.draft.legs.length === 0) {
    const month = format.date(`${result.departureMonth}-01`, 'month');
    parts.push(t('search.describe.month', { month }));
  }
  return parts.join(' ');
}

const alert = (text: string): DescribeOutcome => ({ tone: 'alert', text });

/**
 * Asks the API to turn a description into a draft of the flight form (ADR-061). Loaded on first
 * focus, so the API client and this logic stay out of the homepage's initial JavaScript
 * (ADR-043). Every failure is a notice that points to the form; nothing throws.
 */
export async function describeTrip(text: string, t: T, locale: string): Promise<DescribeOutcome> {
  const trimmed = text.trim();
  if (trimmed.length < NATURAL_SEARCH_MIN_LENGTH) return alert(t('search.describe.tooShort'));
  const timeZone = visitorTimeZone();
  try {
    const { data, error, response } = await browserApi().POST('/v1/flights/natural-search', {
      body: { text: trimmed, ...(timeZone ? { timeZone } : {}) },
    });
    if (data) return { tone: 'status', text: filledText(data, t, locale), result: data };
    const slug = problemSlug(error);
    if (slug === NATURAL_SEARCH_PROBLEMS.notUnderstood) {
      return alert(t('search.describe.notUnderstood'));
    }
    if (slug === NATURAL_SEARCH_PROBLEMS.budgetExceeded || response.status === 429) {
      return alert(t('search.describe.overLimit'));
    }
    return alert(t('search.describe.unavailable'));
  } catch {
    return alert(t('search.describe.unavailable'));
  }
}
