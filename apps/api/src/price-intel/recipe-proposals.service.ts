import { Injectable } from '@nestjs/common';

import type { PriceProduct } from '@suskii/shared';

import { ObjectStorage } from '../documents/object-storage';
import { PrismaService } from '../infra/prisma.service';

import { PriceSourcesService } from './price-sources.service';
import {
  proposeRecipe,
  RECIPE_PROPOSAL_REFUSALS,
  type RecipeProposal,
  type RecipeProposalRefusal,
} from './recipe-proposals';
import { recipesSchema } from './recipes';

/** Why there is nothing to propose from: besides what the rule itself refuses. */
export const SOURCE_RECIPE_REFUSALS = [
  'no_recipe',
  'no_kept_page',
  ...RECIPE_PROPOSAL_REFUSALS,
] as const;
export type SourceRecipeRefusal = (typeof SOURCE_RECIPE_REFUSALS)[number];

/** A site whose parser has drifted, and the products a page was kept for. */
export interface DriftingSite {
  sourceId: string;
  domain: string;
  since: string;
  parserVersion: string;
  /** Products of the site with a page nothing could be read from, kept for a week. */
  keptPages: PriceProduct[];
}

/** What a recipe proposal for a site holds: the kind's own form in the approvals queue. */
export interface SourceRecipeDraft extends RecipeProposal {
  sourceId: string;
  product: PriceProduct;
  /** The version the proposal replaces: it applies only while the site still has it. */
  replaces: string;
}

/**
 * Recipe proposals for sites in drift (ADR-102). When a recipe stops reading a site, the page
 * nothing could be read from is kept for a week; from it, and only from it, a rule works out
 * a recipe that does read it. This service fetches nothing, calls no vendor and no model, and
 * changes nothing: what it returns goes to the approvals queue for a person to decide.
 */
@Injectable()
export class RecipeProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sources: PriceSourcesService,
    private readonly storage: ObjectStorage,
  ) {}

  /** The sites with an open drift incident, longest open first. */
  async drifting(): Promise<DriftingSite[]> {
    const open = (await this.sources.list()).flatMap((source) =>
      source.drift ? [{ ...source.drift, sourceId: source.id, domain: source.domain }] : [],
    );
    if (open.length === 0) return [];
    const kept = await this.prisma.scrapeJob.findMany({
      where: {
        sourceId: { in: open.map((site) => site.sourceId) },
        attempts: { some: { snapshotKey: { not: null } } },
      },
      select: { sourceId: true, product: true },
      distinct: ['sourceId', 'product'],
    });
    return open
      .sort((a, b) => a.since.localeCompare(b.since))
      .map((site) => ({
        ...site,
        keptPages: kept
          .filter((job) => job.sourceId === site.sourceId)
          .map((job) => job.product as PriceProduct)
          .sort(),
      }));
  }

  /**
   * A recipe for one product of a site, from its most recent kept page. Throws
   * `NotFoundException` for a site that does not exist.
   */
  async draft(
    sourceId: string,
    product: PriceProduct,
  ): Promise<SourceRecipeDraft | { refused: SourceRecipeRefusal }> {
    const source = await this.sources.get(sourceId);
    const recipe = recipesSchema.catch({}).parse(source.recipes)[product];
    if (!recipe) return { refused: 'no_recipe' };
    const attempt = await this.prisma.scrapeAttempt.findFirst({
      where: { snapshotKey: { not: null }, job: { sourceId, product } },
      orderBy: { createdAt: 'desc' },
      select: { snapshotKey: true },
    });
    const page = attempt?.snapshotKey ? await this.storage.get(attempt.snapshotKey) : null;
    if (!page) return { refused: 'no_kept_page' };
    const result: RecipeProposal | { refused: RecipeProposalRefusal } = proposeRecipe(
      page.toString('utf8'),
      recipe,
      { domain: source.domain, currency: source.currency },
    );
    if ('refused' in result) return result;
    return { sourceId, product, replaces: recipe.version, ...result };
  }
}
