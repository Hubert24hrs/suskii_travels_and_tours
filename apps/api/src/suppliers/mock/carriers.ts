/**
 * MOCK fixture: real carrier codes and hubs so generated itineraries look plausible. Schedules,
 * flight numbers and fares are synthetic; offers are labelled `supplier: "mock"` and never shown
 * in production.
 */
export interface MockCarrier {
  code: string;
  name: string;
  hubs: readonly string[];
  /**
   * `domestic`: flights within `country` only; `regional`: within Africa from its hubs;
   * `global`: from its hubs to anywhere in range.
   */
  scope: 'domestic' | 'regional' | 'global';
  country?: string;
  maxRangeKm: number;
}

export const MOCK_CARRIERS: readonly MockCarrier[] = [
  { code: 'P4', name: 'Air Peace', hubs: ['LOS', 'ABV'], scope: 'regional', maxRangeKm: 5500 },
  {
    code: 'W3',
    name: 'Arik Air',
    hubs: ['LOS', 'ABV'],
    scope: 'domestic',
    country: 'NG',
    maxRangeKm: 1500,
  },
  {
    code: 'QI',
    name: 'Ibom Air',
    hubs: ['LOS', 'ABV', 'QUO'],
    scope: 'domestic',
    country: 'NG',
    maxRangeKm: 1500,
  },
  { code: 'AW', name: 'Africa World Airlines', hubs: ['ACC'], scope: 'regional', maxRangeKm: 2500 },
  { code: 'KP', name: 'ASKY Airlines', hubs: ['LFW'], scope: 'regional', maxRangeKm: 5000 },
  { code: 'KQ', name: 'Kenya Airways', hubs: ['NBO'], scope: 'global', maxRangeKm: 9000 },
  { code: 'ET', name: 'Ethiopian Airlines', hubs: ['ADD'], scope: 'global', maxRangeKm: 13_000 },
  { code: 'WB', name: 'RwandAir', hubs: ['KGL'], scope: 'regional', maxRangeKm: 5000 },
  { code: 'SA', name: 'South African Airways', hubs: ['JNB'], scope: 'global', maxRangeKm: 9000 },
  { code: 'AT', name: 'Royal Air Maroc', hubs: ['CMN'], scope: 'global', maxRangeKm: 9000 },
  { code: 'MS', name: 'EgyptAir', hubs: ['CAI'], scope: 'global', maxRangeKm: 9000 },
  { code: 'EK', name: 'Emirates', hubs: ['DXB'], scope: 'global', maxRangeKm: 14_000 },
  { code: 'QR', name: 'Qatar Airways', hubs: ['DOH'], scope: 'global', maxRangeKm: 14_000 },
  { code: 'TK', name: 'Turkish Airlines', hubs: ['IST'], scope: 'global', maxRangeKm: 12_000 },
  { code: 'BA', name: 'British Airways', hubs: ['LHR'], scope: 'global', maxRangeKm: 13_000 },
  { code: 'VS', name: 'Virgin Atlantic', hubs: ['LHR'], scope: 'global', maxRangeKm: 11_000 },
  { code: 'AF', name: 'Air France', hubs: ['CDG'], scope: 'global', maxRangeKm: 12_000 },
  { code: 'KL', name: 'KLM', hubs: ['AMS'], scope: 'global', maxRangeKm: 12_000 },
  { code: 'LH', name: 'Lufthansa', hubs: ['FRA'], scope: 'global', maxRangeKm: 12_000 },
  {
    code: 'DL',
    name: 'Delta Air Lines',
    hubs: ['ATL', 'JFK'],
    scope: 'global',
    maxRangeKm: 12_000,
  },
  {
    code: 'UA',
    name: 'United Airlines',
    hubs: ['EWR', 'IAD'],
    scope: 'global',
    maxRangeKm: 12_000,
  },
];

/** Fictional fallback so every valid airport pair returns something in development. */
export const FALLBACK_CARRIER: MockCarrier = {
  code: 'ZZ',
  name: 'Suskii Mock Air',
  hubs: [],
  scope: 'global',
  maxRangeKm: 20_000,
};

export const MOCK_HUBS: readonly string[] = [
  ...new Set(MOCK_CARRIERS.flatMap((carrier) => carrier.hubs)),
];

/** ISO 3166-1 codes of African countries (regional carrier scope). */
// prettier-ignore
export const AFRICAN_COUNTRIES = new Set([
  'DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CV', 'CM', 'CF', 'TD', 'KM', 'CD', 'CG', 'CI', 'DJ', 'EG',
  'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML',
  'MR', 'MU', 'MA', 'MZ', 'NA', 'NE', 'NG', 'RW', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD',
  'TZ', 'TG', 'TN', 'UG', 'ZM', 'ZW',
]);
