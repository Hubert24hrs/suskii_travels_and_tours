import type { Metadata } from 'next';

import { PackageResults } from '../../components/inhouse/catalog-results';
import type { SearchParams } from '../../lib/search-initial';
import { VerticalPage, verticalMetadata } from '../../lib/vertical-page';

interface Props {
  searchParams: Promise<SearchParams>;
}

export function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  return verticalMetadata('packages', searchParams);
}

export default async function Page({ searchParams }: Props) {
  return (
    <VerticalPage vertical="packages" searchParams={searchParams}>
      <PackageResults query={await searchParams} />
    </VerticalPage>
  );
}
