import type { Vertical } from '@suskii/shared';
import type { ReactNode } from 'react';

import { getI18n } from '../lib/i18n';

import { Container } from './layout/container';
import { SearchPanel } from './search/search-panel';
import type { SearchInitialState } from './search/search-module';

/**
 * Search results page (`/flights/search`, `/hotels/search`): the search from the URL, pre-filled
 * and editable, above the live results for it.
 */
export async function SearchEntry({
  vertical,
  title,
  valid,
  initial,
  children,
}: {
  vertical: Extract<Vertical, 'flights' | 'hotels'>;
  title: string;
  valid: boolean;
  initial: SearchInitialState;
  /** Results for a valid search. */
  children?: ReactNode;
}) {
  const { t } = await getI18n();
  return (
    <>
      <Container className="flex flex-col gap-2 pt-8 pb-6">
        <h1 className="font-heading text-h2 font-extrabold text-heading">{title}</h1>
        <p className="font-body text-body text-foreground">
          {valid ? t('pages.searchEntry.yourSearch') : t('pages.searchEntry.invalid')}
        </p>
      </Container>
      <SearchPanel defaultTab={vertical} initial={initial} overlap={false} />
      {valid && children ? <Container className="pt-8 pb-16">{children}</Container> : null}
    </>
  );
}
