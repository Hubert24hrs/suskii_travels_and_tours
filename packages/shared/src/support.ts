import { utcToLocal } from './time';

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
  'general',
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

/** `assistant`: the after-hours assistant (ADR-085), never a person. */
export const SUPPORT_AUTHORS = ['customer', 'staff', 'system', 'assistant'] as const;
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

/**
 * What a message holds: text, a WhatsApp attachment we do not accept yet (ADR-084), or the
 * assistant's handover to people (ADR-085), which clients show in the traveller's language.
 */
export const SUPPORT_MESSAGE_KINDS = ['text', 'unsupported', 'handover'] as const;
export type SupportMessageKind = (typeof SUPPORT_MESSAGE_KINDS)[number];

/**
 * Where a staff reply sent over WhatsApp stands. `pending` before the call to Meta; then `sent`,
 * `delivered` and `read` from the answer and status webhooks, or `failed`.
 */
export const SUPPORT_DELIVERY_STATUSES = [
  'pending',
  'sent',
  'delivered',
  'read',
  'failed',
] as const;
export type SupportDeliveryStatus = (typeof SUPPORT_DELIVERY_STATUSES)[number];

const DELIVERY_ORDER: Record<Exclude<SupportDeliveryStatus, 'failed'>, number> = {
  pending: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

/**
 * Whether a status webhook may move a message from `current` to `next`. Statuses only move
 * forward, so a late `sent` never overwrites `read`; `failed` can follow `pending` or `sent`
 * (Meta reports failures after accepting a message) but never a delivery, and nothing follows it.
 */
export function supportDeliveryAdvances(
  current: SupportDeliveryStatus,
  next: SupportDeliveryStatus,
): boolean {
  if (current === 'failed' || current === next) return false;
  if (next === 'failed') return current === 'pending' || current === 'sent';
  return DELIVERY_ORDER[next] > DELIVERY_ORDER[current];
}

/** Hours after a person's last message during which a business may write freely on WhatsApp. */
export const WHATSAPP_WINDOW_HOURS = 24;

/** Whether the WhatsApp customer service window is open: free text now, else a template. */
export const whatsappWindowOpen = (lastInboundAt: Date | null, now: Date): boolean =>
  lastInboundAt !== null &&
  now.getTime() - lastInboundAt.getTime() < WHATSAPP_WINDOW_HOURS * 3_600_000;

/** When the window closes, for the console; null when it is closed already. */
export const whatsappWindowClosesAt = (lastInboundAt: Date | null, now: Date): Date | null =>
  lastInboundAt && whatsappWindowOpen(lastInboundAt, now)
    ? new Date(lastInboundAt.getTime() + WHATSAPP_WINDOW_HOURS * 3_600_000)
    : null;

// Not "cancel" or "end": in a support chat those usually mean a booking, not the messages.
const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe']);

/** A message that asks for no more business-initiated messages (just the word, any case). */
export const isWhatsAppStop = (text: string): boolean =>
  STOP_WORDS.has(
    text
      .trim()
      .toLowerCase()
      .replace(/[.!]+$/u, ''),
  );

/** Longest answer the after-hours assistant may send, in characters (ADR-085). */
export const SUPPORT_ASSISTANT_ANSWER_MAX = 1_200;

/** Days as `SUPPORT_HOURS` names them, in `Date.getUTCDay()` order. */
export const SUPPORT_WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
export type SupportWeekday = (typeof SUPPORT_WEEKDAYS)[number];

/** Staffed on these days from `fromMinute` (inclusive) to `toMinute` (exclusive), local time. */
export interface SupportHoursSpan {
  days: SupportWeekday[];
  fromMinute: number;
  toMinute: number;
}

const HOURS_SPAN = /^([a-z]{3})(?:-([a-z]{3}))? (\d{2}):(\d{2})-(\d{2}):(\d{2})$/;

const weekday = (name: string | undefined): number =>
  SUPPORT_WEEKDAYS.findIndex((day) => day === name);

/**
 * Staffed hours (ADR-085) from settings text: comma-separated spans of days and 24-hour times in
 * the support time zone, such as `mon-fri 08:00-20:00, sat 09:00-14:00`. A day range may wrap
 * (`fri-mon`) and `24:00` ends a day. Empty text means no staffed hours. Null when invalid.
 */
export function parseSupportHours(text: string): SupportHoursSpan[] | null {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === '') return [];
  const spans: SupportHoursSpan[] = [];
  for (const part of trimmed.split(',')) {
    const match = HOURS_SPAN.exec(part.trim().replace(/\s+/g, ' '));
    if (!match) return null;
    const [, first, last, fromHour, fromMin, toHour, toMin] = match;
    const start = weekday(first);
    const end = weekday(last ?? first);
    const fromMinute = Number(fromHour) * 60 + Number(fromMin);
    const toMinute = Number(toHour) * 60 + Number(toMin);
    const minutesValid = Number(fromMin) < 60 && Number(toMin) < 60;
    if (start < 0 || end < 0 || !minutesValid || fromMinute >= toMinute || toMinute > 1440) {
      return null;
    }
    const days: SupportWeekday[] = [];
    for (let offset = 0; offset <= (end - start + 7) % 7; offset += 1) {
      const day = SUPPORT_WEEKDAYS[(start + offset) % 7];
      if (day) days.push(day);
    }
    spans.push({ days, fromMinute, toMinute });
  }
  return spans;
}

/** Whether someone is on shift at `now` under `hours` in `timeZone`. No hours: nobody is. */
export function supportStaffed(
  hours: readonly SupportHoursSpan[],
  timeZone: string,
  now: Date,
): boolean {
  const local = utcToLocal(now, timeZone);
  const day = SUPPORT_WEEKDAYS[new Date(`${local.slice(0, 10)}T00:00:00Z`).getUTCDay()];
  const minute = Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16));
  return hours.some(
    (span) =>
      day !== undefined &&
      span.days.includes(day) &&
      minute >= span.fromMinute &&
      minute < span.toMinute,
  );
}
