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

/** Cars products (ADR-049), shown only while switched on (`GET /v1/cars/features`). */
export const CARS_NAV_ITEMS = [
  { product: 'buses', vertical: 'buses', href: '/buses' },
  { product: 'rides', vertical: 'rides', href: '/rides' },
  { product: 'rentals', vertical: 'rentals', href: '/rentals' },
] as const;

/** WhatsApp click-to-chat link for an E.164 number. */
export const whatsappHref = (phone: string): string => `https://wa.me/${phone.replace(/\D/g, '')}`;
