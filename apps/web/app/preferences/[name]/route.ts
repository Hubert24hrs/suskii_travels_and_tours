import { NextResponse, type NextRequest } from 'next/server';

import { isSupportedCurrency, isSupportedLocale } from '@suskii/shared';

import { SECURE_COOKIES } from '../../../lib/cookie-names';
import { CURRENCY_COOKIE, LOCALE_COOKIE } from '../../../lib/preferences';

const ONE_YEAR = 365 * 24 * 60 * 60;

/** Each preference: its form field's validator and cookie (ADR-010). */
const PREFERENCES = {
  currency: { valid: isSupportedCurrency, cookie: CURRENCY_COOKIE },
  locale: { valid: isSupportedLocale, cookie: LOCALE_COOKIE },
} as const;

const isPreference = (name: string): name is keyof typeof PREFERENCES => name in PREFERENCES;

/** The host the browser addressed, behind a proxy too. */
const requestHost = (request: NextRequest): string | null =>
  request.headers.get('x-forwarded-host') ?? request.headers.get('host');

/** Back to the page the form was on: the referring path on this host, never another site. */
function backTo(request: NextRequest): string {
  const referer = request.headers.get('referer');
  if (!referer) return '/';
  try {
    const url = new URL(referer);
    return url.host === requestHost(request) ? `${url.pathname}${url.search}` : '/';
  } catch {
    return '/';
  }
}

/**
 * Stores the display currency or locale from the header and footer selectors. A route handler
 * rather than a Server Action (GHSA-p3m5-59mp-jv5r affects apps with Server Actions until Next.js
 * can be upgraded, docs/audits/e2e-audit.md). Like a Server Action it refuses other origins. The
 * selector's script gets 204 and refreshes; a form posted without JavaScript is sent back with 303.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  const { name } = await params;
  if (!isPreference(name)) return new NextResponse(null, { status: 404 });
  const origin = request.headers.get('origin');
  if (origin !== null) {
    let host: string | null = null;
    try {
      host = new URL(origin).host;
    } catch {
      // A malformed Origin is another origin.
    }
    if (host !== requestHost(request)) return new NextResponse(null, { status: 403 });
  }

  let value: FormDataEntryValue | null = null;
  try {
    value = (await request.formData()).get(name);
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const preference = PREFERENCES[name];
  const navigation = request.headers.get('accept')?.includes('text/html') ?? false;
  const response = navigation
    ? NextResponse.redirect(new URL(backTo(request), request.url), 303)
    : new NextResponse(null, { status: 204 });
  // Unknown values are ignored, as before.
  if (typeof value === 'string' && preference.valid(value)) {
    response.cookies.set(preference.cookie, value, {
      path: '/',
      maxAge: ONE_YEAR,
      sameSite: 'lax',
      httpOnly: true,
      secure: SECURE_COOKIES,
    });
  }
  return response;
}
