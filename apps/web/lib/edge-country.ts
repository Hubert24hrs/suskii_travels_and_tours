import { headers } from 'next/headers';

/** Codes edges use for "unknown" and "Tor": not a country. */
const NOT_A_COUNTRY = new Set(['XX', 'T1']);

/**
 * The visitor's country as the edge reported it (`CLIENT_COUNTRY_HEADER`, e.g. `cf-ipcountry`
 * behind Cloudflare), or null when the setting is absent. Only set it where the edge overwrites
 * the header on every request; otherwise it is whatever the client sent. Used for displayed
 * Suskii Prime prices (ADR-082); what a quote charges follows the API's own edge header.
 */
export async function edgeCountry(): Promise<string | null> {
  const name = process.env.CLIENT_COUNTRY_HEADER;
  if (!name) return null;
  const code = ((await headers()).get(name) ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && !NOT_A_COUNTRY.has(code) ? code : null;
}
