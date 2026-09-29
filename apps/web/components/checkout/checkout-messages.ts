'use client';

import type { Messages } from '@suskii/i18n';
import { useTranslator } from '@suskii/i18n/react';

/** Catalog namespaces the checkout, payment and booking pages need on the client. */
export type BookingFlowMessages = Pick<
  Messages,
  'checkout' | 'booking' | 'payment' | 'results' | 'cabins' | 'common'
>;

export const useBookingT = () => useTranslator<BookingFlowMessages>();
