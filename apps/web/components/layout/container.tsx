import { cn } from '@suskii/ui-web';
import type { ComponentProps } from 'react';

/** Page-width wrapper with the 16px mobile gutter. */
export function Container({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('mx-auto w-full max-w-page px-4 md:px-6', className)} {...props} />;
}
