import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { z } from 'zod';

import { PrismaService } from '../infra/prisma.service';

import type {
  airportSchema,
  airportSuggestionSchema,
  citySuggestionSchema,
  popularPlacesSchema,
} from './catalog.schemas';
import { normalizeSearchText } from './search-text';

type AirportSuggestion = z.infer<typeof airportSuggestionSchema>;
type CitySuggestion = z.infer<typeof citySuggestionSchema>;
export type PlaceSuggestion = AirportSuggestion | CitySuggestion;
export type AirportDetail = z.infer<typeof airportSchema>;
type PopularPlaces = z.infer<typeof popularPlacesSchema>;

/** What search orchestration needs to know about an airport. */
export interface AirportInfo {
  code: string;
  name: string;
  cityName: string | null;
  countryCode: string;
  latitude: number;
  longitude: number;
  timeZone: string;
}

interface AirportRow {
  code: string;
  name: string;
  city_id: string | null;
  city_name: string | null;
  country_code: string;
  country_name: string;
  timezone: string;
  rank: number;
}

interface CityRow {
  id: string;
  name: string;
  country_code: string;
  country_name: string;
  timezone: string | null;
  rank: number;
  airports: { code: string; name: string }[];
}

const AIRPORT_INFO_TTL_MS = 60 * 60 * 1000;

/**
 * Looser than pg_trgm's defaults (0.3 / 0.6) so single typos ("lagso") still match. The tables
 * hold a few thousand rows, so the resulting sequential scan costs a few milliseconds; the GIN
 * indexes serve the prefix LIKE clauses.
 */
const SIMILARITY_THRESHOLD = 0.2;
const WORD_SIMILARITY_THRESHOLD = 0.3;

/**
 * Autocomplete relevance, computed in SQL so LIMIT keeps the best rows:
 *   exact IATA code +100 > text starts with the query +50 > a word starts with it +30,
 *   plus trigram similarity x 20 (whole-text similarity x 5 breaks ties towards closer names), a
 *   major airport +5, the primary market (Nigeria +8, rest of
 *   Africa +3; PROJECT_SPEC.json#/product) and +1 for cities, so "Lagos (all airports)" sits just
 *   above the airport itself. Multi-airport cities get +1.5 per extra airport (up to 3), a proxy
 *   for metro size until search logs provide real popularity.
 */
