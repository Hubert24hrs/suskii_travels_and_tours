import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { PLATFORM_GUIDE, PLATFORM_GUIDE_TOPICS } from './platform-guide';

/** The website's own pages: each top-level folder of its App Router. */
const WEBSITE_APP = join(__dirname, '..', '..', '..', 'web', 'app');

const pages = PLATFORM_GUIDE_TOPICS.flatMap((topic) =>
  PLATFORM_GUIDE[topic].pages.map((page) => ({ topic, ...page })),
);

describe('platform guide', () => {
  // The guide's pages become cards a traveller opens (ADR-109): each must be a real address.
  it('names every page by an address of the site', () => {
    const malformed = pages.filter(
      (page) => !/^\/(?:[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*)?$/.test(page.path),
    );
    expect(malformed).toEqual([]);
  });

  it('names only pages the website has', () => {
    const missing = pages.filter((page) => {
      const first = page.path.split('/').find(Boolean);
      return first !== undefined && !existsSync(join(WEBSITE_APP, first));
    });
    expect(missing).toEqual([]);
  });
});
