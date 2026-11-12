import { headers } from 'next/headers';

/**
 * Structured data block. `<` is escaped so CMS text can never close the script element; the nonce
 * keeps strict CSP reporting quiet even though JSON-LD is never executed.
 */
export async function JsonLd({
  data,
}: {
  data: Record<string, unknown> | Record<string, unknown>[];
}) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <script
      type="application/ld+json"
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
    />
  );
}
