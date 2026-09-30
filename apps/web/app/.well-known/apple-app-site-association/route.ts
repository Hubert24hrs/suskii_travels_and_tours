import { appleAppSiteAssociation } from '../../../lib/mobile-app';

export const dynamic = 'force-dynamic';

/** iOS universal links for the mobile app (ADR-021); served without a redirect, as Apple requires. */
export function GET(): Response {
  const association = appleAppSiteAssociation();
  if (!association) return new Response('Not found', { status: 404 });
  return Response.json(association, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
