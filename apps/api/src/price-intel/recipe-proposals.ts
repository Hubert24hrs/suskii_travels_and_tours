import { extract, pricedByType } from './extraction';
import type { Recipe } from './recipes';
import { ScrapeError, type ScrapePage } from './scrape-provider';

/**
 * The schema.org types a proposal may name: things that carry an offer. The list is ours: a
 * page can call its data anything, and a name that is not here is never proposed, shown to
 * staff or put before a model.
 */
export const PRICED_SCHEMA_TYPES = [
  'Product',
  'ProductGroup',
  'Offer',
  'AggregateOffer',
  'Hotel',
  'LodgingBusiness',
  'Resort',
  'Hostel',
  'Motel',
  'BedAndBreakfast',
  'Apartment',
  'Accommodation',
  'HotelRoom',
  'Suite',
  'Flight',
  'Car',
  'Vehicle',
  'BusTrip',
  'TouristTrip',
  'Trip',
  'Event',
  'Service',
] as const;
export type PricedSchemaType = (typeof PRICED_SCHEMA_TYPES)[number];

/** A recipe's structured-data method lists ten types at most (`recipeSchema`). */
const MAX_TYPES = 10;
const MAX_METHODS = 4;
const VERSION_MAX = 32;

/**
 * Why nothing is proposed: the recipe as it stands reads the kept page (saving it closes the
 * incident); the page declares no priced thing of a known type (a person writes selectors);
 * or the recipe has no room for another type or method.
 */
export const RECIPE_PROPOSAL_REFUSALS = [
  'recipe_reads_page',
  'nothing_priced',
  'recipe_full',
] as const;
export type RecipeProposalRefusal = (typeof RECIPE_PROPOSAL_REFUSALS)[number];

export interface RecipeProposal {
  recipe: Recipe;
  /** The types the proposal adds. */
  addedTypes: PricedSchemaType[];
  /** Priced items the proposed recipe reads from the kept page. */
  itemsRead: number;
}

/** `hotel-v1` becomes `hotel-v1-p1`, then `-p2`: a proposal's version says it was one. */
export function nextRecipeVersion(version: string): string {
  const match = /^(.*)-p(\d{1,3})$/.exec(version);
  const suffix = `-p${String(match ? Number(match[2]) + 1 : 1)}`;
  return `${(match?.[1] ?? version).slice(0, VERSION_MAX - suffix.length)}${suffix}`;
}

const pageOf = (html: string): ScrapePage => ({
  html,
  items: null,
  httpStatus: null,
  rendered: false,
  costMicroUsd: null,
});

function itemsRead(
  html: string,
  recipe: Recipe,
  context: { domain: string; currency: string },
): number {
  try {
    return extract(pageOf(html), recipe, { ...context, vendor: 'mock' }).items.length;
  } catch (error) {
    if (error instanceof ScrapeError) return 0;
    throw error;
  }
}

/**
 * A recipe that reads a page the current one cannot (ADR-102), from what the page itself
 * declares as priced: schema.org data of a known type. It is a rule, not a guess: no model
 * reads the page, nothing in the page is run or followed, and what is counted is what
 * `extract` would store. The proposal changes nothing; a person approves it or does not.
 */
export function proposeRecipe(
  html: string,
  recipe: Recipe,
  context: { domain: string; currency: string },
): RecipeProposal | { refused: RecipeProposalRefusal } {
  if (itemsRead(html, recipe, context) > 0) return { refused: 'recipe_reads_page' };

  const at = recipe.methods.findIndex((method) => method.method === 'structured_data');
  const existing = recipe.methods[at];
  const listed = existing?.method === 'structured_data' ? existing.types : [];
  const known = new Set(listed.map((type) => type.toLowerCase()));
  const found = [
    ...pricedByType(
      html,
      PRICED_SCHEMA_TYPES.filter((type) => !known.has(type.toLowerCase())),
      context,
    ),
  ]
    // The type that prices most items first; the list's own order settles a tie.
    .sort((a, b) => b[1] - a[1])
    .map(([type]) => type);
  if (found.length === 0) return { refused: 'nothing_priced' };

  const addedTypes = found.slice(0, MAX_TYPES - listed.length);
  if (addedTypes.length === 0) return { refused: 'recipe_full' };
  if (at < 0 && recipe.methods.length >= MAX_METHODS) return { refused: 'recipe_full' };

  const structured = { method: 'structured_data' as const, types: [...listed, ...addedTypes] };
  const proposed: Recipe = {
    ...recipe,
    version: nextRecipeVersion(recipe.version),
    methods:
      at < 0
        ? [structured, ...recipe.methods]
        : recipe.methods.map((method, index) => (index === at ? structured : method)),
  };
  const read = itemsRead(html, proposed, context);
  // A type that priced something on its own prices it in the recipe too; if not, say nothing.
  return read > 0
    ? { recipe: proposed, addedTypes, itemsRead: read }
    : { refused: 'nothing_priced' };
}
