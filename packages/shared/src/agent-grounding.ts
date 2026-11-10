/**
 * The check between what a model wrote and what a traveller reads (ADR-107): every figure,
 * link, email address and phone number in an answer must appear in what the tools returned in
 * that turn, in the traveller's own words or in the context the run was given. A model cannot
 * make a price, a date or a contact up and have it shown. The rule is the support assistant's
 * (ADR-085), for answers with tool results instead of cited FAQs.
 */

/** Thousands separators inside a number ("250,000.00", "250 000,00", "250.000,00"). */
const GROUPING = /(\d)[.,\u00a0\u202f ](?=\d{3}(?!\d))/g;
const DIGITS = /\d+/g;
/** Digits from other scripts, which the figure check cannot read. */
const OTHER_DIGITS = /(?![0-9])\p{Nd}/u;
/** "1. " or "2) " at the start of a line numbers a list; it states nothing. */
const LIST_MARKER = /^[ \t]*\d{1,2}[.)][ \t]+/gm;

/** Links, email addresses and phone numbers, which must be quoted from a source. */
const CONTACTS: readonly RegExp[] = [
  /\bhttps?:\/\/[^\s)]+/gi,
  /\bwww\.[^\s)]+/gi,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /\+?\d[\d\s().-]{6,}\d/g,
];

export type GroundingIssue = 'figure' | 'contact' | 'other_digits';

export interface GroundingResult {
  ok: boolean;
  issues: GroundingIssue[];
  /** The figures no source holds, for the instruction that asks the model to rewrite. */
  figures: number[];
}

/**
 * The figures in a text as numbers: "NGN 250,000.00 on 2026-12-01 at 10:25" gives 250000, 0,
 * 2026, 12, 1, 10 and 25. Grouping and leading zeros do not matter, so "1 December" matches
 * 2026-12-01 and "250,000" matches "250,000.00".
 */
export function figuresIn(text: string): Set<number> {
  const found = new Set<number>();
  for (const match of text.replace(GROUPING, '$1').matchAll(DIGITS)) found.add(Number(match[0]));
  return found;
}

const contactsIn = (text: string): string[] =>
  CONTACTS.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0]));

const squash = (text: string): string => text.toLowerCase().replace(/[\s().-]/g, '');

/**
 * Checks an answer against its sources. A phone-like run of digits is judged as a contact, not
 * as figures, so "+234 1 234 5678" must be quoted whole from a source.
 */
export function checkGrounding(answer: string, sources: readonly string[]): GroundingResult {
  const issues = new Set<GroundingIssue>();
  if (OTHER_DIGITS.test(answer)) issues.add('other_digits');

  const all = sources.join('\n');
  const quoted = squash(all);
  let rest = answer.replace(LIST_MARKER, '');
  for (const contact of contactsIn(rest)) {
    if (!quoted.includes(squash(contact))) issues.add('contact');
    rest = rest.replace(contact, ' ');
  }

  const allowed = figuresIn(all);
  const missing: number[] = [];
  for (const figure of figuresIn(rest)) {
    if (!allowed.has(figure)) missing.push(figure);
  }
  if (missing.length > 0) issues.add('figure');
  return { ok: issues.size === 0, issues: [...issues], figures: missing.slice(0, 12) };
}

/** What only the platform's records may say happened (ADR-107). */
export const AGENT_OUTCOME_CLAIMS = ['confirmed', 'paid', 'refunded', 'cancelled'] as const;
export type AgentOutcomeClaim = (typeof AGENT_OUTCOME_CLAIMS)[number];

/**
 * How each outcome is said as a finished fact, in the languages the assistant answers in
 * (ADR-076) and Nigerian Pidgin. Each pattern needs the verb that makes it a statement ("is
 * confirmed", "a été payé"), so "to confirm" or "once paid" does not match.
 */
