/**
 * A city's URL slug for hub pages (ADR-080): `Port Harcourt` → `port-harcourt`, accents dropped.
 * The API groups routes by it and the website links with it, so both build the same URLs.
 */
export function citySlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
