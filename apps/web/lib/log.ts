/** Server-side operational notices (no PII: paths and status codes only). */
export function warn(message: string): void {
  // eslint-disable-next-line no-console -- the web server's structured stderr log.
  console.warn(message);
}