@Injectable()
export class CatalogService {
  private popular: PopularPlaces | undefined;
  private readonly airportCache = new Map<string, { info: AirportInfo | null; expires: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async suggest(
    q: string,
    types: readonly ('airport' | 'city')[],
    limit: number,
  ): Promise<PlaceSuggestion[]> {
    const text = normalizeSearchText(q);
    if (text.length < 2) return [];
    const code = /^[a-z]{3}$/i.test(q.trim()) ? q.trim().toUpperCase() : '';

    const [airports, cities] = await Promise.all([
      types.includes('airport') ? this.findAirports(text, code, limit) : Promise.resolve([]),
      types.includes('city') ? this.findCities(text, limit) : Promise.resolve([]),
    ]);

    const ranked: { rank: number; item: PlaceSuggestion }[] = [
      ...airports.map((row) => ({
        rank: row.rank,
        item: {
          type: 'airport' as const,
          code: row.code,
          name: row.name,
          cityId: row.city_id,
          cityName: row.city_name,
          countryCode: row.country_code,
          countryName: row.country_name,
          timeZone: row.timezone,
        },
      })),
      ...cities.map((row) => ({
        rank: row.rank,
        item: {
          type: 'city' as const,
          id: row.id,
          name: row.name,
          countryCode: row.country_code,
          countryName: row.country_name,
          timeZone: row.timezone,
          airports: row.airports,
        },
      })),
    ];
    return ranked
      .sort((a, b) => b.rank - a.rank)
      .slice(0, limit)
      .map(({ item }) => item);
  }

  private findAirports(text: string, code: string, limit: number): Promise<AirportRow[]> {
    // Normalised text only contains [a-z0-9 ], so it is safe inside LIKE patterns.
    return this.prisma.$queryRaw<AirportRow[]>`
      SELECT a.iata_code AS code, a.name, a.city_id, ci.name AS city_name, a.country_code,
             co.name AS country_name, a.timezone,
             (GREATEST(similarity(a.search_text, ${text}), word_similarity(${text}, a.search_text)) * 20
               + similarity(a.search_text, ${text}) * 5
               + CASE WHEN a.iata_code = ${code} THEN 100 ELSE 0 END
               + CASE WHEN a.search_text LIKE ${`${text}%`} THEN 50
                      WHEN a.search_text LIKE ${`% ${text}%`} THEN 30 ELSE 0 END
               + CASE WHEN a.type = 'large_airport' THEN 5 ELSE 0 END
               + CASE WHEN a.country_code = 'NG' THEN 8 WHEN co.continent = 'AF' THEN 3 ELSE 0 END
             )::float8 AS rank
      FROM airports a
      JOIN countries co ON co.code = a.country_code
      LEFT JOIN cities ci ON ci.id = a.city_id
      WHERE a.iata_code = ${code}
         OR a.search_text LIKE ${`${text}%`}
         OR a.search_text LIKE ${`% ${text}%`}
         OR similarity(a.search_text, ${text}) > ${SIMILARITY_THRESHOLD}
         OR word_similarity(${text}, a.search_text) > ${WORD_SIMILARITY_THRESHOLD}
      ORDER BY rank DESC, a.iata_code
      LIMIT ${limit}`;
  }

  private findCities(text: string, limit: number): Promise<CityRow[]> {
    return this.prisma.$queryRaw<CityRow[]>`
      SELECT c.id, c.name, c.country_code, co.name AS country_name, c.timezone,
             (GREATEST(similarity(c.search_text, ${text}), word_similarity(${text}, c.search_text)) * 20
               + similarity(c.search_text, ${text}) * 5
               + CASE WHEN c.search_text LIKE ${`${text}%`} THEN 50
                      WHEN c.search_text LIKE ${`% ${text}%`} THEN 30 ELSE 0 END
               + CASE WHEN bool_or(a.type = 'large_airport') THEN 5 ELSE 0 END
               + LEAST(count(a.iata_code) - 1, 3) * 1.5
               + CASE WHEN c.country_code = 'NG' THEN 8 WHEN co.continent = 'AF' THEN 3 ELSE 0 END
               + 1
             )::float8 AS rank,
             json_agg(json_build_object('code', a.iata_code, 'name', a.name)
                      ORDER BY a.type, a.name) AS airports
      FROM cities c
      JOIN countries co ON co.code = c.country_code
      JOIN airports a ON a.city_id = c.id
      WHERE c.search_text LIKE ${`${text}%`}
         OR c.search_text LIKE ${`% ${text}%`}
         OR similarity(c.search_text, ${text}) > ${SIMILARITY_THRESHOLD}
         OR word_similarity(${text}, c.search_text) > ${WORD_SIMILARITY_THRESHOLD}
      GROUP BY c.id, co.name, co.continent
      ORDER BY rank DESC, c.name
      LIMIT ${limit}`;
  }

  /** Compact index for instant client-side suggestions; cached for the process lifetime. */
  async popularPlaces(): Promise<PopularPlaces> {
    if (this.popular) return this.popular;
    const rows = await this.prisma.airport.findMany({
      where: { OR: [{ type: 'large_airport' }, { countryCode: 'NG' }] },
      select: { iataCode: true, name: true, municipality: true, countryCode: true },
      orderBy: { iataCode: 'asc' },
    });
    const airports = rows.map(
      (row) =>
        [row.iataCode, row.name, row.municipality ?? '', row.countryCode] as [
          string,
          string,
          string,
          string,
        ],
    );
    const version = createHash('sha256')
      .update(JSON.stringify(airports))
      .digest('hex')
      .slice(0, 12);
    this.popular = { version, fields: ['code', 'name', 'city', 'countryCode'], airports };
    return this.popular;
  }

  async airport(code: string): Promise<AirportDetail | null> {
    const row = await this.prisma.airport.findUnique({
      where: { iataCode: code },
      include: { country: { select: { name: true } } },
    });
    if (!row) return null;
    return {
      code: row.iataCode,
      icaoCode: row.icaoCode,
      name: row.name,
      type: row.type,
      municipality: row.municipality,
      cityId: row.cityId,
      countryCode: row.countryCode,
      countryName: row.country.name,
      latitude: row.latitude,
      longitude: row.longitude,
      timeZone: row.timezone,
    };
  }

  async countries(): Promise<{ code: string; name: string; continent: string }[]> {
    return this.prisma.country.findMany({
      select: { code: true, name: true, continent: true },
      orderBy: { name: 'asc' },
    });
  }

  /** City with its country name, for labelling a city chosen in a shared search link. */
  async cityDetail(id: string): Promise<{
    id: string;
    name: string;
    countryCode: string;
    countryName: string;
    timeZone: string | null;
  } | null> {
    const row = await this.prisma.city.findUnique({ where: { id }, include: { country: true } });
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      countryCode: row.countryCode,
      countryName: row.country.name,
      timeZone: row.timezone,
    };
  }

  /** Airport facts for search (time zones, coordinates), cached in memory for an hour. */
  async airportInfo(codes: readonly string[]): Promise<Map<string, AirportInfo>> {
    const now = Date.now();
    const result = new Map<string, AirportInfo>();
    const missing: string[] = [];
    for (const code of new Set(codes)) {
      const cached = this.airportCache.get(code);
      if (cached && cached.expires > now) {
        if (cached.info) result.set(code, cached.info);
      } else {
        missing.push(code);
      }
    }
    if (missing.length > 0) {
      const rows = await this.prisma.airport.findMany({
        where: { iataCode: { in: missing } },
        include: { city: { select: { name: true } } },
      });
      const found = new Map(rows.map((row) => [row.iataCode, row]));
      for (const code of missing) {
        const row = found.get(code);
        const info: AirportInfo | null = row
          ? {
              code: row.iataCode,
              name: row.name,
              cityName: row.city?.name ?? row.municipality,
              countryCode: row.countryCode,
              latitude: row.latitude,
              longitude: row.longitude,
              timeZone: row.timezone,
            }
          : null;
        this.airportCache.set(code, { info, expires: now + AIRPORT_INFO_TTL_MS });
        if (info) result.set(code, info);
      }
    }
    return result;
  }

  /** City facts for hotel search. */
  async city(id: string): Promise<{
    id: string;
    name: string;
    countryCode: string;
    latitude: number | null;
    longitude: number | null;
    timeZone: string | null;
  } | null> {
    const row = await this.prisma.city.findUnique({ where: { id } });
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      countryCode: row.countryCode,
      latitude: row.latitude,
      longitude: row.longitude,
      timeZone: row.timezone,
    };
  }
}
