/**
 * A small, dependency-free client for Sentry's envelope endpoint (ADR-046), used by the API, the
 * worker, the web app, the console and the mobile app behind their `ErrorReporter`. It sends the
 * error type, a scrubbed message, the stack and a few allowlisted tags. It never sends request
 * data, headers, cookies, users, URLs with queries, or breadcrumbs. Reporting never throws.
 */

export type ErrorPlatform = 'node' | 'javascript';

/** The part of `fetch` the reporter uses; shared code compiles without DOM types. */
export type ReportFetch = (
  url: string,
  init: { method: 'POST'; body: string; keepalive: boolean },
) => Promise<{ status: number }>;

/** Runtime globals that Node, browsers and React Native provide (Hermes lacks Web Crypto). */
const runtime = globalThis as unknown as {
  fetch?: ReportFetch;
  crypto?: { getRandomValues?: (data: Uint8Array) => Uint8Array };
};

export interface ErrorReporterOptions {
  dsn: string;
  platform: ErrorPlatform;
  /** The service that reports (`api`, `worker`, `web`, `admin`, `mobile`). */
  service: string;
  release?: string | undefined;
  environment?: string | undefined;
  /** Events per minute at most; the rest are dropped (default 20). */
  maxPerMinute?: number;
  fetch?: ReportFetch;
  now?: () => number;
}

/** Tags an event may carry: ids and route templates only, never values from the request. */
export const ERROR_TAG_KEYS = [
  'requestId',
  'route',
  'method',
  'status',
  'queue',
  'job',
  'task',
  'screen',
  'kind',
  'digest',
] as const;
export type ErrorTagKey = (typeof ERROR_TAG_KEYS)[number];
export type ErrorTags = Partial<Record<ErrorTagKey, string | number | undefined>>;

export interface ErrorReporter {
  /** Queues the report; resolves once it is sent or dropped. Never rejects. */
  capture(error: unknown, tags?: ErrorTags): Promise<void>;
}

interface Dsn {
  url: string;
  publicKey: string;
}

const DSN = /^(https?):\/\/([^@/:]+)(?::[^@/]*)?@([^/]+)((?:\/[^/]+)*?)\/(\d+)\/?$/;

/**
 * `https://<key>@<host>[/<path>]/<project>` to its envelope endpoint, or null when malformed.
 * Parsed by hand: React Native's URL has no `username`.
 */
export function parseDsn(dsn: string): Dsn | null {
  const match = DSN.exec(dsn.trim());
  if (!match) return null;
  const [, protocol, publicKey = '', host = '', path = '', project = ''] = match;
  if (protocol !== 'https' && !/^localhost(?::\d+)?$/.test(host)) return null;
  return { url: `${protocol}://${host}${path}/api/${project}/envelope/`, publicKey };
}

