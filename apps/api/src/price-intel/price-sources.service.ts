import { HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';

import {
  basisIssue,
  normaliseDomain,
  type AutomatedAccessFinding,
  type PriceProduct,
  type ProxyClass,
  type ScrapeVendor,
  type SourcePolicyBasis,
} from '@suskii/shared';

import { checkMerged, conflict, fieldChanges, type StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import { ProblemDetailsException } from '../common/problem-details';
import { uuidv7 } from '../common/uuid';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { Prisma, PriceSource, SourcePolicy } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';

import { looksPersonal } from './extraction';
import { PriceIntelDrift, type DriftState } from './price-intel-drift';
import { PriceIntelSwitches } from './price-intel-switches';
import {
  priceSourceInputSchema,
  type PriceSourceDto,
  type PriceSourceInput,
  type PriceSourcePatch,
  type SourceApproval,
} from './price-intel.schemas';
import {
  freshnessSchema,
  recipesSchema,
  urlTemplatesSchema,
  vendorSettingsSchema,
} from './recipes';
import { SCRAPE_PROVIDERS, type ScrapeProviders } from './scrape-providers';
import { assertFetchable } from './ssrf-guard';

export type SourceWithPolicy = PriceSource & { policy: SourcePolicy | null };

/** A setting whose name says it holds a credential: keys live in the environment, never here. */
const SECRET_NAME = /key|token|secret|password|credential|authorization/i;
/** Changing one of these on an approved site changes what its approver agreed to. */
const APPROVED_FIELDS = [
  'vendors',
  'maxProxyClass',
  'robots',
  'terms',
  'urlTemplates',
  'requestsPerMinute',
  'maxConcurrency',
] as const;

/**
 * A whole site as it will be stored, checked across its fields: every product has a page
 * address and a recipe, every address is on the site's own domain, every vendor that needs
 * settings has them, and no setting is named like a credential.
 */
const storedSource = priceSourceInputSchema.superRefine((source, context) => {
  const issue = (path: (string | number)[], message: string): void => {
    context.addIssue({ code: 'custom', path, message });
  };
  const domain = normaliseDomain(source.domain);
  if (domain === null) {
    issue(['domain'], 'not a domain name');
    return;
  }
  for (const product of source.products) {
    const template = source.urlTemplates[product];
    if (!template) issue(['urlTemplates', product], 'a product needs a page address');
    else {
      try {
        assertFetchable(template.replace(/\{[a-zA-Z]+\}/g, 'x'), domain);
      } catch {
        issue(['urlTemplates', product], "must be an https address on the site's own domain");
      }
    }
    if (!source.recipes[product]) issue(['recipes', product], 'a product needs a recipe');
  }
  const settings = source.vendorSettings;
  if (source.vendors.includes('apify')) {
    const apify = settings.apify ?? {};
    if (typeof apify.actorId !== 'string' || typeof apify.input !== 'object' || !apify.input) {
      issue(['vendorSettings', 'apify'], 'needs actorId and input');
    }
  }
  if (source.vendors.includes('browse_ai')) {
    const browse = settings.browse_ai ?? {};
    if (
      typeof browse.robotId !== 'string' ||
      typeof browse.inputParameters !== 'object' ||
      !browse.inputParameters
    ) {
      issue(['vendorSettings', 'browse_ai'], 'needs robotId and inputParameters');
    }
  }
  for (const [vendor, values] of Object.entries(settings)) {
    for (const name of Object.keys(values ?? {})) {
      if (SECRET_NAME.test(name)) {
        issue(['vendorSettings', vendor, name], 'credentials belong in the environment, not here');
      }
    }
  }
  if (new Set(source.vendors).size !== source.vendors.length) {
    issue(['vendors'], 'a vendor is listed twice');
  }
});

/**
 * The sites price intelligence may read and the rules for each (ADR-102). A new site is in
 * `review` and reads nothing real; approving it is a staff action with a recorded basis, which
 * must be a licence or a permission when the site's robots file or terms disallow automated
 * access; changing what the approver agreed to sends an approved site back to review.
 */
@Injectable()
export class PriceSourcesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly switches: PriceIntelSwitches,
    private readonly drift: PriceIntelDrift,
    @Inject(SCRAPE_PROVIDERS) private readonly providers: ScrapeProviders,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(): Promise<PriceSourceDto[]> {
    const rows = await this.prisma.priceSource.findMany({
      include: { policy: true },
      orderBy: { domain: 'asc' },
    });
    return Promise.all(rows.map((row) => this.present(row)));
  }

  async get(sourceId: string): Promise<SourceWithPolicy> {
    const row = await this.prisma.priceSource.findUnique({
      where: { id: sourceId },
      include: { policy: true },
    });
    if (!row?.policy) throw new NotFoundException();
    return row;
  }

  async create(input: PriceSourceInput, staff: StaffActor): Promise<PriceSourceDto> {
    const source = checkMerged(storedSource, input);
    const domain = normaliseDomain(source.domain) ?? '';
    const id = uuidv7();
    const row = await this.prisma.$transaction(async (tx) => {
      if (await tx.priceSource.findUnique({ where: { domain } })) {
        throw conflict('price-source-exists', 'That site is already listed');
      }
      const created = await tx.priceSource.create({
        data: {
          id,
          domain,
          ...this.sourceData(source),
          policy: { create: this.policyData(source) },
        },
        include: { policy: true },
      });
      await this.audit.record(
        {
          action: 'price_intel.source_created',
          actorUserId: staff.userId,
          targetType: 'price_source',
          targetId: id,
          metadata: { domain, products: source.products, vendors: source.vendors },
          context: staff.context,
        },
        tx,
      );
      return created;
    });
    return this.present(row);
  }

  async update(
    sourceId: string,
    patch: PriceSourcePatch,
    staff: StaffActor,
  ): Promise<PriceSourceDto> {
    const before = await this.get(sourceId);
    const current = this.asInput(before);
    const merged = checkMerged(storedSource, { ...current, ...patch });
    const touchesApproval = APPROVED_FIELDS.some(
      (field) => JSON.stringify(current[field]) !== JSON.stringify(merged[field]),
    );
    const backToReview = before.policy?.status === 'approved' && touchesApproval;
    const recipesChanged = JSON.stringify(current.recipes) !== JSON.stringify(merged.recipes);
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.priceSource.update({
        where: { id: sourceId },
        data: {
          ...this.sourceData(merged),
          policy: {
            update: {
              ...this.policyData(merged),
              ...(backToReview
                ? { status: 'review', basis: null, basisReference: null, decidedAt: null }
                : {}),
            },
          },
        },
        include: { policy: true },
      });
      await this.audit.record(
        {
          action: 'price_intel.source_updated',
          actorUserId: staff.userId,
          targetType: 'price_source',
          targetId: sourceId,
          metadata: {
            domain: before.domain,
            backToReview,
            changes: fieldChanges(
              this.auditView(current),
              this.auditView(merged),
              // Recipes, addresses and vendor settings are long: recorded as changed, not copied.
              ['urlTemplates', 'recipes', 'vendorSettings', 'freshnessMinutes'],
            ),
          },
          context: staff.context,
        },
        tx,
      );
      return updated;
    });
    // A person changed the recipe: the drift incident is theirs to have closed.
    if (recipesChanged) {
      await this.drift.clear(
        sourceId,
        Object.values(current.recipes).map((recipe) => recipe.version),
      );
    }
    return this.present(row);
  }

  async approve(
    sourceId: string,
    approval: SourceApproval,
    staff: StaffActor,
  ): Promise<PriceSourceDto> {
    const source = await this.get(sourceId);
    const policy = source.policy;
    if (!policy) throw new NotFoundException();
    // A site is blocked for a reason: it asked, or counsel withdrew the basis. It comes back
    // in two steps, each audited as someone's: back to review, then an approval on a new basis.
    if (policy.status === 'blocked') {
      throw conflict('price-source-blocked', 'Send the site back to review first');
    }
    if (looksPersonal(approval.basisReference)) {
      throw new ProblemDetailsException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'price-source-reference-personal',
        'Name the document, not a person',
        'A basis reference is a contract number or a document title; it must not hold contact details.',
      );
    }
    const issue = basisIssue({
      basis: approval.basis,
      robots: policy.robots as AutomatedAccessFinding,
      terms: policy.terms as AutomatedAccessFinding,
    });
    if (issue === 'findings_unknown') {
      throw new ProblemDetailsException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'price-source-findings-unknown',
        "Read the site's robots file and terms first",
        'Record what each says about automated access before approving the site.',
      );
    }
    if (issue === 'needs_licence_or_permission') {
      throw new ProblemDetailsException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'price-source-needs-permission',
        "The site disallows automated access: it needs the site's own licence or permission",
        'An assessment or a note cannot overrule what the site says.',
      );
    }
    const row = await this.decide(source, 'approved', staff, 'price_intel.source_approved', {
      basis: approval.basis,
      basisReference: approval.basisReference,
    });
    return this.present(row);
  }

  async block(sourceId: string, staff: StaffActor): Promise<PriceSourceDto> {
    const source = await this.get(sourceId);
    return this.present(
      await this.decide(source, 'blocked', staff, 'price_intel.source_blocked', {
        basis: null,
        basisReference: null,
      }),
    );
  }

  /** Back to review, from approved or blocked: nothing real is read until it is approved again. */
  async review(sourceId: string, staff: StaffActor): Promise<PriceSourceDto> {
    const source = await this.get(sourceId);
    return this.present(
      await this.decide(source, 'review', staff, 'price_intel.source_reviewed', {
        basis: null,
        basisReference: null,
      }),
    );
  }

  /**
   * The vendors that may read a site right now: an approved site's own chain; for a site in
   * review only the mock, which fetches nothing; none for a blocked or inactive one. The mock
   * is refused in production, so there only approved sites are read at all.
   */
  readableVendors(source: SourceWithPolicy): ScrapeVendor[] {
    const policy = source.policy;
    if (!source.active || !policy || policy.status === 'blocked') return [];
    const chain = (policy.vendors as ScrapeVendor[]).filter((vendor) => this.providers.has(vendor));
    if (policy.status === 'approved') {
      // In production a mock in an approved chain still reads nothing real: leave it out.
      return this.config.NODE_ENV === 'production' && !this.config.ALLOW_MOCK_PROVIDERS
        ? chain.filter((vendor) => vendor !== 'mock')
        : chain;
    }
    return this.providers.has('mock') ? ['mock'] : [];
  }

  async present(row: SourceWithPolicy, drift?: DriftState | null): Promise<PriceSourceDto> {
    const policy = row.policy;
    if (!policy) throw new NotFoundException();
    const open = drift === undefined ? await this.drift.of(row.id) : drift;
    const readable: PriceSourceDto['readable'] = !row.active
      ? 'inactive'
      : policy.status === 'blocked'
        ? 'blocked'
        : (await this.switches.stopped(null, row.domain))
          ? 'switched_off'
          : policy.status === 'approved'
            ? 'yes'
            : 'review_mock_only';
    return {
      id: row.id,
      domain: row.domain,
      name: row.name,
      products: row.products as PriceProduct[],
      country: row.country,
      currency: row.currency,
      locale: row.locale,
      urlTemplates: urlTemplatesSchema.catch({}).parse(row.urlTemplates),
      recipes: recipesSchema.catch({}).parse(row.recipes),
      vendorSettings: vendorSettingsSchema.catch({}).parse(row.vendorSettings),
      active: row.active,
      status: policy.status,
      basis: policy.basis as SourcePolicyBasis | null,
      basisReference: policy.basisReference,
      robots: policy.robots as AutomatedAccessFinding,
      terms: policy.terms as AutomatedAccessFinding,
      vendors: policy.vendors as ScrapeVendor[],
      maxProxyClass: policy.maxProxyClass as ProxyClass,
      requestsPerMinute: policy.requestsPerMinute,
      maxConcurrency: policy.maxConcurrency,
      nightStartHour: policy.nightStartHour,
      nightEndHour: policy.nightEndHour,
      timeZone: policy.timeZone,
      freshnessMinutes: freshnessSchema.catch({}).parse(policy.freshnessMinutes),
      decidedAt: policy.decidedAt?.toISOString() ?? null,
      drift: open,
      readable,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async decide(
    source: SourceWithPolicy,
    status: 'review' | 'approved' | 'blocked',
    staff: StaffActor,
    action:
      'price_intel.source_approved' | 'price_intel.source_blocked' | 'price_intel.source_reviewed',
    basis: { basis: SourcePolicyBasis | null; basisReference: string | null },
  ): Promise<SourceWithPolicy> {
    const policy = source.policy;
    if (!policy) throw new NotFoundException();
    return this.prisma.$transaction(async (tx) => {
      // A conditional update claims the decision: two people deciding at once cannot both win.
      const claimed = await tx.sourcePolicy.updateMany({
        where: { sourceId: source.id, status: { not: status }, updatedAt: policy.updatedAt },
        data: { status, ...basis, decidedAt: status === 'review' ? null : new Date() },
      });
      if (claimed.count === 0) {
        throw conflict('price-source-status', 'The site already has that status, or just changed');
      }
      await this.audit.record(
        {
          action,
          actorUserId: staff.userId,
          targetType: 'price_source',
          targetId: source.id,
          metadata: {
            domain: source.domain,
            from: policy.status,
            to: status,
            ...(status === 'approved'
              ? {
                  basis: basis.basis,
                  basisReference: basis.basisReference,
                  robots: policy.robots,
                  terms: policy.terms,
                  vendors: policy.vendors,
                  maxProxyClass: policy.maxProxyClass,
                }
              : {}),
          },
          context: staff.context,
        },
        tx,
      );
      return tx.priceSource.findUniqueOrThrow({
        where: { id: source.id },
        include: { policy: true },
      });
    });
  }

  private asInput(row: SourceWithPolicy): PriceSourceInput {
    const policy = row.policy;
    if (!policy) throw new NotFoundException();
    return z.parse(priceSourceInputSchema, {
      domain: row.domain,
      name: row.name,
      products: row.products,
      country: row.country,
      currency: row.currency,
      locale: row.locale,
      urlTemplates: row.urlTemplates,
      recipes: row.recipes,
      vendorSettings: row.vendorSettings,
      robots: policy.robots,
      terms: policy.terms,
      vendors: policy.vendors,
      maxProxyClass: policy.maxProxyClass,
      requestsPerMinute: policy.requestsPerMinute,
      maxConcurrency: policy.maxConcurrency,
      nightStartHour: policy.nightStartHour,
      nightEndHour: policy.nightEndHour,
      timeZone: policy.timeZone,
      freshnessMinutes: policy.freshnessMinutes,
      active: row.active,
    });
  }

  private sourceData(source: PriceSourceInput) {
    return {
      name: source.name,
      products: source.products,
      country: source.country,
      currency: source.currency,
      locale: source.locale,
      urlTemplates: source.urlTemplates as Prisma.InputJsonObject,
      recipes: source.recipes as Prisma.InputJsonObject,
      vendorSettings: source.vendorSettings as Prisma.InputJsonObject,
      active: source.active,
    };
  }

  private policyData(source: PriceSourceInput) {
    return {
      robots: source.robots,
      terms: source.terms,
      vendors: source.vendors,
      maxProxyClass: source.maxProxyClass,
      requestsPerMinute: source.requestsPerMinute,
      maxConcurrency: source.maxConcurrency,
      nightStartHour: source.nightStartHour,
      nightEndHour: source.nightEndHour,
      timeZone: source.timeZone,
      freshnessMinutes: source.freshnessMinutes as Prisma.InputJsonObject,
    };
  }

  /** The fields of a site as the audit log may hold them: names and codes, long values as text. */
  private auditView(
    source: PriceSourceInput,
  ): Record<string, string | number | boolean | null | readonly string[]> {
    return {
      name: source.name,
      products: source.products,
      country: source.country,
      currency: source.currency,
      locale: source.locale,
      robots: source.robots,
      terms: source.terms,
      vendors: source.vendors,
      maxProxyClass: source.maxProxyClass,
      requestsPerMinute: source.requestsPerMinute,
      maxConcurrency: source.maxConcurrency,
      nightStartHour: source.nightStartHour,
      nightEndHour: source.nightEndHour,
      timeZone: source.timeZone,
      active: source.active,
      urlTemplates: JSON.stringify(source.urlTemplates),
      recipes: JSON.stringify(source.recipes),
      vendorSettings: JSON.stringify(source.vendorSettings),
      freshnessMinutes: JSON.stringify(source.freshnessMinutes),
    };
  }
}
