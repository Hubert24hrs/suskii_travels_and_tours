/**
 * The website's own cookies are host-only, `Path=/` and `Secure` in production, so they carry the
 * `__Host-` prefix there: the browser then refuses copies set by another subdomain or over plain
 * HTTP (ASVS V3.3.1, V3.3.3). Development serves plain HTTP, where the prefix cannot be used.
 * `process.env.NODE_ENV` is inlined in client bundles, so server and browser agree on the names.
 */
export const SECURE_COOKIES = process.env.NODE_ENV === 'production';

export const hostCookie = (name: string): string => (SECURE_COOKIES ? `__Host-${name}` : name);
