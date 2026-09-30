'use client';

import { Button } from '@suskii/ui-web';
import { useEffect } from 'react';

/**
 * Hands control back to the app after a hosted payment (ADR-021). The automatic jump works in
 * ASWebAuthenticationSession and usually in Chrome Custom Tabs; the button covers the rest.
 */
export function OpenApp({ href, label }: { href: string; label: string }) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);
  return (
    <Button asChild className="self-start">
      <a href={href} data-testid="open-app">
        {label}
      </a>
    </Button>
  );
}
