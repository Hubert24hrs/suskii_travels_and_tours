import { assetLinks } from '../../../lib/mobile-app';

// The statement depends on runtime configuration, not on the build.
export const dynamic = 'force-dynamic';

/** Android App Links verification for the mobile app (ADR-021). */
export function GET(): Response {
  const statement = assetLinks();
  if (!statement) return new Response('Not found', { status: 404 });
  return Response.json(statement, { headers: { 'Cache-Control': 'public, max-age=3600' } });
}
