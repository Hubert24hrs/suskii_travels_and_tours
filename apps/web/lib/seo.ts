import { BRAND } from '@suskii/shared';
import type { Metadata } from 'next';

import { publicEnv } from './env';

export const absoluteUrl = (path: string): string => `${publicEnv.siteUrl}${path}`;

/** Per-page metadata with a canonical URL and matching Open Graph fields. */
export function pageMetadata(options: {
  title: string;
  description: string;
  path: string;
  /** Search pages and other thin or personal pages stay out of the index. */
  noIndex?: boolean;
}): Metadata {
  return {
    title: options.title,
    description: options.description,
    alternates: { canonical: options.path },
    openGraph: {
      type: 'website',
      siteName: BRAND.shortName,
      title: options.title,
      description: options.description,
      url: options.path,
    },
    twitter: {
      card: 'summary_large_image',
      title: options.title,
      description: options.description,
    },
    ...(options.noIndex ? { robots: { index: false, follow: true } } : {}),
  };
}

type JsonLd = Record<string, unknown>;

export const organizationJsonLd = (): JsonLd => ({
  '@context': 'https://schema.org',
  '@type': 'TravelAgency',
  name: BRAND.name,
  alternateName: BRAND.shortName,
  url: publicEnv.siteUrl,
});

export const websiteJsonLd = (): JsonLd => ({
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: BRAND.shortName,
  url: publicEnv.siteUrl,
});

export const faqJsonLd = (faqs: readonly { question: string; answer: string }[]): JsonLd => ({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: { '@type': 'Answer', text: faq.answer },
  })),
});

export const breadcrumbJsonLd = (items: readonly { name: string; path: string }[]): JsonLd => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: items.map((item, index) => ({
    '@type': 'ListItem',
    position: index + 1,
    name: item.name,
    item: absoluteUrl(item.path),
  })),
});

/**
 * A product's verified score (ADR-077), only when it has published reviews. The values are the
 * ones the page shows: search engines penalise ratings that differ from the visible ones.
 */
export const productRatingJsonLd = (options: {
  name: string;
  description: string;
  path: string;
  summary: { score: number; count: number };
  reviews: readonly {
    rating: number;
    title: string | null;
    liked: string | null;
    displayName: string | null;
    publishedAt: string;
  }[];
  anonymous: string;
}): JsonLd => ({
  '@context': 'https://schema.org',
  '@type': 'Product',
  name: options.name,
  description: options.description,
  url: absoluteUrl(options.path),
  aggregateRating: {
    '@type': 'AggregateRating',
    ratingValue: options.summary.score,
    ratingCount: options.summary.count,
    bestRating: 10,
    worstRating: 1,
  },
  review: options.reviews.slice(0, 5).map((review) => ({
    '@type': 'Review',
    author: { '@type': 'Person', name: review.displayName ?? options.anonymous },
    datePublished: review.publishedAt.slice(0, 10),
    reviewRating: { '@type': 'Rating', ratingValue: review.rating, bestRating: 10, worstRating: 1 },
    ...(review.title ? { name: review.title } : {}),
    ...(review.liked ? { reviewBody: review.liked } : {}),
  })),
});
