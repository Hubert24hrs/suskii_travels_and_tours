import { createHash, randomUUID } from 'node:crypto';

import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Redis } from 'ioredis';

import {
  citySlug,
  inNightWindow,
  judgeObservation,
  utcToLocal,
  type ObservationAvailability,
  type ObservationFlag,
  type PriceProduct,
  type ProxyClass,
  type ScrapeFailureClass,
  type ScrapeVendor,
} from '@suskii/shared';

import { priceIntelEnabled } from '../agent/agent-flags';
import { ProblemDetailsException } from '../common/problem-details';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { ObjectStorage } from '../documents/object-storage';
import type { Prisma, PriceObservation } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { REDIS } from '../infra/redis';
import { priceIntelJobs, priceIntelObservations } from '../telemetry/metrics';

import { extract, type ExtractedItem, type Extraction, type PublicItem } from './extraction';
import { PriceIntelAlerts } from './price-intel-alerts';
import { PriceIntelBudget } from './price-intel-budget';
import { PriceIntelDrift } from './price-intel-drift';
import type {
  PriceObservationDto,
  PriceQuery,
  PriceReadInput,
  PriceReadResult,
} from './price-intel.schemas';
import { PriceSourcesService, type SourceWithPolicy } from './price-sources.service';
import { ProviderRouter } from './provider-router';
import {
  DEFAULT_FRESHNESS_MINUTES,
  freshnessSchema,
  recipesSchema,
  urlTemplatesSchema,
  vendorSettingsSchema,
} from './recipes';
import { ScrapeError, ScrapeExhausted, type AttemptRecord } from './scrape-provider';
import { assertFetchable, FetchRefused } from './ssrf-guard';

export type ReadTrigger = 'agent' | 'schedule' | 'staff';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
/** Earlier prices of the same thing that the median is taken from. */
const HISTORY_DAYS = 30;
const HISTORY_PER_ITEM = 20;
/** A page kept for diagnosis is cut to this size. */
const SNAPSHOT_MAX_CHARS = 512 * 1024;
/** Questions one sweep re-reads per site, and in all. */
const SWEEP_PER_SOURCE = 10;
const SWEEP_TOTAL = 40;
/**
 * A sweep starts no read after this long, so with one read's own limit on top it answers the
 * worker inside its five minutes. What is left waits for the next sweep.
 */
const SWEEP_BUDGET_MS = 200_000;

/** Deletes a single-flight key only while it still holds our token. */
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

/** The order an answer is given in, the same whether it was read now or before. */
const cheapestFirst = (a: PriceObservation, b: PriceObservation): number =>
  a.amountMinor === b.amountMinor ? (a.id < b.id ? -1 : 1) : a.amountMinor < b.amountMinor ? -1 : 1;

/** The same question in the same words, whatever order its fields came in. */
export function canonicalKeyOf(product: PriceProduct, query: PriceQuery): string {
  const entries: [string, string | number][] = [];
  for (const [key, value] of Object.entries(query) as [string, string | number | undefined][]) {
    if (value === undefined) continue;
    entries.push([key, typeof value === 'string' ? value.trim().toLowerCase() : value]);
  }
  entries.sort(([a], [b]) => (a < b ? -1 : 1));
  return sha256(`${product}|${JSON.stringify(Object.fromEntries(entries))}`);
}

/** What makes two observations the same thing: its name and the facts that tell items apart. */
export function itemKeyOf(item: PublicItem): string {
  const parts = [
    item.title,
    item.brand,
    item.roomType,
    item.board,
    item.flightNumber,
    item.departure,
    item.cabin,
    item.vehicleClass,
    item.transmission,
  ].map((part) => (part === undefined ? '' : String(part).trim().toLowerCase()));
  return sha256(parts.join('|'));
}

/**
 * The page address of a question: each placeholder filled from a checked value and encoded. A
 * placeholder the question has no value for is an incomplete question, never an empty string.
 */
export function buildUrl(template: string, query: PriceQuery): string {
  const values: Record<string, string | number | undefined> = {
    origin: query.origin,
    destination: query.destination,
    place: query.place,
    placeSlug: query.place ? citySlug(query.place) : undefined,
    from: query.from,
    to: query.to,
    adults: query.adults,
    children: query.children,
    rooms: query.rooms,
  };
  return template.replace(/\{([a-zA-Z]+)\}/g, (_match, name: string) => {
    const value = values[name];
    if (value === undefined || value === '') {
      throw new ProblemDetailsException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'price-query-incomplete',
        'The question is missing something this site needs',
        `Missing: ${name}`,
      );
    }
    return encodeURIComponent(String(value));
  });
}

