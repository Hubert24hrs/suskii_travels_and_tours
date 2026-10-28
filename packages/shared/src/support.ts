/**
 * Support conversations (ADR-083): what a traveller asks about, how urgent it is and when staff
 * owe an answer. Pure rules shared by the API, the console and the clients.
 */

export const SUPPORT_CATEGORIES = [
  'pre_booking',
  'booking_change',
  'cancellation_refund',
  'payment',
  'documents',
  'other',
] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** `open`: staff owe a reply; `waiting`: staff replied and wait for the traveller. */
export const SUPPORT_STATUSES = ['open', 'waiting', 'resolved'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** Most urgent first: the console sorts and colours by this order. */
export const SUPPORT_PRIORITIES = ['urgent', 'prime', 'normal'] as const;
export type SupportPriority = (typeof SUPPORT_PRIORITIES)[number];

export const SUPPORT_CHANNELS = ['web', 'app', 'whatsapp'] as const;
export type SupportChannel = (typeof SUPPORT_CHANNELS)[number];

export const SUPPORT_AUTHORS = ['customer', 'staff', 'system'] as const;
export type SupportAuthor = (typeof SUPPORT_AUTHORS)[number];

/** Longest message a traveller or staff member can send, in characters. */
export const SUPPORT_MESSAGE_MAX = 2_000;
/** Messages one conversation may hold, so a loop or abuse cannot grow it without bound. */
export const SUPPORT_MESSAGES_PER_CONVERSATION = 500;
/** Conversations an account or guest email may have open at once. */
export const SUPPORT_OPEN_CONVERSATIONS_MAX = 5;

/** Minutes until staff owe a reply, and until the conversation should be resolved. */
export interface SupportTarget {
  responseMinutes: number;
  resolutionMinutes: number;
}
export type SupportTargets = Readonly<Record<SupportPriority, SupportTarget>>;

/**
 * Priority when a conversation starts: a trip starting within `urgentHours` (or that started in
 * the last day) is urgent, a current Suskii Prime member is in the Prime queue, everyone else is
 * normal. Staff can change it.
 */
export function supportPriority(input: {
  tripStartsAt: Date | null;
  prime: boolean;
  now: Date;
  urgentHours: number;
}): SupportPriority {
  const { tripStartsAt, now } = input;
  if (tripStartsAt) {
    const hours = (tripStartsAt.getTime() - now.getTime()) / 3_600_000;
    if (hours >= -24 && hours <= input.urgentHours) return 'urgent';
  }
  return input.prime ? 'prime' : 'normal';
}

/** A moment `minutes` after `from`. */
export const supportDueAt = (from: Date, minutes: number): Date =>
  new Date(from.getTime() + minutes * 60_000);

export interface SupportSchedule {
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
  /** The nearer of the two, which the inbox sorts by; null once resolved. */
  dueAt: Date | null;
}

/**
 * The due times of a conversation from its state: a reply is owed `responseMinutes` after the
 * traveller's first unanswered message, and resolution `resolutionMinutes` after the current open
 * spell began. Recomputed on every change, so a new priority moves both.
 */
export function supportSchedule(
  conversation: {
    status: SupportStatus;
    priority: SupportPriority;
    openedAt: Date;
    replyOwedSince: Date | null;
  },
  targets: SupportTargets,
): SupportSchedule {
  if (conversation.status === 'resolved') {
    return { responseDueAt: null, resolutionDueAt: null, dueAt: null };
  }
  const target = targets[conversation.priority];
  const responseDueAt = conversation.replyOwedSince
    ? supportDueAt(conversation.replyOwedSince, target.responseMinutes)
    : null;
  const resolutionDueAt = supportDueAt(conversation.openedAt, target.resolutionMinutes);
  const dueAt =
    responseDueAt && responseDueAt.getTime() < resolutionDueAt.getTime()
      ? responseDueAt
      : resolutionDueAt;
  return { responseDueAt, resolutionDueAt, dueAt };
}

export type SupportSlaState = 'met' | 'on_track' | 'due_soon' | 'breached';

/**
 * Where a conversation stands: against the reply staff owe while there is one (`responseDueAt`),
 * else against the resolution target. `due_soon` is the last fifth of the time the priority
 * allows, at least five minutes. Resolved conversations have nothing left to meet.
 */
export function supportSlaState(
  conversation: {
    status: SupportStatus;
    priority: SupportPriority;
    responseDueAt: Date | null;
    resolutionDueAt: Date | null;
  },
  targets: SupportTargets,
  now: Date,
): SupportSlaState {
  if (conversation.status === 'resolved') return 'met';
  const target = targets[conversation.priority];
  const [due, minutes] = conversation.responseDueAt
    ? [conversation.responseDueAt, target.responseMinutes]
    : [conversation.resolutionDueAt, target.resolutionMinutes];
  if (!due) return 'on_track';
  const left = due.getTime() - now.getTime();
  if (left < 0) return 'breached';
  return left <= Math.max((minutes * 60_000) / 5, 5 * 60_000) ? 'due_soon' : 'on_track';
}

/** Characters of a support reference after the prefix ("S-7KX2Q9"); no 0/O, 1/I/L or U. */
export const SUPPORT_REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const SUPPORT_REFERENCE_PATTERN = /^S-[2-9A-HJKMNP-TV-Z]{6}$/;