const SCRUBBERS: [RegExp, string][] = [
  // Bearer tokens and JWTs.
  [/\bBearer\s+[\w.~+/=-]+/gi, 'Bearer [redacted]'],
  [/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[jwt]'],
  // E-mail addresses.
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]'],
  // Query strings and fragments of URLs (guest tokens travel in fragments, ADR-015).
  [/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, '$1'],
  // IP addresses (personal data under the NDPA and GDPR).
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '[ip]'],
  [/\b(?:[0-9a-fA-F]{1,4}:){3,7}[0-9a-fA-F]{1,4}\b/g, '[ip]'],
  // Phone numbers and long digit runs (cards, passports with digits, phone numbers).
  [/\+?\d[\d\s().-]{7,}\d/g, '[number]'],
  // Long opaque secrets (keys, tokens). UUIDs stay: they are record ids and grant nothing.
  [
    /\b(?![0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g,
    '[secret]',
  ],
];

/** Removes what could identify a person or grant access from free text. */
export function scrubText(text: string): string {
  let out = text.slice(0, 1000);
  for (const [pattern, replacement] of SCRUBBERS) out = out.replace(pattern, replacement);
  return out;
}

export interface StackFrame {
  function?: string;
  filename: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

const V8_FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/;
const JSC_FRAME = /^\s*(?:(.*?)@)?(.+?):(\d+):(\d+)\s*$/;

/** V8 (Node, Chrome) and JavaScriptCore/SpiderMonkey/Hermes stacks, oldest frame first. */
export function parseStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split('\n').slice(0, 60)) {
    const match = V8_FRAME.exec(line) ?? (line.includes('@') ? JSC_FRAME.exec(line) : null);
    if (!match) continue;
    const [, fn, file = '', lineno, colno] = match;
    const filename = file.replace(/[?#].*$/, '');
    frames.push({
      ...(fn ? { function: fn } : {}),
      filename,
      lineno: Number(lineno),
      colno: Number(colno),
      in_app: !/node_modules|^node:|^internal\//.test(filename),
    });
  }
  return frames.reverse();
}

interface ExceptionValue {
  type: string;
  value: string;
  stacktrace?: { frames: StackFrame[] };
}

function exceptionValues(error: unknown): ExceptionValue[] {
  const values: ExceptionValue[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current !== undefined && current !== null; depth += 1) {
    if (current instanceof Error) {
      const frames = parseStack(current.stack);
      values.push({
        type: current.name || 'Error',
        value: scrubText(current.message),
        ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
      });
      current = (current as { cause?: unknown }).cause;
    } else {
      values.push({ type: 'NonError', value: scrubText(describeValue(current)) });
      current = undefined;
    }
  }
  // Sentry lists the outermost exception last.
  return values.reverse();
}

/** Primitives as text; objects only by kind, since their contents may hold personal data. */
function describeValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint')
    return value.toString();
  const name = (value as { constructor?: { name?: unknown } } | null)?.constructor?.name;
  return `[${typeof name === 'string' ? name : typeof value}]`;
}

/** Event ids need to be unique, not secret: Hermes has no Web Crypto without a polyfill. */
function randomHex(bytes: number): string {
  const data = new Uint8Array(bytes);
  if (typeof runtime.crypto?.getRandomValues === 'function') runtime.crypto.getRandomValues(data);
  else for (let index = 0; index < bytes; index += 1) data[index] = Math.floor(Math.random() * 256);
  return Array.from(data, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** The Sentry event for an error: no request, user or extra data, only allowlisted tags. */
export function buildErrorEvent(
  error: unknown,
  options: Pick<ErrorReporterOptions, 'platform' | 'service' | 'release' | 'environment'>,
  tags: ErrorTags = {},
  now = Date.now(),
): Record<string, unknown> {
  const safeTags: Record<string, string> = { service: options.service };
  for (const key of ERROR_TAG_KEYS) {
    const value = tags[key];
    if (value !== undefined) safeTags[key] = scrubText(String(value)).slice(0, 200);
  }
  return {
    event_id: randomHex(16),
    timestamp: now / 1000,
    platform: options.platform,
    level: 'error',
    logger: options.service,
    ...(options.release ? { release: options.release } : {}),
    ...(options.environment ? { environment: options.environment } : {}),
    tags: safeTags,
    exception: { values: exceptionValues(error) },
  };
}

function fingerprint(error: unknown): string {
  if (!(error instanceof Error)) return describeValue(error).slice(0, 200);
  const frames = parseStack(error.stack);
  const top = frames[frames.length - 1];
  return `${error.name}:${error.message.slice(0, 200)}:${top?.filename ?? ''}:${top?.lineno ?? ''}`;
}

/**
 * A reporter that posts to Sentry. Authentication goes in the query string and the body is sent
 * as text, so browsers make a simple request (no CORS preflight). At most `maxPerMinute` events
 * leave per minute, the same error is sent once a minute, and a 429 pauses reporting for a minute.
 */
export function createSentryReporter(options: ErrorReporterOptions): ErrorReporter {
  const dsn = parseDsn(options.dsn);
  const send: ReportFetch | undefined = options.fetch ?? runtime.fetch?.bind(globalThis);
  const now = options.now ?? Date.now;
  const limit = options.maxPerMinute ?? 20;
  const recent = new Map<string, number>();
  let windowStart = 0;
  let sentInWindow = 0;
  let pausedUntil = 0;

  return {
    async capture(error, tags) {
      if (!dsn || !send) return;
      const at = now();
      if (at < pausedUntil) return;
      if (at - windowStart >= 60_000) {
        windowStart = at;
        sentInWindow = 0;
        for (const [key, time] of recent) if (at - time >= 60_000) recent.delete(key);
      }
      const key = fingerprint(error);
      if (sentInWindow >= limit || recent.has(key)) return;
      sentInWindow += 1;
      recent.set(key, at);
      try {
        const event = buildErrorEvent(error, options, tags, at);
        const body = [
          JSON.stringify({ event_id: event.event_id, sent_at: new Date(at).toISOString() }),
          JSON.stringify({ type: 'event' }),
          JSON.stringify(event),
        ].join('\n');
        const auth = `sentry_version=7&sentry_key=${encodeURIComponent(dsn.publicKey)}&sentry_client=suskii%2F1`;
        const response = await send(`${dsn.url}?${auth}`, {
          method: 'POST',
          body,
          keepalive: true,
        });
        if (response.status === 429) pausedUntil = at + 60_000;
      } catch {
        // Reporting must never become a failure of its own.
      }
    },
  };
}

/** For services without a DSN: reports go nowhere. */
export const noopErrorReporter: ErrorReporter = { capture: () => Promise.resolve() };
