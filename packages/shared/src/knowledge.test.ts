import { describe, expect, it } from 'vitest';

import {
  KNOWLEDGE_PASSAGE_CHARS,
  knowledgeLanguage,
  knowledgePassages,
  looksLikeText,
} from './knowledge';

describe('knowledgePassages', () => {
  it('keeps a short text as one passage with no heading', () => {
    expect(knowledgePassages('Refunds take 5 to 10 working days.\n')).toEqual([
      { heading: null, body: 'Refunds take 5 to 10 working days.' },
    ]);
  });

  it('opens a section at each heading and names the headings above it', () => {
    const text = [
      '\uFEFF# Refund policy',
      '',
      'How refunds work.',
      '',
      '## Flights',
      '',
      'The airline decides.',
      '',
      '### Cancelled by the airline ###',
      'Everything is refunded.',
      '',
      '## Hotels',
      'Under the rate\u2019s own terms.',
    ].join('\r\n');
    expect(knowledgePassages(text)).toEqual([
      { heading: 'Refund policy', body: 'How refunds work.' },
      { heading: 'Refund policy \u203A Flights', body: 'The airline decides.' },
      {
        heading: 'Refund policy \u203A Flights \u203A Cancelled by the airline',
        body: 'Everything is refunded.',
      },
      { heading: 'Refund policy \u203A Hotels', body: 'Under the rate\u2019s own terms.' },
    ]);
  });

  it('packs paragraphs up to the passage length and starts another after it', () => {
    const paragraph = 'A sentence of some length that says one thing. '.repeat(8).trim();
    const passages = knowledgePassages([paragraph, paragraph, paragraph, paragraph].join('\n\n'));
    expect(passages.length).toBeGreaterThan(1);
    for (const passage of passages) {
      expect(passage.body.length).toBeLessThanOrEqual(KNOWLEDGE_PASSAGE_CHARS);
      expect(passage.heading).toBeNull();
    }
    // Nothing is lost or rewritten.
    expect(passages.map((passage) => passage.body).join('\n\n')).toBe(
      [paragraph, paragraph, paragraph, paragraph].join('\n\n'),
    );
  });

  it('breaks a paragraph longer than a passage after a sentence, or at a space', () => {
    const long = 'One two three four five six seven. '.repeat(60).trim();
    const passages = knowledgePassages(long, 200);
    expect(passages.length).toBeGreaterThan(5);
    for (const passage of passages) {
      expect(passage.body.length).toBeLessThanOrEqual(200);
      expect(passage.body.endsWith('.')).toBe(true);
    }
    const unbroken = knowledgePassages('x'.repeat(450), 200);
    expect(unbroken.map((passage) => passage.body.length)).toEqual([200, 200, 50]);
  });

  it('reads a heading inside a code fence as text, and skips a heading with nothing under it', () => {
    const text = ['# Empty', '', '# Commands', '```', '# not a heading', '```'].join('\n');
    expect(knowledgePassages(text)).toEqual([
      { heading: 'Commands', body: '```\n# not a heading\n```' },
    ]);
    expect(knowledgePassages('\n\n   \n')).toEqual([]);
  });
});

describe('knowledgeLanguage', () => {
  it('takes the language of a locale, and English for one the site does not have', () => {
    expect(knowledgeLanguage('en-GB')).toBe('en');
    expect(knowledgeLanguage('fr')).toBe('fr');
    expect(knowledgeLanguage('pt-BR')).toBe('pt');
    expect(knowledgeLanguage('de-DE')).toBe('en');
    expect(knowledgeLanguage('')).toBe('en');
  });
});

describe('looksLikeText', () => {
  it('accepts text in any script and refuses what no text file holds', () => {
    expect(looksLikeText('Refunds\n\ttake 5 days. \u0645\u0631\u062D\u0628\u0627 \u00E9')).toBe(
      true,
    );
    expect(looksLikeText('%PDF-1.7\u0000\u0001')).toBe(false);
    // What an invalid byte sequence decodes to.
    expect(looksLikeText('caf\uFFFD')).toBe(false);
  });
});
