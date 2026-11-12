import type { Metadata } from 'next';

import { AddonResults } from '../../components/inhouse/addon-results';
import type { SearchParams } from '../../lib/search-initial';
import { VerticalPage, verticalMetadata } from '../../lib/vertical-page';

interface Props {
  searchParams: Promise<SearchParams>;
}

export function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return verticalMetadata('travel_addons', searchParams);
}

export default async function Page({ searchParams }: Props) {
  return (
    <VerticalPage vertical="travel_addons" searchParams={searchParams}>
      <AddonResults query={await searchParams} />
    </VerticalPage>
  );
}
