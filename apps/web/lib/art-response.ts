/**
 * An /art illustration: deterministic per input, so shared caches may keep it for a day and serve
 * it stale while revalidating. The document CSP forbids everything but the inline presentation
 * attributes, in case the SVG is opened directly.
 */
export function svgResponse(body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
    },
  });
}

export const notFound = (): Response => new Response(null, { status: 404 });
