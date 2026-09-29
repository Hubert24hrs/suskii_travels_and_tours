import type { Vertical } from '@suskii/shared';

/** Primary navigation (PROJECT_SPEC.json#/homepage_spec header): one landing page per vertical. */
export const NAV_ITEMS: { vertical: Vertical; href: string }[] = [
  { vertical: 'flights', href: '/flights' },
  { vertical: 'hotels', href: '/hotels' },
  { vertical: 'packages', href: '/packages' },
  { vertical: 'tours', href: '/tours' },
  { vertical: 'visa', href: '/visa' },
  { vertical: 'travel_addons', href: '/travel-add-ons' },
];

/** WhatsApp click-to-chat link for an E.164 number. */
export const whatsappHref = (phone: string): string => `https://wa.me/${phone.replace(/\D/g, '')}`;
