'use client';

import { DeferredDialog, useDeferredOverlay } from '@suskii/ui-web';
import { Menu } from 'lucide-react';
import type { ReactNode } from 'react';

import { AppLink } from '../app-link';

export interface MobileMenuProps {
  labels: { open: string; title: string; close: string };
  links: { href: string; label: string }[];
  /** Currency selector and support contacts rendered by the server. */
  footer?: ReactNode;
}

/**
 * Hamburger drawer for small screens: full-screen dialog with focus trap. The dialog code loads
 * when the menu is first opened (useDeferredOverlay), not with every page.
 */
export function MobileMenu({ labels, links, footer }: MobileMenuProps) {
  const overlay = useDeferredOverlay();
  return (
    <>
      <button
        type="button"
        aria-label={labels.open}
        {...overlay.triggerProps}
        className="-ml-2 inline-flex size-12 items-center justify-center rounded-pill text-foreground hover:bg-background focus-visible:focus-ring lg:hidden"
      >
        <Menu aria-hidden="true" className="size-6" />
      </button>
      <DeferredDialog
        overlay={overlay}
        variant="fullscreen"
        title={labels.title}
        closeLabel={labels.close}
      >
        <nav aria-label={labels.title}>
          <ul className="flex flex-col">
            {links.map((link) => (
              <li key={link.href}>
                <AppLink
                  href={link.href}
                  onClick={() => overlay.setOpen(false)}
                  className="flex min-h-12 items-center border-b border-border font-body text-body font-bold text-foreground hover:text-primary focus-visible:focus-ring"
                >
                  {link.label}
                </AppLink>
              </li>
            ))}
          </ul>
        </nav>
        {footer}
      </DeferredDialog>
    </>
  );
}