/**
 * Reads prices from the sites price intelligence may read (ADR-102). One read: the policy says
 * whether and by whom; observations still fresh answer at once; the same question asked twice at
 * once shares one read; the router fetches and fails over; the recipe reads prices out of the
 * page; each is judged against history and other sources and stored; and when nothing can be
 * read, older observations are returned marked stale, or nothing. Every outcome is a row in
 * `scrape_jobs` with its attempts. Nothing a page contains is run, followed or shown to a model.
 */
@Injectable()
export class PriceIntelService {
  private readonly logger = new Logger(PriceIntelService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: PriceSourcesService,
    private readonly router: ProviderRouter,
    private readonly drift: PriceIntelDrift,
    private readonly budget: PriceIntelBudget,
    private readonly alerts: PriceIntelAlerts,
    private readonly storage: ObjectStorage,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  enabled(): boolean {
    return priceIntelEnabled(this.config);
  }

  async read(
    sourceId: string,
    input: PriceReadInput,
    trigger: ReadTrigger,
    signal: AbortSignal = new AbortController().signal,
  ): Promise<PriceReadResult> {
    if (!this.enabled()) throw new NotFoundException();
    const source = await this.sources.get(sourceId);
    const { product, query } = input;
    const recipe = recipesSchema.catch({}).parse(source.recipes)[product];
    const template = urlTemplatesSchema.catch({}).parse(source.urlTemplates)[product];
    if (!source.products.includes(product) || !recipe || !template) {
      throw new ProblemDetailsException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'price-source-product',
        'This site is not read for that product',
      );
    }
    const canonicalKey = canonicalKeyOf(product, query);
    const now = new Date();
    const result = (
      state: PriceReadResult['state'],
      rows: PriceObservation[],
      extra: Partial<PriceReadResult> = {},
    ): PriceReadResult => {
      priceIntelJobs.add(1, { product, trigger, result: state });
      return {
        state,
        failure: null,
        reason: null,
        jobId: null,
        observations: rows.map((row) => this.present(row, source.domain, now)),
        ...extra,
      };
    };

    // A blocked or inactive site answers nothing, not even what it said before.
    const vendors = this.sources.readableVendors(source);
    if (vendors.length === 0) {
      const reason = !source.active
        ? 'inactive'
        : source.policy?.status === 'blocked'
          ? 'blocked'
          : 'no_vendor';
      const job = await this.prisma.scrapeJob.create({
        data: {
          sourceId,
          product,
          canonicalKey,
          query: query,
          trigger,
          status: 'denied',
          failureClass: 'policy_denied',
          finishedAt: now,
        },
      });
      return result('denied', [], { failure: 'policy_denied', reason, jobId: job.id });
    }

    const cached = await this.latest(sourceId, canonicalKey);
    if (cached.length > 0 && cached.every((row) => row.freshUntil > now)) {
      return result('fresh', cached);
    }

    // One read per question at a time, across replicas: the others wait for its answer.
    const flightKey = `pi:flight:${sourceId}:${canonicalKey}`;
    const token = randomUUID();
    const flightMs = this.config.PRICE_INTEL_JOB_TIMEOUT_MS + 10_000;
    if ((await this.redis.set(flightKey, token, 'PX', flightMs, 'NX')) !== 'OK') {
      await this.waitFor(flightKey, signal);
      const shared = await this.latest(sourceId, canonicalKey);
      if (shared.length === 0) {
        return result('exhausted', [], { failure: 'timeout', reason: 'shared_read' });
      }
      return result(shared.every((row) => row.freshUntil > new Date()) ? 'fresh' : 'stale', shared);
    }

    const job = await this.prisma.scrapeJob.create({
      data: { sourceId, product, canonicalKey, query: query, trigger },
    });
    let attempts: readonly AttemptRecord[] = [];
    try {
      let url: string;
      try {
        url = buildUrl(template, query);
        assertFetchable(url, source.domain);
      } catch (error) {
        await this.finish(job.id, 'denied', [], 'policy_denied', 0, null);
        if (error instanceof FetchRefused) {
          return result('denied', [], {
            failure: 'policy_denied',
            reason: `address_${error.code}`,
            jobId: job.id,
          });
        }
        throw error;
      }

      const policy = source.policy;
      if (!policy) throw new NotFoundException();
      const open = await this.drift.of(sourceId);
      const fromMethod = open && recipe.methods.length > 1 ? 1 : 0;
      let unread: string | null = null;
      try {
        const outcome = await this.router.read(
          {
            domain: source.domain,
            vendors,
            maxProxyClass: policy.maxProxyClass as ProxyClass,
            requestsPerMinute: policy.requestsPerMinute,
            maxConcurrency: policy.maxConcurrency,
          },
          {
            url,
            product,
            domain: source.domain,
            country: source.country,
            locale: source.locale,
            render: false,
            vendorSettings: vendorSettingsSchema.catch({}).parse(source.vendorSettings),
          },
          (page, vendor): { extraction: Extraction; hash: string } => {
            try {
              return {
                extraction: extract(page, recipe, {
                  domain: source.domain,
                  currency: source.currency,
                  vendor,
                  fromMethod,
                }),
                hash: sha256(page.html ?? JSON.stringify(page.items ?? [])),
              };
            } catch (error) {
              if (error instanceof ScrapeError && error.failure === 'parse_failed' && page.html) {
                unread = page.html.slice(0, SNAPSHOT_MAX_CHARS);
              }
              throw error;
            }
          },
          signal,
        );
        attempts = outcome.attempts;
        const freshness =
          freshnessSchema.catch({}).parse(policy.freshnessMinutes)[product] ??
          DEFAULT_FRESHNESS_MINUTES[product];
        const stored = await this.store(source, job.id, product, canonicalKey, {
          items: outcome.value.extraction.items,
          parserVersion: outcome.value.extraction.parserVersion,
          taxesIncluded: recipe.taxesIncluded,
          vendor: outcome.vendor,
          proxyClass: outcome.proxyClass,
          hash: outcome.value.hash,
          now,
          freshUntil: new Date(now.getTime() + freshness * MINUTE_MS),
        });
        await this.finish(job.id, 'succeeded', attempts, null, stored.length, null);
        await this.drift.note(sourceId, recipe.version, true, now);
        const shown = stored.filter((row) => row.status !== 'rejected');
        return result('read', shown, { jobId: job.id });
      } catch (error) {
        if (!(error instanceof ScrapeExhausted)) {
          await this.finish(job.id, 'failed', attempts, 'provider_error', 0, null);
          throw error;
        }
        attempts = error.attempts;
        const unparsed = attempts.some((attempt) => attempt.outcome === 'parse_failed');
        const snapshotKey = unparsed && unread ? await this.keepSnapshot(job.id, unread) : null;
        const denied = error.failure === 'policy_denied';
        await this.finish(
          job.id,
          denied ? 'denied' : 'exhausted',
          attempts,
          error.failure,
          0,
          snapshotKey,
        );
        if (unparsed && (await this.drift.note(sourceId, recipe.version, false, now))) {
          await this.alerts.drift(source, recipe.version);
        }
        // What was seen before is better than nothing, as long as it is said to be old.
        const stale = denied ? [] : await this.latest(sourceId, canonicalKey);
        return result(stale.length > 0 ? 'stale' : denied ? 'denied' : 'exhausted', stale, {
          failure: error.failure,
          reason: error.reason,
          jobId: job.id,
        });
      }
    } finally {
      await this.redis.eval(RELEASE, 1, flightKey, token).catch(() => undefined);
      await this.reportBudgets(attempts, source.domain);
    }
  }

