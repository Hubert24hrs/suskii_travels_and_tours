import { Badge } from '@suskii/ui-web';

import { getI18n } from '../../lib/i18n';
import { CityArt } from '../art/city-art';

/** Title, illustration and key facts at the top of a package or tour page. */
export async function ProductHeader({
  title,
  summary,
  city,
  facts,
  sample,
}: {
  title: string;
  summary: string;
  city: string;
  facts: string[];
  sample: boolean;
}) {
  const { t } = await getI18n();
  return (
    <header className="flex flex-col gap-4">
      <div className="relative aspect-video overflow-hidden rounded-xl bg-skeleton">
        <CityArt city={city} priority />
        {sample ? (
          <Badge variant="neutral" className="absolute top-3 left-3">
            {t('inhouse.sample')}
          </Badge>
        ) : null}
      </div>
      <h1 className="font-heading text-hero-mobile font-extrabold text-heading md:text-hero">
        {title}
      </h1>
      <p className="font-body text-body-sm font-bold text-muted">{facts.join(' · ')}</p>
      <p className="font-body text-body text-foreground">{summary}</p>
      {sample ? (
        <p className="font-body text-body-sm text-foreground">{t('inhouse.sampleNote')}</p>
      ) : null}
    </header>
  );
}