const CLAIM_PATTERNS: Readonly<Record<AgentOutcomeClaim, readonly RegExp[]>> = {
  confirmed: [
    /\b(?:is|are|was|were|been|now|don)\s+(?:successfully\s+|fully\s+)?(?:confirmed|booked|ticketed|reserved)\b/gi,
    /\b(?:booking|reservation|ticket|flight|hotel|trip)s?\s+(?:confirmed|booked|ticketed|issued)\b/gi,
    /\b(?:est|sont|a été|ont été)\s+(?:bien\s+)?(?:confirmée?s?|réservée?s?|émise?s?)(?![\p{L}])/giu,
    /\b(?:foi|foram|está|estão)\s+(?:confirmad[oa]s?|reservad[oa]s?|emitid[oa]s?)\b/gi,
    /\b(?:imethibitishwa|umethibitishwa|zimethibitishwa)\b/gi,
    /(?:تم|تمّ)\s*(?:تأكيد|حجز|إصدار)/g,
  ],
  paid: [
    /\b(?:is|are|was|were|been|now|don)\s+(?:successfully\s+|fully\s+)?(?:paid|charged|received)\b/gi,
    /\bpayment\s+(?:is\s+|was\s+|has\s+been\s+)?(?:successful|received|complete[d]?|confirmed|approved|captured)\b/gi,
    /\b(?:est|sont|a été|ont été)\s+(?:bien\s+)?(?:payée?s?|reçue?s?|encaissée?s?)(?![\p{L}])/giu,
    /\b(?:foi|foram|está|estão)\s+(?:pag[oa]s?|recebid[oa]s?)\b/gi,
    /\b(?:imelipwa|umelipwa|yamepokelewa|limepokelewa)\b/gi,
    /(?:تم|تمّ)\s*(?:الدفع|دفع|استلام)/g,
  ],
  refunded: [
    /\b(?:is|are|was|were|been|now|don)\s+(?:successfully\s+|fully\s+)?refunded\b/gi,
    /\brefund\s+(?:is\s+|was\s+|has\s+been\s+)?(?:successful|sent|complete[d]?|approved|processed|issued)\b/gi,
    /\b(?:est|sont|a été|ont été)\s+(?:bien\s+)?remboursée?s?(?![\p{L}])/giu,
    /\b(?:foi|foram|está|estão)\s+reembolsad[oa]s?\b/gi,
    /\b(?:imerejeshwa|zimerejeshwa|umerejeshewa)\b/gi,
    /(?:تم|تمّ)\s*(?:استرداد|رد المبلغ)/g,
  ],
  cancelled: [
    /\b(?:is|are|was|were|been|now|don)\s+(?:successfully\s+)?cancell?ed\b/gi,
    /\b(?:est|sont|a été|ont été)\s+(?:bien\s+)?annulée?s?(?![\p{L}])/giu,
    /\b(?:foi|foram|está|estão)\s+cancelad[oa]s?\b/gi,
    /\b(?:imeghairiwa|umeghairiwa|zimeghairiwa)\b/gi,
    /(?:تم|تمّ)\s*إلغاء/g,
  ],
};

/** A "not", "never" or "yet to be" just before a match makes it the opposite of a claim. */
const NEGATION =
  /(?:\bnot|\bnever|n't|\bno\b|\bpas\b|\bnão\b|\bbado\b|\bhaija|\bhaku|لم|لا)\s*(?:yet\s+|encore\s+|ainda\s+)?$/i;

/** "Once it is paid", "if it was cancelled": a condition, not a statement that it happened. */
const CONDITION =
  /(?:\b(?:once|when|if|after|until|unless|before|whether|as soon as|dès que|quand|lorsque|si|quando|se|assim que|ikiwa|baada ya)|إذا|عندما|بعد)\s+(?:\S+\s+){0,3}$/i;

/** The outcomes an answer states as having happened. */
export function outcomeClaims(answer: string): AgentOutcomeClaim[] {
  const found: AgentOutcomeClaim[] = [];
  for (const claim of AGENT_OUTCOME_CLAIMS) {
    const stated = CLAIM_PATTERNS[claim].some((pattern) =>
      [...answer.matchAll(pattern)].some((match) => {
        const before = answer.slice(Math.max(0, (match.index ?? 0) - 24), match.index ?? 0);
        const inside = match[0];
        return (
          !NEGATION.test(before) &&
          !CONDITION.test(before) &&
          !/\bnot\b|n't|\bpas\b|\bnão\b/i.test(inside)
        );
      }),
    );
    if (stated) found.push(claim);
  }
  return found;
}

/** A status a tool returned in the turn: where it sat in the result and what it said. */
export interface StatusFact {
  /** The key path, lower case (`booking.status`, `refund.status`). */
  key: string;
  /** The value, lower case (`confirmed`, `succeeded`). */
  value: string;
}

const SUPPORT: Readonly<Record<AgentOutcomeClaim, (fact: StatusFact) => boolean>> = {
  confirmed: (fact) => fact.value === 'confirmed',
  paid: (fact) =>
    ['paid', 'ticketing', 'confirmed', 'partially_paid'].includes(fact.value) ||
    (fact.key.includes('payment') && fact.value === 'succeeded'),
  refunded: (fact) =>
    fact.value === 'refunded' || (fact.key.includes('refund') && fact.value === 'succeeded'),
  cancelled: (fact) =>
    fact.value === 'cancelled' || (fact.key.includes('cancel') && fact.value === 'succeeded'),
};

/**
 * The outcomes an answer states that no status in the turn's facts supports. Only the
 * platform's records may say a booking, a payment, a refund or a cancellation happened: a
 * traveller's word, a screenshot or a model's guess never does.
 */
export function unsupportedOutcomes(
  answer: string,
  statuses: readonly StatusFact[],
): AgentOutcomeClaim[] {
  return outcomeClaims(answer).filter((claim) => !statuses.some((fact) => SUPPORT[claim](fact)));
}
