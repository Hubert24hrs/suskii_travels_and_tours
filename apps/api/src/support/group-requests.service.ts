import { Injectable } from '@nestjs/common';
import type { z } from 'zod';

import { localDate, MAX_ADVANCE_DAYS, addDays, type GroupRequestInput } from '@suskii/shared';

import { CatalogService } from '../catalog/catalog.service';
import { invalidSearch } from '../search/search.errors';

import type { startedSupportSchema } from './support.schemas';
import { SupportService, type SupportCaller } from './support.service';

const CABINS: Readonly<Record<GroupRequestInput['cabinClass'], string>> = {
  economy: 'Economy',
  premium_economy: 'Premium economy',
  business: 'Business',
  first: 'First',
};

/**
 * Group flight requests (ten travellers or more): the airline's group desk prices them, so a
 * request becomes a support conversation the team answers (ADR-083), never a search or a
 * booking. The first message states the request in a fixed layout for staff; the traveller's
 * own words follow under "Notes".
 */
@Injectable()
export class GroupRequestsService {
  constructor(
    private readonly support: SupportService,
    private readonly catalog: CatalogService,
  ) {}

  async create(
    input: GroupRequestInput & { turnstileToken: string | null },
    caller: SupportCaller,
  ): Promise<z.infer<typeof startedSupportSchema>> {
    const airports = await this.catalog.airportInfo([input.origin, input.destination]);
    const issues: { location: 'body'; path: string; code: string; message: string }[] = [];
    for (const field of ['origin', 'destination'] as const) {
      if (!airports.has(input[field]))
        issues.push({
          location: 'body',
          path: field,
          code: 'unknown_airport',
          message: 'Unknown airport code',
        });
    }
    const origin = airports.get(input.origin);
    const now = new Date();
    if (origin && input.departureDate < localDate(now, origin.timeZone))
      issues.push({
        location: 'body',
        path: 'departureDate',
        code: 'date_in_past',
        message: 'date_in_past',
      });
    const last = input.returnDate ?? input.departureDate;
    if (last > addDays(now.toISOString().slice(0, 10), MAX_ADVANCE_DAYS))
      issues.push({
        location: 'body',
        path: input.returnDate ? 'returnDate' : 'departureDate',
        code: 'date_too_far',
        message: 'date_too_far',
      });
    if (issues.length > 0) throw invalidSearch(issues);

    const place = (code: string): string => {
      const airport = airports.get(code);
      return airport?.cityName ? `${airport.cityName} (${code})` : code;
    };
    const lines = [
      'Group booking request',
      `Route: ${place(input.origin)} to ${place(input.destination)}`,
      `Trip: ${input.tripType === 'round_trip' ? 'Return' : 'One way'}`,
      `Departure: ${input.departureDate}`,
      ...(input.returnDate ? [`Return: ${input.returnDate}`] : []),
      `Travellers: ${input.travellers}`,
      `Cabin: ${CABINS[input.cabinClass]}`,
      ...(input.organisation ? [`Organisation: ${input.organisation}`] : []),
      ...(input.notes ? [`Notes: ${input.notes}`] : []),
    ];
    return this.support.start(
      {
        category: 'pre_booking',
        message: lines.join('\n'),
        bookingId: null,
        email: input.email ?? null,
        turnstileToken: input.turnstileToken,
      },
      caller,
      'group_booking',
    );
  }
}
