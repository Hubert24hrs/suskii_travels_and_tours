/**
 * Hosts a supplier's photographs may come from (`IMAGE_REMOTE_HOSTS`, ADR-010): the same list
 * the image optimiser and the CSP use. Read on the server and handed to the components that
 * show hotel photos (ADR-096).
 */
export function imageHosts(): string[] {
  return (process.env.IMAGE_REMOTE_HOSTS ?? '')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
}
