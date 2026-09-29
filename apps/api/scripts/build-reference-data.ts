/**
 * Builds the committed reference datasets in prisma/data from OurAirports (public domain,
 * https://ourairports.com/data/). Run when refreshing the data:
 *
 *   pnpm --filter @suskii/api data:build
 *
 * Keeps airports with an IATA code and scheduled passenger service, and computes each airport's
 * IANA time zone from its coordinates (flight times are stored in UTC plus this zone).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import tzlookup from '@photostructure/tz-lookup';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';

const SOURCE = 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main';
const OUT_DIR = join(__dirname, '..', 'prisma', 'data');
const AIRPORT_TYPES = new Set(['large_airport', 'medium_airport', 'small_airport']);

interface CountryRow {
  code: string;
  name: string;
  continent: string;
}

interface AirportRow {
  type: string;
  name: string;
  latitude_deg: string;
  longitude_deg: string;
  iso_country: string;
  municipality: string;
  scheduled_service: string;
  icao_code: string;
  gps_code: string;
  iata_code: string;
}

async function download(file: string): Promise<string> {
  const response = await fetch(`${SOURCE}/${file}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
  return response.text();
}

async function main(): Promise<void> {
  const options = { columns: true, skip_empty_lines: true } as const;
  const countries = parse<CountryRow>(await download('countries.csv'), options);
  const airports = parse<AirportRow>(await download('airports.csv'), options);

  const countryRows = countries
    .filter((row) => /^[A-Z]{2}$/.test(row.code))
    .map((row) => ({ code: row.code, name: row.name, continent: row.continent }))
    .sort((a, b) => a.code.localeCompare(b.code));
  const countryCodes = new Set(countryRows.map((row) => row.code));

  const seen = new Set<string>();
  const airportRows = airports
    .filter(
      (row) =>
        AIRPORT_TYPES.has(row.type) &&
        row.scheduled_service === 'yes' &&
        /^[A-Z]{3}$/.test(row.iata_code) &&
        countryCodes.has(row.iso_country),
    )
    // Prefer the larger airport when two records share an IATA code.
    .sort((a, b) => [...AIRPORT_TYPES].indexOf(a.type) - [...AIRPORT_TYPES].indexOf(b.type))
    .filter((row) => (seen.has(row.iata_code) ? false : (seen.add(row.iata_code), true)))
    .map((row) => {
      const latitude = Number(row.latitude_deg);
      const longitude = Number(row.longitude_deg);
      const icao = row.icao_code || row.gps_code;
      return {
        iata_code: row.iata_code,
        icao_code: /^[A-Z0-9]{4}$/.test(icao) ? icao : '',
        name: row.name,
        type: row.type,
        municipality: row.municipality,
        country_code: row.iso_country,
        latitude: latitude.toFixed(6),
        longitude: longitude.toFixed(6),
        timezone: tzlookup(latitude, longitude),
      };
    })
    .sort((a, b) => a.iata_code.localeCompare(b.iata_code));

  await mkdir(OUT_DIR, { recursive: true });
  const write = (file: string, rows: Record<string, string>[]): Promise<void> =>
    writeFile(join(OUT_DIR, file), stringify(rows, { header: true }));
  await write('countries.csv', countryRows);
  await write('airports.csv', airportRows);
  await writeFile(
    join(OUT_DIR, 'SOURCE.json'),
    `${JSON.stringify({ source: SOURCE, license: 'Public domain (OurAirports)', generatedAt: new Date().toISOString(), countries: countryRows.length, airports: airportRows.length }, null, 2)}\n`,
  );
  process.stdout.write(`countries: ${countryRows.length}, airports: ${airportRows.length}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${(error as Error).message}\n`);
  process.exit(1);
});
