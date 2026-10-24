import * as adminContent from '../admin/admin-content.schemas';
import * as adminDeals from '../admin/admin-deals.schemas';
import * as adminPricing from '../admin/admin-pricing.schemas';
import * as adminPromos from '../admin/admin-promos.schemas';
import * as buses from '../buses/buses.schemas';
import * as inhouse from '../inhouse/inhouse.schemas';
import * as prime from '../prime/prime.schemas';
import * as rentals from '../rentals/rentals.schemas';
import * as rides from '../rides/rides.schemas';

/**
 * A partial update built with `.partial()` keeps the defaults of the schema it came from, so an
 * empty patch would quietly reset those fields (`active: true`, rates to null). Every update and
 * patch body must parse `{}` to `{}`: what a request leaves out stays as it is.
 */
describe('update and patch bodies', () => {
  const modules = {
    adminContent,
    adminDeals,
    adminPricing,
    adminPromos,
    buses,
    inhouse,
    prime,
    rentals,
    rides,
  };
  const schemas = Object.entries(modules).flatMap(([module, exports]) =>
    Object.entries(exports)
      .filter(
        ([name, value]) =>
          /(patch|update)/i.test(name) &&
          typeof (value as { safeParse?: unknown }).safeParse === 'function',
      )
      .map(
        ([name, value]) =>
          [
            `${module}.${name}`,
            value as { safeParse: (input: unknown) => { success: boolean; data?: unknown } },
          ] as const,
      ),
  );

  it('finds the update schemas', () => {
    expect(schemas.length).toBeGreaterThan(10);
  });

  it.each(schemas)('%s fills in nothing for an empty body', (_name, schema) => {
    const result = schema.safeParse({});
    if (result.success) expect(result.data).toEqual({});
  });
});