  /** The latest observations a site gave for a question: one batch, rejected ones left out. */
  async latest(sourceId: string, canonicalKey: string): Promise<PriceObservation[]> {
    const rows = await this.prisma.priceObservation.findMany({
      where: { sourceId, canonicalKey, status: { not: 'rejected' } },
      orderBy: [{ observedAt: 'desc' }, { id: 'asc' }],
      take: 50,
    });
    const newest = rows[0]?.observedAt.getTime();
    return rows.filter((row) => row.observedAt.getTime() === newest).sort(cheapestFirst);
  }

  async observations(
    sourceId: string,
    filter: { product?: PriceProduct; limit: number },
  ): Promise<PriceObservationDto[]> {
    const source = await this.sources.get(sourceId);
    const rows = await this.prisma.priceObservation.findMany({
      where: { sourceId, ...(filter.product ? { product: filter.product } : {}) },
      orderBy: { id: 'desc' },
      take: filter.limit,
    });
    const now = new Date();
    return rows.map((row) => this.present(row, source.domain, now));
  }

  /**
   * Re-reads, inside each approved site's local night, the questions people asked of it lately
   * whose answers have gone stale, so the day's answers come from observations (ADR-102). The
   * worker calls it; it is bounded per site and in all, and a read that fails is only counted.
   */
  async sweep(now: Date = new Date()): Promise<{ sources: number; read: number; failed: number }> {
    if (!this.enabled()) return { sources: 0, read: 0, failed: 0 };
    const sources = await this.prisma.priceSource.findMany({
      where: { active: true, policy: { status: 'approved' } },
      include: { policy: true },
    });
    const today = now.toISOString().slice(0, 10);
    const started = Date.now();
    const spent = (): boolean =>
      read + failed >= SWEEP_TOTAL || Date.now() - started >= SWEEP_BUDGET_MS;
    let inWindow = 0;
    let read = 0;
    let failed = 0;
    for (const source of sources) {
      const policy = source.policy;
      if (!policy || spent()) break;
      const hour = Number(utcToLocal(now, policy.timeZone).slice(11, 13));
      if (!inNightWindow(hour, policy.nightStartHour, policy.nightEndHour)) continue;
      inWindow += 1;
      const recent = await this.prisma.scrapeJob.findMany({
        where: {
          sourceId: source.id,
          trigger: { in: ['agent', 'staff'] },
          startedAt: { gte: new Date(now.getTime() - 7 * DAY_MS) },
        },
        orderBy: { id: 'desc' },
        take: 200,
        select: { product: true, canonicalKey: true, query: true },
      });
      const seen = new Set<string>();
      for (const job of recent) {
        if (seen.size >= SWEEP_PER_SOURCE || spent()) break;
        if (seen.has(job.canonicalKey)) continue;
        const query = job.query as PriceQuery;
        // A question about a day that has passed is nobody's question any more.
        if (typeof query.from !== 'string' || query.from < today) continue;
        seen.add(job.canonicalKey);
        try {
          const outcome = await this.read(
            source.id,
            { product: job.product as PriceProduct, query },
            'schedule',
          );
          if (outcome.state === 'read') read += 1;
          else if (outcome.state !== 'fresh') failed += 1;
        } catch {
          failed += 1;
        }
      }
    }
    return { sources: inWindow, read, failed };
  }

