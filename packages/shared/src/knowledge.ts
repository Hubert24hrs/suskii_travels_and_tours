/**
 * The assistant's knowledge base (ADR-105): documents staff upload (policies, procedures,
 * guides), split into passages and searched with PostgreSQL full-text search. Company text,
 * never personal data. What is here is shared by the API (limits, splitting) and the console
 * (the upload form).
 */

/** Who may be answered from a document: travellers, or staff in the console only. */
export const KNOWLEDGE_AUDIENCES = ['customer', 'staff'] as const;
export type KnowledgeAudience = (typeof KNOWLEDGE_AUDIENCES)[number];

/** The language a document is written in: one per language of the site (ADR-076). */
export const KNOWLEDGE_LANGUAGES = ['en', 'fr', 'sw', 'ar', 'pt'] as const;
export type KnowledgeLanguage = (typeof KNOWLEDGE_LANGUAGES)[number];

/** Plain text and Markdown only: nothing is extracted from a PDF or an office file. */
export const KNOWLEDGE_MEDIA_TYPES = ['text/plain', 'text/markdown'] as const;
export type KnowledgeMediaType = (typeof KNOWLEDGE_MEDIA_TYPES)[number];

export const KNOWLEDGE_MAX_BYTES = 512 * 1024;
/** Documents in use at once; archived ones do not count. */
export const KNOWLEDGE_MAX_DOCUMENTS = 200;
export const KNOWLEDGE_MAX_PASSAGES = 600;
/** A passage is about this long: enough for a rule and its conditions, short enough to quote. */
export const KNOWLEDGE_PASSAGE_CHARS = 1200;
export const KNOWLEDGE_HEADING_MAX = 160;
export const KNOWLEDGE_TITLE_MAX = 160;

/** The language of a locale code (`en-GB` is `en`); English for one the site does not have. */
export function knowledgeLanguage(locale: string): KnowledgeLanguage {
  const language = locale.split('-')[0]?.toLowerCase() ?? '';
  return (KNOWLEDGE_LANGUAGES as readonly string[]).includes(language)
    ? (language as KnowledgeLanguage)
    : 'en';
}

/**
 * PostgreSQL's text search configuration for a language. Swahili has none, so its words are
 * matched as written.
 */
export const KNOWLEDGE_SEARCH_CONFIG = {
  en: 'english',
  fr: 'french',
  pt: 'portuguese',
  ar: 'arabic',
  sw: 'simple',
} as const satisfies Record<KnowledgeLanguage, string>;

export interface KnowledgePassage {
  /** The headings above the passage, outermost first; null without one. */
  heading: string | null;
  body: string;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const HEADING_JOIN = ' \u203A ';

const cut = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}\u2026` : text;

/** Pieces of at most `max` characters, broken after a sentence when one ends in reach. */
function pieces(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const sentence = Math.max(
      window.lastIndexOf('. '),
      window.lastIndexOf('? '),
      window.lastIndexOf('! '),
      window.lastIndexOf('\n'),
    );
    const space = window.lastIndexOf(' ');
    // A break in the second half keeps passages a useful length; else the last space; else a cut.
    const at = sentence >= max / 2 ? sentence + 1 : space >= max / 2 ? space : max;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest.length > 0) out.push(rest);
  return out;
}

/**
 * A document's text as passages. Markdown headings open a section and are kept as the
 * passage's heading (with the headings above them); paragraphs are packed together up to the
 * passage length and a longer one is broken after a sentence. Text without headings is split
 * the same way with no heading. Nothing is rewritten: a passage is the document's own words.
 */
export function knowledgePassages(
  text: string,
  max: number = KNOWLEDGE_PASSAGE_CHARS,
): KnowledgePassage[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n');
  const passages: KnowledgePassage[] = [];
  const trail: { level: number; title: string }[] = [];
  let paragraphs: string[] = [];
  let paragraph: string[] = [];
  let fenced = false;

  const heading = (): string | null =>
    trail.length > 0
      ? cut(trail.map((entry) => entry.title).join(HEADING_JOIN), KNOWLEDGE_HEADING_MAX)
      : null;
  const endParagraph = (): void => {
    const joined = paragraph.join('\n').trim();
    if (joined.length > 0) paragraphs.push(joined);
    paragraph = [];
  };
  const endSection = (): void => {
    endParagraph();
    const title = heading();
    let body = '';
    const push = (): void => {
      if (body.length > 0) passages.push({ heading: title, body });
      body = '';
    };
    for (const part of paragraphs.flatMap((entry) => pieces(entry, max))) {
      if (body.length > 0 && body.length + 2 + part.length > max) push();
      body = body.length > 0 ? `${body}\n\n${part}` : part;
    }
    push();
    paragraphs = [];
  };

  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const match = fenced ? null : HEADING.exec(line);
    if (match) {
      endSection();
      const level = match[1]?.length ?? 1;
      while (trail.length > 0 && (trail.at(-1)?.level ?? 0) >= level) trail.pop();
      trail.push({ level, title: (match[2] ?? '').trim() });
    } else if (line.trim().length === 0 && !fenced) {
      endParagraph();
    } else {
      paragraph.push(line.trimEnd());
    }
  }
  endSection();
  return passages;
}

/**
 * True when bytes read as text: valid UTF-8 without a NUL or another control character that
 * no text file holds. Checked on the bytes, never taken from the declared type.
 */
export function looksLikeText(text: string): boolean {
  // eslint-disable-next-line no-control-regex -- the point is to refuse them
  return !/[\u0000-\u0008\u000B\u000E-\u001F\uFFFD]/.test(text);
}
