'use client';

import { useEffect } from 'react';

/**
 * Ad tags started on an earlier page stay in this document through client-side navigation, and
 * the stricter policy of a payment page only applies to a fresh document. Reload once, so only our
 * own scripts run where a payment starts (ADR-089); the reloaded page never starts the tags.
 */
export function PaymentPageGuard(): null {
  useEffect(() => {
    if ('fbq' in window || 'ttq' in window) window.location.reload();
  }, []);
  return null;
}
