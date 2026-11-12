import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { APP_CONFIG, type AppConfig } from '../config/config';

export type ClientCountryRequest = Request & { clientCountry?: string };

/** Codes edges use for "unknown" and "Tor": not a country. */
const NOT_A_COUNTRY = new Set(['XX', 'T1']);

/**
 * Reads the client's country from the header the edge sets (CLIENT_COUNTRY_HEADER, e.g.
 * `cf-ipcountry`), for payment risk signals (ADR-040). Without the setting nothing is read: a
 * header the edge does not overwrite is whatever the client chose.
 */
@Injectable()
export class ClientCountryMiddleware implements NestMiddleware {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  use(request: ClientCountryRequest, _response: Response, next: NextFunction): void {
    const name = this.config.CLIENT_COUNTRY_HEADER;
    const value = name ? request.headers[name] : undefined;
    const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
    if (/^[A-Z]{2}$/.test(code) && !NOT_A_COUNTRY.has(code)) request.clientCountry = code;
    next();
  }
}
