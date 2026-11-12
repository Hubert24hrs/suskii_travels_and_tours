/** Letters that Unicode decomposition does not reduce to ASCII. */
const SPECIAL_LETTERS: Readonly<Record<string, string>> = {
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  đ: 'd',
  ð: 'd',
  ł: 'l',
  þ: 'th',
  ı: 'i',
};

/**
 * Accent-folded, lower-case, alphanumeric-only text used for trigram matching, so "Lagos",
 * "lagos" and "Lagós" all match, and so do "Sao Paulo" and "São Paulo". Applied identically to
 * stored rows (seed) and to queries.
 */
export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[øæœßđðłþı]/g, (letter) => SPECIAL_LETTERS[letter] ?? letter)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function airportSearchText(airport: {
  iataCode: string;
  name: string;
  municipality: string | null;
  countryName: string;
}): string {
  return normalizeSearchText(
    [airport.iataCode, airport.name, airport.municipality ?? '', airport.countryName].join(' '),
  );
}

export function citySearchText(city: { name: string; countryName: string }): string {
  return normalizeSearchText(`${city.name} ${city.countryName}`);
}
