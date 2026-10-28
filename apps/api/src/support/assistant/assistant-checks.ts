import { SUPPORT_ASSISTANT_ANSWER_MAX } from '@suskii/shared';

/**
 * Why an answer the model wrote is not sent (ADR-085). Each check fails closed: the traveller
 * gets the handover instead, and a person answers.
 */
export type AnswerCheckFailure =
  | 'unanswerable'
  | 'empty'
  | 'too_long'
  | 'no_sources'
  | 'unknown_source'
  | 'figure_not_in_sources'
  | 'contact_not_in_sources'
  | 'non_latin_digits';

export type AnswerCheck =
  { ok: true; answer: string; sources: string[] } | { ok: false; reason: AnswerCheckFailure };

/** Thousands separators inside a number ("250,000.00", "250 000,00", "250.000,00"), removed first. */
const GROUPING = /(\d)[.,\u00a0\u202f ](?=\d{3}\b)/g;
const DIGITS = /\d+/g;
/** Digits from other scripts (Arabic-Indic, Devanagari, full-width...), which the figure check cannot read. */
const OTHER_DIGITS = /(?![0-9])\p{Nd}/u;

/** Links, email addresses and phone numbers, which must be quoted from a source. */
const CONTACTS: readonly RegExp[] = [
  /\bhttps?:\/\/[^\s)]+/gi,
  /\bwww\.[^\s)]+/gi,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /\+?\d[\d\s().-]{6,}\d/g,
];

/**
 * The figures in a text as numbers: "₦250,000.00 due 2026-12-01 at 10:25" gives
 * 250000, 0, 2026, 12, 1, 10 and 25. Leading zeros and grouping do not matter, so "1 December"
 * matches 2026-12-01 and "₦250,000" matches "₦250,000.00".
 */
export function figures(text: string): Set<number> {
  const found = new Set<number>();
  for (const match of text.replace(GROUPING, '$1').matchAll(DIGITS)) found.add(Number(match[0]));
  return found;
}

const contacts = (text: string): string[] =>
  CONTACTS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0]));

const normalise = (text: string): string => text.toLowerCase().replace(/[\s().-]/g, '');

/**
 * Checks a model answer against the sources it was given (`known`, id to text): it must be
 * answerable, short, cite only known sources, and every figure, link, email address or phone
 * number in it must appear in the sources it cites.
 */
export function checkAnswer(
  output: { answerable: boolean; answer: string; sources: string[] },
  known: ReadonlyMap<string, string>,
): AnswerCheck {
  if (!output.answerable) return { ok: false, reason: 'unanswerable' };
  const answer = output.answer.trim();
  if (answer === '') return { ok: false, reason: 'empty' };
  if (answer.length > SUPPORT_ASSISTANT_ANSWER_MAX) return { ok: false, reason: 'too_long' };
  const sources = [...new Set(output.sources)];
  if (sources.length === 0) return { ok: false, reason: 'no_sources' };
  if (sources.some((source) => !known.has(source))) return { ok: false, reason: 'unknown_source' };
  if (OTHER_DIGITS.test(answer)) return { ok: false, reason: 'non_latin_digits' };

  const cited = sources.map((source) => known.get(source) ?? '').join('\n');
  const allowed = figures(cited);
  for (const figure of figures(answer)) {
    if (!allowed.has(figure)) return { ok: false, reason: 'figure_not_in_sources' };
  }
  const citedText = normalise(cited);
  for (const contact of contacts(answer)) {
    if (!citedText.includes(normalise(contact))) {
      return { ok: false, reason: 'contact_not_in_sources' };
    }
  }
  return { ok: true, answer, sources };
}
