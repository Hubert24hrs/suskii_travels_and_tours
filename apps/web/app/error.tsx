'use client';

import { getMessages } from '@suskii/i18n';
import { Button } from '@suskii/ui-web';

/** Error boundary for page segments. Shows no technical detail; the digest is logged server-side. */
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { pages } = getMessages('en-NG');
  return (
    <div className="mx-auto flex w-full max-w-dialog flex-col gap-4 px-4 py-16">
      <h1 className="font-heading text-h2 font-extrabold text-heading">{pages.error.heading}</h1>
      <p className="font-body text-body text-foreground">{pages.error.body}</p>
      <Button type="button" onClick={reset} className="self-start">
        {pages.error.retry}
      </Button>
    </div>
  );
}