  present(row: PriceObservation, domain: string, now: Date): PriceObservationDto {
    return {
      id: row.id,
      sourceId: row.sourceId,
      domain,
      product: row.product as PriceProduct,
      price: { amountMinor: Number(row.amountMinor), currency: row.currency },
      taxesIncluded: row.taxesIncluded,
      availability: row.availability as ObservationAvailability,
      item: row.item as PublicItem,
      confidence: row.confidence,
      status: row.status,
      flags: row.flags as ObservationFlag[],
      observedAt: row.observedAt.toISOString(),
      freshUntil: row.freshUntil.toISOString(),
      stale: row.freshUntil <= now,
      indicative: true,
    };
  }

  /** Judges each item against its history and other sites, and stores them as one batch. */
  private async store(
    source: SourceWithPolicy,
    jobId: string,
    product: PriceProduct,
    canonicalKey: string,
    batch: {
      items: ExtractedItem[];
      parserVersion: string;
      taxesIncluded: boolean | null;
      vendor: ScrapeVendor;
      proxyClass: ProxyClass;
      hash: string;
      now: Date;
      freshUntil: Date;
    },
  ): Promise<PriceObservation[]> {
    const keyed = batch.items.map((item) => ({ ...item, itemKey: itemKeyOf(item.item) }));
    const itemKeys = [...new Set(keyed.map((item) => item.itemKey))];
    const [history, elsewhere] = await Promise.all([
      this.prisma.priceObservation.findMany({
        where: {
          sourceId: source.id,
          product,
          itemKey: { in: itemKeys },
          status: { not: 'rejected' },
          observedAt: { gte: new Date(batch.now.getTime() - HISTORY_DAYS * DAY_MS) },
        },
        orderBy: { observedAt: 'desc' },
        take: itemKeys.length * HISTORY_PER_ITEM,
        select: { itemKey: true, amountMinor: true, currency: true },
      }),
      this.prisma.priceObservation.findMany({
        where: {
          sourceId: { not: source.id },
          product,
          itemKey: { in: itemKeys },
          status: { not: 'rejected' },
          freshUntil: { gt: batch.now },
        },
        orderBy: { observedAt: 'desc' },
        take: itemKeys.length * 3,
        select: { itemKey: true, amountMinor: true, currency: true },
      }),
    ]);

    const rows: Prisma.PriceObservationCreateManyInput[] = [];
    const taken = new Set<string>();
    for (const item of keyed) {
      // The same thing twice on one page is one observation: the first listed.
      if (taken.has(item.itemKey)) continue;
      taken.add(item.itemKey);
      const judged = judgeObservation({
        price: item.price,
        method: item.method,
        marketCurrency: source.currency,
        taxesIncluded: batch.taxesIncluded,
        history: history
          .filter((row) => row.itemKey === item.itemKey && row.currency === item.price.currency)
          .slice(0, HISTORY_PER_ITEM)
          .map((row) => row.amountMinor),
        otherSource:
          elsewhere.find(
            (row) => row.itemKey === item.itemKey && row.currency === item.price.currency,
          )?.amountMinor ?? null,
      });
      priceIntelObservations.add(1, { product, status: judged.status });
      rows.push({
        sourceId: source.id,
        jobId,
        product,
        canonicalKey,
        itemKey: item.itemKey,
        country: source.country,
        currency: item.price.currency,
        amountMinor: item.price.minor,
        taxesIncluded: batch.taxesIncluded,
        availability: item.availability,
        item: item.item,
        vendor: batch.vendor,
        proxyClass: batch.proxyClass,
        method: item.method,
        parserVersion: batch.parserVersion,
        confidence: judged.confidence,
        status: judged.status,
        flags: judged.flags,
        snapshotHash: batch.hash,
        observedAt: batch.now,
        freshUntil: batch.freshUntil,
      });
    }
    await this.prisma.priceObservation.createMany({ data: rows });
    return (await this.prisma.priceObservation.findMany({ where: { jobId } })).sort(cheapestFirst);
  }

