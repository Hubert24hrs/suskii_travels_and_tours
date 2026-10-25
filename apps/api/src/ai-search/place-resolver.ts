import { Injectable } from '@nestjs/common';

import type { NaturalSearchPlace } from '@suskii/shared';

import { CatalogService } from '../catalog/catalog.service';
import { normalizeSearchText } from '../catalog/search-text';

import type { ModelPlace } from './trip-query';

/**
 * The airport a city name stands for when the catalog lists several and the model gave no
 * usable code. The catalog has no passenger figures, so the busiest airport of the large
 * multi-airport cities travellers from the primary market fly to is named here.
 */
const MAIN_AIRPORTS: Record<string, string> = {
  london: 'LHR',
  'new york': 'JFK',
  paris: 'CDG',
  washington: 'IAD',
  chicago: 'ORD',
  houston: 'IAH',
  toronto: 'YYZ',
  milan: 'MXP',
  rome: 'FCO',
  istanbul: 'IST',
  moscow: 'SVO',
  tokyo: 'HND',
  shanghai: 'PVG',
  beijing: 'PEK',
  bangkok: 'BKK',
  'sao paulo': 'GRU',
  dubai: 'DXB',
  johannesburg: 'JNB',
};

/**
 * Turns the model's place into an airport from our catalog (ADR-061). A code counts only if it
 * is a real airport whose name or city matches what the model named; otherwise the name is
 * searched. The model never decides a code on its own.
 */
@Injectable()
export class PlaceResolver {
  constructor(private readonly catalog: CatalogService) {}

  async resolve(place: ModelPlace): Promise<NaturalSearchPlace | null> {
    const name = normalizeSearchText(place.name);
    if (name.length < 2) return null;
    const code = place.iata?.trim().toUpperCase() ?? '';
    if (/^[A-Z]{3}$/.test(code)) {
      const airport = await this.catalog.airport(code);
      if (airport && matches(name, airport.code, [airport.municipality ?? '', airport.name])) {
        return {
          code: airport.code,
          name: airport.name,
          city: airport.municipality ?? airport.name,
          countryCode: airport.countryCode,
        };
      }
    }
    return this.byName(place.name, name);
  }

  private async byName(text: string, name: string): Promise<NaturalSearchPlace | null> {
    const [best] = await this.catalog.suggest(text, ['city', 'airport'], 5);
    if (!best) return null;
    if (best.type === 'airport') {
      return {
        code: best.code,
        name: best.name,
        city: best.cityName ?? best.name,
        countryCode: best.countryCode,
      };
    }
    const main = MAIN_AIRPORTS[name];
    const airport = best.airports.find((candidate) => candidate.code === main) ?? best.airports[0];
    if (!airport) return null;
    return {
      code: airport.code,
      name: airport.name,
      city: best.name,
      countryCode: best.countryCode,
    };
  }
}

/**
 * True when the named place is the airport's code, or appears in (or contains) its city or name.
 * The code counts only as an exact match: "los angeles" contains "los" but is not Lagos.
 */
function matches(name: string, code: string, labels: readonly string[]): boolean {
  if (name === code.toLowerCase()) return true;
  return labels
    .map((label) => normalizeSearchText(label))
    .some((label) => label.length > 0 && (label.includes(name) || name.includes(label)));
}
