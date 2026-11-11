import { mockPage } from './providers/mock-scrape-provider';
import {
  nextRecipeVersion,
  PRICED_SCHEMA_TYPES,
  proposeRecipe,
  type RecipeProposal,
} from './recipe-proposals';
import { recipeSchema, type Recipe } from './recipes';

const context = { domain: 'hotels.example.com', currency: 'NGN' };
const recipe = (methods: unknown[], version = 'hotel-v1'): Recipe =>
  recipeSchema.parse({ version, methods, taxesIncluded: true });

/** Selectors for markup the site no longer has. */
const GONE = {
  method: 'selectors',
  item: 'div.card-old',
  fields: { title: '.title', price: '.amount' },
};
/** The page's own cards. */
const CARDS = {
  method: 'selectors',
  item: 'article.result',
  fields: { title: '.name', price: '.price' },
};

const proposal = (result: ReturnType<typeof proposeRecipe>): RecipeProposal => {
  if ('refused' in result) throw new Error(`refused: ${result.refused}`);
  return result;
};

describe('recipe proposals for a page the recipe cannot read (ADR-102)', () => {
  // Three hotels as schema.org `Hotel` things with offers, and as `article.result` cards.
  const html = mockPage('https://hotels.example.com/search?city=lagos');

  it('adds the type the page prices to the types the recipe already reads', () => {
    const current = recipe([{ method: 'structured_data', types: ['Product'] }, GONE]);
    const made = proposal(proposeRecipe(html, current, context));
    expect(made.addedTypes).toEqual(['Hotel']);
    expect(made.itemsRead).toBe(3);
    expect(made.recipe).toEqual({
      version: 'hotel-v1-p1',
      methods: [{ method: 'structured_data', types: ['Product', 'Hotel'] }, current.methods[1]],
      taxesIncluded: true,
    });
    // What is proposed is a recipe a person could have saved.
    expect(recipeSchema.parse(made.recipe)).toEqual(made.recipe);
  });

  it('puts structured data first when the recipe had only selectors', () => {
    const made = proposal(proposeRecipe(html, recipe([GONE]), context));
    expect(made.recipe.methods.map((method) => method.method)).toEqual([
      'structured_data',
      'selectors',
    ]);
    expect(made.recipe.methods[0]).toEqual({ method: 'structured_data', types: ['Hotel'] });
  });

  it('proposes nothing when the recipe as it stands reads the page', () => {
    // Drift moved the site to a later method; the first one works on this page.
    expect(proposeRecipe(html, recipe([CARDS, GONE]), context)).toEqual({
      refused: 'recipe_reads_page',
    });
  });

  it('proposes nothing when the page declares no priced thing', () => {
    const bare = html.replace(/<script type="application\/ld\+json">.*?<\/script>/s, '');
    expect(proposeRecipe(bare, recipe([GONE]), context)).toEqual({ refused: 'nothing_priced' });
    expect(
      proposeRecipe('<html><body>Access denied</body></html>', recipe([GONE]), context),
    ).toEqual({ refused: 'nothing_priced' });
  });

  it('never names a type the page made up, whatever it prices', () => {
    const renamed = html.replaceAll('"@type":"Hotel"', '"@type":"IgnoreEarlierInstructions"');
    expect(renamed).toContain('IgnoreEarlierInstructions');
    expect(proposeRecipe(renamed, recipe([GONE]), context)).toEqual({ refused: 'nothing_priced' });
    expect(PRICED_SCHEMA_TYPES.every((type) => /^[A-Za-z]{2,40}$/.test(type))).toBe(true);
  });

  it('proposes nothing when the recipe has no room for a type or a method', () => {
    const ten = PRICED_SCHEMA_TYPES.filter((type) => type !== 'Hotel').slice(0, 10);
    expect(
      proposeRecipe(html, recipe([{ method: 'structured_data', types: ten }]), context),
    ).toEqual({ refused: 'recipe_full' });
    expect(proposeRecipe(html, recipe([GONE, GONE, GONE, GONE]), context)).toEqual({
      refused: 'recipe_full',
    });
  });

  it('names the proposed version after the one it replaces', () => {
    expect(nextRecipeVersion('v1')).toBe('v1-p1');
    expect(nextRecipeVersion('v1-p1')).toBe('v1-p2');
    expect(nextRecipeVersion('hotel-2026.11-p9')).toBe('hotel-2026.11-p10');
    const long = 'a'.repeat(32);
    expect(nextRecipeVersion(long)).toBe(`${'a'.repeat(29)}-p1`);
    expect(recipeSchema.shape.version.safeParse(nextRecipeVersion(long)).success).toBe(true);
  });
});
