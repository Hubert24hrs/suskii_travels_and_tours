import { createHash } from 'node:crypto';

import { Logger } from '@nestjs/common';
import { z } from 'zod';

import { AffiliateLinker, type TrackedLink } from '../affiliate-linker';
import type { PartnerProgram } from '../partner-programs';

/** Travelpayouts allows 100 Partner Links calls a minute per marker; keep headroom. */
export const LINK_CALLS_PER_MINUTE = 90;
/** A tracked link for a partner page does not change; cache it and swap the sub id per click. */
const LINK_CACHE_SECONDS = 7 * 86_400;
const SUB_ID = 'sub_id';
/** Hosts Travelpayouts serves tracked links from (full links on tp.media, short ones on tp.st). */
const LINK_HOSTS = ['tp.media', 'tp.st'];

/** Shared state for the linker: the link cache and the per-minute call budget (Redis). */
export interface LinkStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  /** Counts one call in the current window; false when `limit` calls were already made. */
  take(key: string, limit: number, windowSeconds: number): Promise<boolean>;
}

export interface TravelpayoutsOptions {
  baseUrl: string;
  token: string;
  marker: string;
  trs?: string;
  timeoutMs: number;
  store: LinkStore;
  fetch?: typeof fetch;
}

// The Partner Links API answer, read tolerantly: the shape is to be confirmed on the first run
// with the account (ADR-070), so a missing or odd field falls back instead of failing.
const linkSchema = z.looseObject({
  partner_url: z.string().optional(),
  code: z.string().optional(),
});
const responseSchema = z.looseObject({
  result: z.looseObject({ links: z.array(linkSchema).optional() }).optional(),
  links: z.array(linkSchema).optional(),
});

const numeric = (value: string): string | number => (/^\d+$/.test(value) ? Number(value) : value);

function trackingHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return LINK_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Travelpayouts Partner Links API (`POST /links/v1/create`): one account for many brands. Full
 * (unshortened) links carry `sub_id` as a query parameter, so a link made once per partner page
 * is cached and each click gets its own sub id; the API is called again only for new pages.
 */
export class TravelpayoutsLinker extends AffiliateLinker {
  readonly network = 'travelpayouts' as const;
  private readonly logger = new Logger(TravelpayoutsLinker.name);
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: TravelpayoutsOptions) {
    super();
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async link(program: PartnerProgram, destination: string, clickId: string): Promise<TrackedLink> {
    const key = `partners:tp:link:${createHash('sha256').update(destination).digest('hex')}`;
    try {
      const cached = await this.options.store.get(key);
      if (cached) return { url: withSubId(cached, clickId), tracked: true };
      const minute = Math.floor(Date.now() / 60_000);
      if (
        !(await this.options.store.take(`partners:tp:budget:${minute}`, LINK_CALLS_PER_MINUTE, 120))
      ) {
        this.logger.warn(
          { program: program.id },
          'Travelpayouts link budget spent; untracked link',
        );
        return { url: destination, tracked: false };
      }
      const partnerUrl = await this.create(destination, clickId);
      if (!partnerUrl) return { url: destination, tracked: false };
      const parsed = new URL(partnerUrl);
      // A full link names the sub id as a parameter: cacheable. A short one is per click.
      if (parsed.searchParams.has(SUB_ID)) {
        await this.options.store.set(key, partnerUrl, LINK_CACHE_SECONDS);
      }
      return { url: partnerUrl, tracked: true };
    } catch (error) {
      this.logger.warn(
        { program: program.id, err: (error as Error).name },
        'Travelpayouts link failed; untracked link',
      );
      return { url: destination, tracked: false };
    }
  }

  private async create(destination: string, clickId: string): Promise<string | null> {
    const { baseUrl, token, marker, trs, timeoutMs } = this.options;
    const response = await this.fetchImpl(`${baseUrl}/links/v1/create`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'X-Access-Token': token,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        marker: numeric(marker),
        ...(trs ? { trs: numeric(trs) } : {}),
        shorten: false,
        links: [{ url: destination, sub_id: clickId }],
      }),
    });
    if (!response.ok) {
      this.logger.warn({ status: response.status }, 'Travelpayouts refused the link request');
      return null;
    }
    const parsed = responseSchema.safeParse(await response.json());
    if (!parsed.success) return null;
    const first = (parsed.data.result?.links ?? parsed.data.links ?? [])[0];
    const candidate = first?.partner_url;
    if (!candidate) return null;
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return null;
    }
    // Only follow links on Travelpayouts' own hosts: anything else is not a tracked link.
    if (url.protocol !== 'https:' || !trackingHost(url)) {
      this.logger.warn({ host: url.hostname }, 'Travelpayouts returned an unexpected link host');
      return null;
    }
    return url.toString();
  }
}

function withSubId(link: string, clickId: string): string {
  const url = new URL(link);
  url.searchParams.set(SUB_ID, clickId);
  return url.toString();
}
