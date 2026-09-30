'use client';

import { useTranslator } from '@suskii/i18n/react';
import { Button } from '@suskii/ui-web';

import type { ErrorMessages } from '../lib/i18n';

/** Error boundary for page segments. Shows no technical detail; the digest is logged server-side. */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useTranslator<ErrorMessages>();
  return (
    <div className="mx-auto flex w-full max-w-dialog flex-col gap-4 px-4 py-16">
      <h1 className="font-heading text-h2 font-extrabold text-heading">
        {t('pages.error.heading')}
      </h1>
      <p className="font-body text-body text-foreground">{t('pages.error.body')}</p>
      <Button type="button" onClick={reset} className="self-start">
        {t('pages.error.retry')}
      </Button>
    </div>
  );
}
