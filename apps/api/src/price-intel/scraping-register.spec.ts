import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  renderScrapingRegister,
  scrapingRegisterPreamble,
  type ScrapingRegisterRow,
} from './scraping-register';

const DOC = resolve(__dirname, '../../../../docs/legal/scraping-register.md');

const row = (over: Partial<ScrapingRegisterRow> = {}): ScrapingRegisterRow => ({
  domain: 'hotels.example.com',
  name: 'Sample Hotels',
  status: 'approved',
  basis: 'permission',
  basisReference: 'Agreement SA-77, clause 4',
  robots: 'allowed',
  terms: 'disallowed',
  products: ['hotel'],
  vendors: ['firecrawl', 'oxylabs'],
  maxProxyClass: 'datacenter',
  requestsPerMinute: 6,
  decidedAt: '2026-11-10T09:30:00.000Z',
  ...over,
});

describe('the scraping register (ADR-102)', () => {
  it('keeps the page in the repository saying what the code does', () => {
    // The repository's page explains the register (and lists no site, or one environment's
    // sites when the owner commits a copy); its explanation must be the current one.
    expect(readFileSync(DOC, 'utf8').startsWith(scrapingRegisterPreamble())).toBe(true);
  });

  it('lists each site with its basis, findings, vendors and limits', () => {
    const page = renderScrapingRegister({
      rows: [
        row(),
        row({
          domain: 'cars.example.org',
          name: 'Cars | Lagos\nand Abuja',
          status: 'review',
          basis: null,
          basisReference: null,
          robots: 'unknown',
          terms: 'unknown',
          products: ['car', 'transfer'],
          vendors: ['mock'],
          maxProxyClass: 'none',
          decidedAt: null,
        }),
        row({ domain: 'fares.example.net', status: 'blocked', basis: null, basisReference: null }),
      ],
      generatedAt: '2026-11-10T12:00:00.000Z',
      environment: 'production',
    });
    expect(page.startsWith(scrapingRegisterPreamble())).toBe(true);
    expect(page).toContain('Copied on 2026-11-10 from the production environment.');
    expect(page).toContain(
      '| hotels.example.com | Sample Hotels | approved | permission | Agreement SA-77, clause 4 | allowed | disallowed | hotel | firecrawl, oxylabs | datacenter | 6 | 2026-11-10 |',
    );
    // A name cannot break the table, and what is undecided shows as such.
    expect(page).toContain(
      '| cars.example.org | Cars \\| Lagos and Abuja | review | - | - | unknown | unknown | car, transfer | mock | none | 6 | - |',
    );
    expect(page).toContain('1 approved, 1 in review, 1 blocked.');
    expect(page.endsWith('\n')).toBe(true);
  });

  it('says so when nothing is listed', () => {
    const page = renderScrapingRegister({ rows: [], generatedAt: null, environment: null });
    expect(page).toContain(
      'No site is listed. Nothing is read until a site is listed and approved.',
    );
    expect(page).not.toContain('| Domain |');
  });
});
