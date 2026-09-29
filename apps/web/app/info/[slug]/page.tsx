import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Breadcrumbs } from '../../../components/breadcrumbs';
import { Container } from '../../../components/layout/container';
import { api } from '../../../lib/api';
import { getI18n } from '../../../lib/i18n';
import { pageMetadata } from '../../../lib/seo';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await getI18n();
  const { slug } = await params;
  const page = await api.page(slug, locale);
  if (!page) return {};
  return pageMetadata({
    title: page.title,
    description: page.sections[0]?.paragraphs[0]?.slice(0, 155) ?? page.title,
    path: `/info/${page.slug}`,
  });
}

/**
 * Published CMS page (terms, privacy, about...). Structured content rendered as React text, so
 * no CMS HTML ever reaches the page; unpublished pages do not exist.
 */
export default async function InfoPage({ params }: Props) {
  const { locale, format } = await getI18n();
  const { slug } = await params;
  const page = await api.page(slug, locale);
  if (!page) notFound();
  return (
    <Container className="py-8">
      <div className="flex max-w-dialog flex-col gap-6">
        <Breadcrumbs items={[{ name: page.title, path: `/info/${page.slug}` }]} />
        <h1 className="font-heading text-h2 font-extrabold text-heading">{page.title}</h1>
        <p className="font-body text-caption text-muted">
          <time dateTime={page.updatedAt}>{format.date(page.updatedAt.slice(0, 10), 'long')}</time>
        </p>
        {page.sections.map((section, index) => (
          <section key={index} className="flex flex-col gap-3">
            {section.heading ? (
              <h2 className="font-heading text-h4 font-bold text-heading">{section.heading}</h2>
            ) : null}
            {section.paragraphs.map((paragraph, position) => (
              <p key={position} className="font-body text-body text-foreground">
                {paragraph}
              </p>
            ))}
          </section>
        ))}
      </div>
    </Container>
  );
}
