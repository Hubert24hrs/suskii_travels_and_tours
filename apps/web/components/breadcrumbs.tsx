import { ChevronRight } from 'lucide-react';

import { getI18n } from '../lib/i18n';
import { breadcrumbJsonLd } from '../lib/seo';

import { AppLink } from './app-link';
import { JsonLd } from './json-ld';

/** Visible breadcrumb trail plus its BreadcrumbList structured data. The last item is the page. */
export async function Breadcrumbs({ items }: { items: { name: string; path: string }[] }) {
  const { t } = await getI18n();
  const trail = [{ name: t('common.breadcrumbHome'), path: '/' }, ...items];
  return (
    <>
      <JsonLd data={breadcrumbJsonLd(trail)} />
      <nav aria-label="Breadcrumb">
        <ol className="flex flex-wrap items-center gap-1 font-body text-body-sm text-muted">
          {trail.map((item, index) => (
            <li key={item.path} className="flex items-center gap-1">
              {index > 0 ? <ChevronRight aria-hidden="true" className="size-4" /> : null}
              {index === trail.length - 1 ? (
                <span aria-current="page" className="text-foreground">
                  {item.name}
                </span>
              ) : (
                <AppLink
                  href={item.path}
                  className="inline-flex min-h-12 items-center hover:text-primary hover:underline focus-visible:focus-ring"
                >
                  {item.name}
                </AppLink>
              )}
            </li>
          ))}
        </ol>
      </nav>
    </>
  );
}
