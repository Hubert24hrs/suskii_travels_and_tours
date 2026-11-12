import Link from 'next/link';
import type { ComponentProps } from 'react';

type AppLinkProps = Omit<ComponentProps<typeof Link>, 'href'> & { href: string };

/**
 * next/link for runtime-built URLs (search links, CMS slugs) under typed routes. Prefetching is
 * off: dynamic pages render per request, and prefetching dozens of card links would cost the
 * homepage bandwidth and server time for nothing.
 */
export function AppLink({ href, prefetch = false, ...props }: AppLinkProps) {
  return <Link href={href} prefetch={prefetch} {...props} />;
}
