'use client';

import { Dialog, DialogClose, DialogContent, DialogTrigger } from '@suskii/ui-web';
import { Menu } from 'lucide-react';
import type { ReactNode } from 'react';

import { AppLink } from '../app-link';

export interface MobileMenuProps {
  labels: { open: string; title: string; close: string };
  links: { href: string; label: string }[];
  /** Currency selector and support contacts rendered by the server. */
  footer?: ReactNode;
}

/** Hamburger drawer for small screens: full-screen dialog with focus trap. */
export function MobileMenu({ labels, links, footer }: MobileMenuProps) {
  return (
    <Dialog>
      <DialogTrigger
        aria-label={labels.open}
        className="-ml-2 inline-flex size-12 items-center justify-center rounded-pill text-foreground hover:bg-background focus-visible:focus-ring lg:hidden"
      >
        <Menu aria-hidden="true" className="size-6" />
      </DialogTrigger>
      <DialogContent variant="fullscreen" title={labels.title} closeLabel={labels.close}>
        <nav aria-label={labels.title}>
          <ul className="flex flex-col">
            {links.map((link) => (
              <li key={link.href}>
                <DialogClose asChild>
                  <AppLink
                    href={link.href}
                    className="flex min-h-12 items-center border-b border-border font-body text-body font-bold text-foreground hover:text-primary focus-visible:focus-ring"
                  >
                    {link.label}
                  </AppLink>
                </DialogClose>
              </li>
            ))}
          </ul>
        </nav>
        {footer}
      </DialogContent>
    </Dialog>
  );
}
