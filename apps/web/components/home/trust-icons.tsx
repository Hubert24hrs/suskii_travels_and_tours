import { BadgeCheck, CalendarClock, Headset, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';

const ICONS: Record<string, ReactNode> = {
  support_24_7: <Headset className="size-5" />,
  flexible_payment: <CalendarClock className="size-5" />,
  secure_payments: <ShieldCheck className="size-5" />,
};

/** Icon for a CMS trust signal key; new keys get a neutral check badge. */
export const trustIcon = (key: string): ReactNode =>
  ICONS[key] ?? <BadgeCheck className="size-5" />;
