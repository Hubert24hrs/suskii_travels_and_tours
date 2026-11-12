import { api } from '../../lib/api';
import { getI18n } from '../../lib/i18n';
import { productRatingJsonLd } from '../../lib/seo';
import { JsonLd } from '../json-ld';

import { ReviewsSection } from './reviews-section';

/**
 * A product page's verified reviews and, once one is published, the matching JSON-LD rating
 * (ADR-077). `sample` (demo) products carry no rating markup.
 */
export async function ProductReviews({
  kind,
  id,
  name,
  description,
  path,
  sample = false,
}: {
  kind: 'package' | 'tour' | 'bus_operator' | 'rental_vehicle';
  id: string;
  name: string;
  description: string;
  path: string;
  sample?: boolean;
}) {
  const [{ t }, page] = await Promise.all([getI18n(), api.reviews({ kind, ref: id })]);
  return (
    <>
      {page?.summary && !sample ? (
        <JsonLd
          data={productRatingJsonLd({
            name,
            description,
            path,
            summary: page.summary,
            reviews: page.items,
            anonymous: t('reviews.anonymous'),
          })}
        />
      ) : null}
      <ReviewsSection page={page} />
    </>
  );
}
