'use client';

import { Button } from '@suskii/ui-web';
import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

import { useSearchT } from './use-search-t';

/** Submit row with the error summary (announced when validation fails). */
export function FormFooter({
  label,
  hasErrors,
  submitting,
  children,
}: {
  label: string;
  hasErrors: boolean;
  submitting: boolean;
  children?: ReactNode;
}) {
  const { t } = useSearchT();
  return (
    <>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>{children}</div>
        <Button type="submit" fullWidth="mobile" loading={submitting}>
          <Search aria-hidden="true" className="size-5" />
          {label}
        </Button>
      </div>
      <p role="alert" className="font-body text-body-sm text-danger empty:hidden">
        {hasErrors ? t('search.issues.summary') : ''}
      </p>
    </>
  );
}