  private async finish(
    jobId: string,
    status: 'succeeded' | 'exhausted' | 'denied' | 'failed',
    attempts: readonly AttemptRecord[],
    failure: ScrapeFailureClass | null,
    observationCount: number,
    snapshotKey: string | null,
  ): Promise<void> {
    // The page kept for diagnosis belongs to the last attempt that could not read it.
    const unread = attempts.map((attempt) => attempt.outcome).lastIndexOf('parse_failed');
    await this.prisma.$transaction([
      this.prisma.scrapeAttempt.createMany({
        data: attempts.map((attempt, index) => ({
          jobId,
          vendor: attempt.vendor,
          proxyClass: attempt.proxyClass,
          outcome: attempt.outcome,
          httpStatus: attempt.httpStatus,
          rendered: attempt.rendered,
          durationMs: attempt.durationMs,
          costMicroUsd: BigInt(attempt.costMicroUsd),
          snapshotKey: index === unread ? snapshotKey : null,
        })),
      }),
      this.prisma.scrapeJob.update({
        where: { id: jobId },
        data: {
          status,
          failureClass: failure,
          attemptCount: attempts.length,
          costMicroUsd: BigInt(attempts.reduce((sum, attempt) => sum + attempt.costMicroUsd, 0)),
          observationCount,
          finishedAt: new Date(),
        },
      }),
    ]);
  }

  /** Keeps a page nothing could be read from, for a week; a failure to keep it is only logged. */
  private async keepSnapshot(jobId: string, html: string): Promise<string | null> {
    const key = `price-intel/snapshots/${jobId}.html`;
    try {
      await this.storage.put(key, Buffer.from(html, 'utf8'), 'text/html; charset=utf-8');
      return key;
    } catch {
      this.logger.warn({ jobId }, 'page snapshot could not be kept');
      return null;
    }
  }

  private async reportBudgets(attempts: readonly AttemptRecord[], domain: string): Promise<void> {
    try {
      for (const vendor of new Set(attempts.map((attempt) => attempt.vendor))) {
        for (const alert of await this.budget.newAlerts(vendor, domain)) {
          await this.alerts.budget(alert);
        }
      }
    } catch {
      this.logger.warn('budget alerts could not be checked');
    }
  }

  /** Waits until another replica's read of the same question ends, or its lock runs out. */
  private async waitFor(flightKey: string, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + this.config.PRICE_INTEL_JOB_TIMEOUT_MS + 10_000;
    while (Date.now() < deadline && !signal.aborted) {
      if ((await this.redis.exists(flightKey)) === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}
