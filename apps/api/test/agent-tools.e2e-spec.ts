import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { BOOKING_TERMS_VERSION, STAFF_AGENTS, type AgentScope } from '@suskii/shared';

import { AgentGrants, type AgentGrant } from '../src/agent/agent-grants';
import { AssistedQuotesService } from '../src/assisted-quotes/assisted-quotes.service';
import { PriceSourcesService } from '../src/price-intel/price-sources.service';
import { MockScrapeProvider } from '../src/price-intel/providers/mock-scrape-provider';
import { PricingService } from '../src/pricing/pricing.service';

import { busInventory, CONTACT, inDays, nextKey, passenger, staffSession } from './helpers/cars';
import { bearer, signUp, type TokenSession } from './helpers/flows';
import { localIn, rentalVehicle } from './helpers/rentals';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * The tools the customer agents call (ADR-101, ADR-107), through the gateway as the agent
 * service calls them: each runs for the grant's caller with that person's prices and that
 * person's records only, says why nothing came back in a code, builds its cards with links
 * inside the site, and gives a model no name, contact detail, reference, code or payment link.
 */
const TOOLS_TOKEN = 'e2e-agent-tools-token-0123456789abcdefghijk';
const RUN_TOKEN = 'e2e-agent-run-token-0123456789abcdefghijklm';

interface Wire {
  amountMinor: number;
  currency: string;
}
interface Card {
  kind: string;
  title: string;
  lines: string[];
  price?: Wire;
  href?: string;
  ref?: { type: string; id: string };
}
interface Answer<T = Record<string, unknown>> {
  status: 'ok' | 'denied' | 'error' | 'timeout';
  reason: string | null;
  result: (T & { cards?: Card[]; problems?: string[] }) | null;
}

const GUEST_SCOPES: AgentScope[] = ['catalog', 'search', 'quotes', 'support'];
const ngn = (naira: number): Wire => ({ amountMinor: naira * 100, currency: 'NGN' });
const POLICY = [
  { daysBefore: 2, refundBps: 9_000 },
  { daysBefore: 0, refundBps: 0 },
];

describe('customer agent tools (e2e)', () => {
  let ctx: TestContext;
  let grants: AgentGrants;
  let ada: TokenSession;
  let bola: TokenSession;
  let staff: Record<string, string>;

  beforeAll(async () => {
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      AGENT_ENABLED: true,
      AGENT_SERVICE: 'mock',
      AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
      AGENT_RUN_TOKEN: RUN_TOKEN,
      AGENT_RUN_MAX_TOOL_CALLS: 40,
    });
    grants = ctx.app.get(AgentGrants);
  });
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    ctx.app.get(PricingService).invalidate();
    ada = await signUp(ctx, 'tools-ada@example.com');
    bola = await signUp(ctx, 'tools-bola@example.com');
    staff = (
      await staffSession(ctx, 'tools-ops@suskii.test', [
        'content_manager',
        'operations',
        'visa_officer',
      ])
    ).headers;
  });
  afterAll(async () => {
    await ctx.background.drain();
    await ctx.close();
  });

  const run = async (conversationId: string | null = null): Promise<string> =>
    (
      await ctx.prisma.agentRun.create({
        data: {
          audience: 'customer',
          channel: 'web',
          agent: 'concierge',
          trigger: 'message',
          status: 'running',
          conversationId,
        },
      })
    ).id;

  /** A grant as the API seals one for a run: Ada's unless said otherwise. */
  const grantFor = async (over: Partial<AgentGrant> = {}): Promise<string> =>
    grants.issue({
      runId: await run(over.conversationId ?? null),
      conversationId: null,
      userId: ada.userId,
      roles: ['customer'],
      audience: 'customer',
      channel: 'web',
      scopes: [...GUEST_SCOPES, 'account'],
      locale: 'en-NG',
      currency: 'NGN',
      country: 'NG',
      ...over,
    });
  const guestGrant = (): Promise<string> =>
    grantFor({ userId: null, roles: [], scopes: GUEST_SCOPES });

  const call = async <T = Record<string, unknown>>(
    tool: string,
    agent: string,
    args: Record<string, unknown>,
    grant?: string,
  ): Promise<Answer<T>> => {
    const response = await ctx
      .http()
      .post(`/v1/internal/agent-tools/${tool}`)
      .set('authorization', `Bearer ${TOOLS_TOKEN}`)
      .send({ grant: grant ?? (await grantFor()), agent, arguments: args });
    expect(response.status).toBe(200);
    return response.body as Answer<T>;
  };

  const admin = (method: 'post' | 'patch' | 'put', path: string, body: object) =>
    ctx.http()[method](`/v1/admin/${path}`).set(staff).send(body);

  const book = (body: Record<string, unknown>, session: TokenSession = ada) =>
    ctx
      .http()
      .post('/v1/bookings')
      .set('Idempotency-Key', nextKey('e2e-tools-book'))
      .set(bearer(session.accessToken))
      .send({
        contact: CONTACT,
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
        turnstileToken: 'e2e-turnstile',
        passengers: [],
        guests: [],
        ...body,
      });

  /** A priced, unpaid return flight Lagos to Abuja for one traveller. */
  async function flightBooking(
    session: TokenSession = ada,
  ): Promise<{ id: string; reference: string }> {
    const headers = bearer(session.accessToken);
    const search = await ctx
      .http()
      .post('/v1/flights/searches')
      .set(headers)
      .send({
        slices: [
          { origin: 'LOS', destination: 'ABV', departureDate: inDays(30) },
          { origin: 'ABV', destination: 'LOS', departureDate: inDays(33) },
        ],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    const offerId = (search.body.offers as { id: string }[])[0]?.id ?? '';
    const quote = await ctx
      .http()
      .post(`/v1/flights/offers/${offerId}/quote`)
      .set(headers)
      .expect(201);
    const created = await book(
      { quoteId: quote.body.quoteId, passengers: [passenger('Ngozi', 'Eze')] },
      session,
    ).expect(201);
    return created.body.booking as { id: string; reference: string };
  }

  /** Every link a tool hands out stays inside the site. */
  const expectInternal = (cards: Card[] | undefined): void => {
    for (const entry of cards ?? []) {
      if (entry.href !== undefined) expect(entry.href).toMatch(/^\/[a-z]/);
      expect(JSON.stringify(entry)).not.toMatch(/https?:|\/\//);
    }
  };

  it('ships the tools with their tiers: nine prepare something, six ask for a tap, and the staff tools are staff only', async () => {
    const response = await ctx
      .http()
      .get('/v1/internal/agent-tools')
      .set('authorization', `Bearer ${TOOLS_TOKEN}`)
      .expect(200);
    const tools = (response.body as { tools: { name: string; tier: string; agents: string[] }[] })
      .tools;
    expect(tools.map((tool) => tool.name)).toEqual([
      'addons.search',
      'alerts.list',
      'alerts.stop',
      'alerts.watch',
      'bookings.cancel',
      'bookings.get',
      'bookings.list',
      'cars.buses',
      'cars.prepare_booking',
      'cars.rentals',
      'catalog.places',
      'changes.accept',
      'changes.get',
      'changes.take_refund_offer',
      'company.policy',
      'documents.passports',
      'fares.trend',
      'finance.booking_payments',
      'finance.draft_refund_request',
      'finance.overview',
      'flights.prepare_booking',
      'flights.search',
      'flights.status',
      'hotels.prepare_booking',
      'hotels.search',
      'knowledge.search',
      'marketing.draft_promo',
      'marketing.promos',
      'memory.read',
      'memory.remember',
      'ops.queues',
      'packages.search',
      'payments.options',
      'platform.guide',
      'platform.status',
      'prices.indicative',
      'quotes.list',
      'quotes.request',
      'reports.sales',
      'sources.drifting',
      'sources.overview',
      'sources.propose_recipe',
      'support.faqs',
      'support.handover',
      'tours.search',
      'trips.get',
      'trips.list',
      'trips.plan',
      'visa.requirements',
    ]);
    expect(tools.filter((tool) => tool.tier === 'propose').map((tool) => tool.name)).toEqual([
      'cars.prepare_booking',
      'finance.draft_refund_request',
      'flights.prepare_booking',
      'hotels.prepare_booking',
      'marketing.draft_promo',
      'quotes.request',
      'sources.propose_recipe',
      'support.handover',
      'trips.plan',
    ]);
    // What changes a booking: each only ever becomes a card the traveller confirms.
    expect(tools.filter((tool) => tool.tier === 'commit').map((tool) => tool.name)).toEqual([
      'alerts.stop',
      'alerts.watch',
      'bookings.cancel',
      'changes.accept',
      'changes.take_refund_offer',
      'memory.remember',
    ]);
    // Places, the status page and the knowledge base are for every agent. Every other tool is
    // either the customer agents' or the staff agents', never both; and a staff tool reads or
    // prepares, no more.
    const staffAgents = [...STAFF_AGENTS] as string[];
    const staffTools = /^(ops|reports|finance|marketing|sources)\./;
    for (const tool of tools) {
      const general = ['catalog.places', 'platform.status', 'knowledge.search'].includes(tool.name);
      const staffTool = staffTools.test(tool.name);
      expect([tool.name, tool.agents.some((agent) => staffAgents.includes(agent))]).toEqual([
        tool.name,
        general || staffTool,
      ]);
      if (!staffTool) continue;
      expect([tool.name, tool.agents.every((agent) => staffAgents.includes(agent))]).toEqual([
        tool.name,
        true,
      ]);
      expect([tool.name, tool.tier === 'commit']).toEqual([tool.name, false]);
    }
    expect(tools.filter((tool) => staffTools.test(tool.name))).toHaveLength(10);
    // Every customer agent can bring in a person.
    const handover = tools.find((tool) => tool.name === 'support.handover');
    expect(handover?.agents).toHaveLength(10);
  });

  it("matches the tool list the agent's evals run against", async () => {
    // The agent workspace cannot import the API: its evals read this snapshot of the registry.
    // After changing a tool, refresh it with UPDATE_AGENT_TOOLS_FIXTURE=1 and re-run the evals.
    const fixture = join(__dirname, '..', '..', 'agent', 'evals', 'tools.json');
    const response = await ctx
      .http()
      .get('/v1/internal/agent-tools')
      .set('authorization', `Bearer ${TOOLS_TOKEN}`)
      .expect(200);
    const tools = (response.body as { tools: unknown[] }).tools;
    if (process.env.UPDATE_AGENT_TOOLS_FIXTURE === '1') {
      writeFileSync(fixture, `${JSON.stringify({ tools }, null, 2)}\n`);
    }
    expect(existsSync(fixture)).toBe(true);
    expect((JSON.parse(readFileSync(fixture, 'utf8')) as { tools: unknown[] }).tools).toEqual(
      tools,
    );
  });

  it('searches flights for a guest, with what that person would pay and a link to the same search', async () => {
    const grant = await guestGrant();
    const depart = inDays(30);
    const back = inDays(33);
    const answer = await call<{
      found: number;
      offers: {
        option: number;
        airline: string;
        sample: boolean;
        legs: { from: string; to: string; departs: string; duration: string; stops: number }[];
        total: Wire;
      }[];
    }>(
      'flights.search',
      'flights',
      { origin: 'LOS', destination: 'ABV', departDate: depart, returnDate: back, limit: 3 },
      grant,
    );
    expect(answer.status).toBe('ok');
    const result = answer.result;
    expect(result?.problems).toEqual([]);
    expect(result?.found).toBeGreaterThan(0);
    expect(result?.offers.length).toBeGreaterThan(0);
    expect(result?.offers.length).toBeLessThanOrEqual(3);
    for (const offer of result?.offers ?? []) {
      // The demo supplier's fares are said to be samples; money is minor units of the grant's currency.
      expect(offer.sample).toBe(true);
      expect(offer.total.currency).toBe('NGN');
      expect(Number.isInteger(offer.total.amountMinor)).toBe(true);
      expect(offer.legs).toHaveLength(2);
      expect(offer.legs[0]).toMatchObject({ from: 'LOS', to: 'ABV' });
      expect(offer.legs[0]?.departs).toMatch(new RegExp(`^${depart} \\d{2}:\\d{2}$`));
      // A length a person reads, so the model never divides minutes.
      expect(offer.legs[0]?.duration).toMatch(/^(\d+ h( \d+ min)?|\d+ min)$/);
    }
    expect(result?.cards).toHaveLength(result?.offers.length ?? 0);
    expect(result?.cards?.[0]).toMatchObject({
      kind: 'flight',
      href: `/flights/search?trip=round_trip&from=LOS&to=ABV&depart=${depart}&return=${back}&adults=1`,
    });
    expectInternal(result?.cards);

    // The same search on the website gives the same first fare.
    const site = await ctx
      .http()
      .post('/v1/flights/searches')
      .send({
        slices: [
          { origin: 'LOS', destination: 'ABV', departureDate: depart },
          { origin: 'ABV', destination: 'LOS', departureDate: back },
        ],
        passengers: { adults: 1, children: 0, infants: 0 },
        cabinClass: 'economy',
      })
      .expect(200);
    expect(result?.offers[0]?.total).toEqual(
      (site.body.offers as { price: { total: Wire } }[])[0]?.price.total,
    );

    const cheapest = await call<{ offers: { total: Wire }[] }>(
      'flights.search',
      'flights',
      { origin: 'LOS', destination: 'ABV', departDate: depart, sort: 'cheapest', limit: 4 },
      grant,
    );
    const totals = (cheapest.result?.offers ?? []).map((offer) => offer.total.amountMinor);
    expect(totals.length).toBeGreaterThan(1);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
  });

  it('says why a search did not run in codes, and keeps each tool to its agents', async () => {
    const grant = await guestGrant();
    const problems = async (args: Record<string, unknown>): Promise<string[]> => {
      const answer = await call('flights.search', 'flights', args, grant);
      expect(answer.status).toBe('ok');
      expect(answer.result).toMatchObject({ found: 0, offers: [], cards: [] });
      return answer.result?.problems ?? [];
    };
    expect(await problems({ origin: 'LOS', destination: 'ABV', departDate: inDays(-2) })).toContain(
      'date_in_past',
    );
    expect(await problems({ origin: 'LOS', destination: 'LOS', departDate: inDays(9) })).toContain(
      'same_origin_destination',
    );
    expect(await problems({ origin: 'LOS', destination: 'ZZZ', departDate: inDays(9) })).toEqual(
      expect.arrayContaining(['validation-failed', 'unknown_airport']),
    );
    // Arguments that do not fit never reach the search.
    const malformed = await call(
      'flights.search',
      'flights',
      { origin: 'Lagos', destination: 'ABV' },
      grant,
    );
    expect(malformed).toMatchObject({ status: 'denied', reason: 'invalid', result: null });
    // The concierge routes; it does not search. A staff agent is not on this channel at all.
    const args = { origin: 'LOS', destination: 'ABV', departDate: inDays(9) };
    expect(await call('flights.search', 'concierge', args, grant)).toMatchObject({
      reason: 'agent',
    });
    expect(await call('flights.search', 'price_intel', args, grant)).toMatchObject({
      reason: 'agent',
    });
  });

  it('searches hotels in a city of the catalog, for the whole stay', async () => {
    const cityId =
      (await ctx.prisma.airport.findUniqueOrThrow({ where: { iataCode: 'ABV' } })).cityId ?? '';
    const grant = await guestGrant();
    const answer = await call<{
      found: number;
      nights: number;
      hotels: { name: string; sample: boolean; stars: number; perNight: Wire; total: Wire }[];
    }>(
      'hotels.search',
      'hotels',
      { cityId, checkIn: inDays(30), checkOut: inDays(33), rooms: [{ adults: 2 }], limit: 3 },
      grant,
    );
    expect(answer.status).toBe('ok');
    expect(answer.result).toMatchObject({ problems: [], nights: 3 });
    expect(answer.result?.hotels.length).toBeGreaterThan(0);
    for (const hotel of answer.result?.hotels ?? []) {
      expect(hotel.sample).toBe(true);
      expect(hotel.total.amountMinor).toBeGreaterThanOrEqual(hotel.perNight.amountMinor);
    }
    expect(answer.result?.cards?.[0]).toMatchObject({ kind: 'hotel' });
    expect(answer.result?.cards?.[0]?.href).toContain(
      `/hotels/search?dest=${cityId}&checkin=${inDays(30)}`,
    );
    expectInternal(answer.result?.cards);

    const backwards = await call(
      'hotels.search',
      'hotels',
      { cityId, checkIn: inDays(33), checkOut: inDays(30) },
      grant,
    );
    expect(backwards.result?.problems).toContain('check_out_not_after_check_in');
    expect(backwards.result).toMatchObject({ found: 0, hotels: [] });
  });

  it('prepares the booking of a chosen flight: a quote and a card to the booking page, nothing booked', async () => {
    const grant = await guestGrant();
    const depart = inDays(30);
    const back = inDays(33);
    const search = await call<{ offers: { offerId: string; total: Wire }[] }>(
      'flights.search',
      'flights',
      { origin: 'LOS', destination: 'ABV', departDate: depart, returnDate: back, limit: 2 },
      grant,
    );
    const chosen = search.result?.offers[0];
    expect(chosen?.offerId).toMatch(/^[A-Za-z0-9_.:-]{8,}$/);

    const answer = await call<{
      bookingStatus: string;
      prepared: boolean;
      what: string;
      totalToPay: Wire;
      priceChangedSinceSearch: boolean;
      offerValidUntil: string;
      alsoOffer: string[];
      stay: { city: string | null; country: string; arrive: string; leave: string | null };
    }>('flights.prepare_booking', 'flights', { offerId: chosen?.offerId }, grant);
    expect(answer.status).toBe('ok');
    expect(answer.result).toMatchObject({
      problems: [],
      // Never anything else: a prepared booking is an offer waiting on the booking page.
      bookingStatus: 'not_booked',
      prepared: true,
      totalToPay: chosen?.total,
      priceChangedSinceSearch: false,
      // After a flight: what else the trip may need, where, and for which dates.
      alsoOffer: ['hotel', 'car', 'airport_transfer', 'travel_insurance'],
      stay: { city: 'Abuja', country: 'NG', arrive: depart, leave: back },
    });
    expect(answer.result?.what).toMatch(/^Lagos \(LOS\) \u2192 Abuja \(ABV\), /);
    expect(answer.result?.offerValidUntil).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);

    // One card opens the booking page for exactly this quote; two notes say what it is not.
    const cards = answer.result?.cards ?? [];
    expect(cards.map((card) => [card.kind, card.title])).toEqual([
      ['flight', answer.result?.what],
      ['note', 'booking_handoff'],
      ['note', 'other_services'],
    ]);
    expect(cards[0]?.price).toEqual(chosen?.total);
    const quoteId = /^\/checkout\/([0-9a-f-]{36})$/.exec(cards[0]?.href ?? '')?.[1] ?? '';
    expect(quoteId).not.toBe('');
    expectInternal(cards);
    // The quote is the ordinary one: the booking page reads it as it reads any other.
    const quote = await ctx.http().get(`/v1/quotes/${quoteId}`).expect(200);
    expect(quote.body).toMatchObject({ quoteId, vertical: 'flights' });
    // And that is all that happened: no booking, no payment.
    expect(await ctx.prisma.booking.count()).toBe(0);
    expect(await ctx.prisma.payment.count()).toBe(0);

    // An option that is gone says so in a code, and prepares nothing.
    const gone = await call(
      'flights.prepare_booking',
      'flights',
      { offerId: 'fs_0000000000000000.o0' },
      grant,
    );
    expect(gone.status).toBe('ok');
    expect(gone.result).toMatchObject({ bookingStatus: 'not_booked', prepared: false, cards: [] });
    expect(gone.result?.problems?.length).toBeGreaterThan(0);
    // Only the agents that sell flights may prepare one.
    expect(
      await call('flights.prepare_booking', 'payments', { offerId: chosen?.offerId }, grant),
    ).toMatchObject({ status: 'denied', reason: 'agent' });
  });

  it('prepares the booking of a chosen stay and of a rental car, which needs an account', async () => {
    const cityId =
      (await ctx.prisma.airport.findUniqueOrThrow({ where: { iataCode: 'ABV' } })).cityId ?? '';
    const guest = await guestGrant();
    const stays = await call<{ hotels: { rateId: string; name: string; total: Wire }[] }>(
      'hotels.search',
      'hotels',
      { cityId, checkIn: inDays(30), checkOut: inDays(33), rooms: [{ adults: 2 }], limit: 2 },
      guest,
    );
    const stay = stays.result?.hotels[0];
    const hotel = await call<{ prepared: boolean; what: string; totalToPay: Wire; stay: null }>(
      'hotels.prepare_booking',
      'hotels',
      { rateId: stay?.rateId },
      guest,
    );
    expect(hotel.result).toMatchObject({
      problems: [],
      bookingStatus: 'not_booked',
      prepared: true,
      totalToPay: stay?.total,
      alsoOffer: [],
      stay: null,
    });
    expect(hotel.result?.what).toContain(stay?.name ?? 'no stay');
    expect(hotel.result?.cards?.map((card) => card.kind)).toEqual(['hotel', 'note']);
    expect(hotel.result?.cards?.[0]?.href).toMatch(/^\/checkout\/[0-9a-f-]{36}$/);
    expect(hotel.result?.cards?.[1]?.title).toBe('booking_handoff');
    expectInternal(hotel.result?.cards);

    // A rental: the renter's account carries the licence check and the deposit, so a guest is
    // told to sign in and nothing is prepared.
    await rentalVehicle(ctx, staff);
    const pickupAt = localIn(72).slice(0, 16);
    const returnAt = localIn(120).slice(0, 16);
    const cars = await call<{ cars: { carId: string; rentalForThePeriod: Wire }[] }>(
      'cars.rentals',
      'cars',
      { city: 'Lagos', pickupAt, returnAt },
      guest,
    );
    const car = cars.result?.cars[0];
    expect(car?.carId).toMatch(/^[0-9a-f-]{36}$/);
    const asGuest = await call(
      'cars.prepare_booking',
      'cars',
      { carId: car?.carId, pickupAt, returnAt },
      guest,
    );
    expect(asGuest.result).toMatchObject({
      problems: ['authentication-required'],
      prepared: false,
      cards: [],
    });

    const signedIn = await call<{ prepared: boolean; totalToPay: Wire }>(
      'cars.prepare_booking',
      'cars',
      { carId: car?.carId, pickupAt, returnAt },
      await grantFor(),
    );
    expect(signedIn.result).toMatchObject({
      problems: [],
      bookingStatus: 'not_booked',
      prepared: true,
    });
    expect(signedIn.result?.totalToPay.amountMinor).toBeGreaterThanOrEqual(
      car?.rentalForThePeriod.amountMinor ?? Infinity,
    );
    expect(signedIn.result?.cards?.map((card) => card.kind)).toEqual(['car', 'note']);
    expect(signedIn.result?.cards?.[0]?.href).toMatch(/^\/checkout\/[0-9a-f-]{36}$/);
    // A return before the pick-up is refused in a code, as the car's own page refuses it.
    const backwards = await call(
      'cars.prepare_booking',
      'cars',
      { carId: car?.carId, pickupAt: returnAt, returnAt: pickupAt },
      await grantFor(),
    );
    expect(backwards.result).toMatchObject({ prepared: false, cards: [] });
    expect(backwards.result?.problems?.length).toBeGreaterThan(0);
    expect(await ctx.prisma.booking.count()).toBe(0);
  });

  it('explains how the platform works, topic by topic, with what is switched on now', async () => {
    const grant = await guestGrant();
    const cars = await call<{
      topic: string;
      guide: string[];
      offeredNow: Record<string, boolean>;
      currencies: string[];
    }>('platform.guide', 'concierge', { topic: 'cars' }, grant);
    expect(cars.status).toBe('ok');
    expect(cars.result).toMatchObject({
      topic: 'cars',
      offeredNow: { buses: true, rides: true, rentals: true },
      currencies: [],
    });
    expect(cars.result?.guide.length).toBeGreaterThan(3);
    expect(cars.result?.cards?.map((card) => [card.kind, card.href])).toEqual([
      ['link', '/buses'],
      ['link', '/rides'],
      ['link', '/rentals'],
    ]);
    expectInternal(cars.result?.cards);

    const overview = await call<{ guide: string[]; currencies: string[] }>(
      'platform.guide',
      'bookings',
      { topic: 'overview' },
      grant,
    );
    expect(overview.result?.currencies).toContain('NGN');
    // What the assistant says of itself: it prepares, the traveller pays; nothing in the
    // guide is a price, a percentage or an opening hour.
    const self = await call<{ guide: string[] }>(
      'platform.guide',
      'concierge',
      { topic: 'ask_suskii' },
      grant,
    );
    const text = self.result?.guide.join(' ') ?? '';
    expect(text).toMatch(/never takes payment/);
    expect(text).toMatch(/prepares the booking/);
    for (const topic of ['flights', 'hotels', 'payments', 'changes_and_refunds', 'prime']) {
      const page = await call<{ guide: string[] }>('platform.guide', 'concierge', { topic }, grant);
      expect([topic, /[₦$€£%]|\b\d{1,2}:\d{2}\b/.test(page.result?.guide.join(' ') ?? '')]).toEqual(
        [topic, false],
      );
    }
    // A topic that does not exist is refused, and staff agents have their own tools.
    expect(await call('platform.guide', 'concierge', { topic: 'secrets' }, grant)).toMatchObject({
      status: 'denied',
      reason: 'invalid',
    });
    expect(await call('platform.guide', 'executive', { topic: 'overview' }, grant)).toMatchObject({
      status: 'denied',
      reason: 'agent',
    });
  });

  it('lists rental cars that are free and bus departures, and the cities buses run between', async () => {
    const car = await rentalVehicle(ctx, staff);
    await busInventory(ctx, staff, { departureInDays: 5 });
    const grant = await guestGrant();

    const pickupAt = localIn(72).slice(0, 16);
    const returnAt = localIn(120).slice(0, 16);
    const rentals = await call<{
      found: number;
      days: number;
      cars: { car: string; perDay: Wire; rentalForThePeriod: Wire; refundableDeposit: Wire }[];
    }>('cars.rentals', 'cars', { city: 'Lagos', pickupAt, returnAt }, grant);
    expect(rentals.status).toBe('ok');
    expect(rentals.result).toMatchObject({ problems: [], found: 1, days: 2 });
    expect(rentals.result?.cars[0]).toMatchObject({
      car: 'Toyota Corolla 2021',
      perDay: ngn(45_000),
      rentalForThePeriod: ngn(90_000),
      refundableDeposit: ngn(100_000),
    });
    expect(rentals.result?.cards?.[0]).toMatchObject({ kind: 'car', price: ngn(90_000) });
    expect(rentals.result?.cards?.[0]?.href).toBe(
      `/rentals/${car.slug}?pickupAt=${encodeURIComponent(pickupAt)}&returnAt=${encodeURIComponent(returnAt)}`,
    );
    expect(
      (await call('cars.rentals', 'cars', { city: 'Kano', pickupAt, returnAt }, grant)).result,
    ).toMatchObject({ found: 0, cars: [] });

    const buses = await call<{
      found: number;
      trips: { operator: string; from: string; to: string; perSeat: Wire; seatsLeft: number }[];
    }>('cars.buses', 'cars', { from: 'Lagos', to: 'Ibadan', date: inDays(5) }, grant);
    expect(buses.status).toBe('ok');
    expect(buses.result?.found).toBe(1);
    expect(buses.result?.trips[0]?.operator).toBe('Lagoon Express');
    expect(buses.result?.trips[0]?.perSeat.currency).toBe('NGN');
    expect(buses.result?.cards?.[0]?.href).toMatch(/^\/buses\/trips\/[0-9a-f-]{36}$/);
    // A city without buses: nothing, and the names to choose from.
    const none = await call<{ found: number; citiesWithBuses: string[] }>(
      'cars.buses',
      'cars',
      { from: 'Lagos', to: 'Enugu', date: inDays(5) },
      grant,
    );
    expect(none.result?.found).toBe(0);
    expect(none.result?.citiesWithBuses).toEqual(expect.arrayContaining(['Lagos', 'Ibadan']));
  });

  it('reads packages, tours, visa rules and add-ons from the catalog staff manage', async () => {
    const lagosId = (
      await ctx.prisma.city.findFirstOrThrow({ where: { name: 'Lagos', countryCode: 'NG' } })
    ).id;
    const pack = await admin('post', 'packages', {
      slug: 'lagos-getaway-tools',
      title: 'Lagos getaway',
      summary: 'Three nights by the lagoon.',
      cityId: lagosId,
      nights: 3,
      passportRequired: false,
      cancellationPolicy: POLICY,
      inclusions: ['Hotel', 'Airport transfers'],
    }).expect(201);
    await admin('post', `packages/${pack.body.id as string}/departures`, {
      startDate: inDays(60),
      endDate: inDays(63),
      capacity: 10,
      prices: { adult: ngn(200_000), child: ngn(120_000), infant: null },
    }).expect(201);
    await admin('patch', `packages/${pack.body.id as string}`, { status: 'published' }).expect(204);

    const tour = await admin('post', 'tours', {
      slug: 'lagos-walk-tools',
      title: 'Lagos walking tour',
      summary: 'Markets and history on foot.',
      cityId: lagosId,
      timeZone: 'Africa/Lagos',
      durationMinutes: 180,
      meetingPoint: { name: 'Tafawa Balewa Square', address: 'Lagos Island', notes: null },
      cancellationPolicy: POLICY,
    }).expect(201);
    await admin('post', `tours/${tour.body.id as string}/departures`, {
      startsAtLocal: `${inDays(10)}T09:00`,
      capacity: 8,
      prices: { adult: ngn(30_000), child: ngn(15_000), infant: ngn(0) },
    }).expect(201);
    await admin('patch', `tours/${tour.body.id as string}`, { status: 'published' }).expect(204);

    const visa = await admin('post', 'visa-products', {
      slug: 'uk-visitor-tools',
      title: 'UK visitor visa assistance',
      summary: 'We check and submit your application.',
      destination: 'GB',
      purposes: ['tourism'],
      processingDaysMin: 15,
      processingDaysMax: 30,
      price: ngn(80_000),
      checklist: [{ key: 'passport', label: 'Passport', description: 'Bio page', required: true }],
    }).expect(201);
    await admin('patch', `visa-products/${visa.body.id as string}`, { status: 'published' }).expect(
      204,
    );
    await admin('put', 'visa-rules', {
      nationality: 'NG',
      destination: 'GB',
      purpose: 'tourism',
      requirement: 'visa_required',
      notes: 'Apply at least four weeks ahead.',
      verifiedAt: inDays(0),
    }).expect(200);

    const addon = await admin('post', 'addons', {
      slug: 'transfer-tools',
      type: 'airport_transfer',
      title: 'Airport transfer',
      summary: 'Private car.',
      description: 'Meet and greet at arrivals.',
      countryCodes: ['NG'],
      pricingBasis: 'per_booking',
      price: ngn(25_000),
      maxTravellers: 4,
      requiredDetails: [],
      cancellationPolicy: POLICY,
    }).expect(201);
    await admin('patch', `addons/${addon.body.id as string}`, { status: 'published' }).expect(204);

    const grant = await guestGrant();
    const packages = await call<{ found: number; packages: Record<string, unknown>[] }>(
      'packages.search',
      'tours',
      { cityId: lagosId },
      grant,
    );
    expect(packages.result?.found).toBe(1);
    expect(packages.result?.packages[0]).toMatchObject({
      title: 'Lagos getaway',
      sample: false,
      nights: 3,
      fromPerAdult: ngn(200_000),
      nextDeparture: inDays(60),
    });
    expect(packages.result?.cards?.[0]).toMatchObject({
      kind: 'package',
      href: '/packages/lagos-getaway-tools',
    });

    const tours = await call<{ tours: Record<string, unknown>[] }>(
      'tours.search',
      'tours',
      { query: 'walking' },
      grant,
    );
    expect(tours.result?.tours[0]).toMatchObject({
      title: 'Lagos walking tour',
      duration: '3 h',
      fromPrice: ngn(30_000),
      nextDeparture: `${inDays(10)} 09:00`,
    });
    expect(tours.result?.cards?.[0]?.href).toBe('/tours/lagos-walk-tools');

    const known = await call<{ requirement: string; assistance: Record<string, unknown>[] }>(
      'visa.requirements',
      'tours',
      { nationality: 'NG', destination: 'GB' },
      grant,
    );
    expect(known.result).toMatchObject({
      requirement: 'visa_required',
      notes: 'Apply at least four weeks ahead.',
      ruleCheckedOn: inDays(0),
    });
    expect(String((known.result as { disclaimer?: string }).disclaimer).length).toBeGreaterThan(20);
    expect(known.result?.assistance[0]).toMatchObject({
      title: 'UK visitor visa assistance',
      processingDays: '15 to 30',
      serviceFeePerApplicant: ngn(80_000),
    });
    expect(known.result?.cards?.[0]?.href).toBe('/visa/uk-visitor-tools');
    // A rule on file is guidance: the note goes with it whatever the model writes (ADR-107).
    expect(known.result?.cards?.at(-1)).toEqual({
      kind: 'note',
      title: 'visa_guidance',
      lines: [],
    });
    // No rule on file is said as such, never guessed.
    const unknown = await call<{ requirement: string }>(
      'visa.requirements',
      'tours',
      { nationality: 'NG', destination: 'JP' },
      grant,
    );
    expect(unknown.result?.requirement).toBe('unknown');
    expect(unknown.result?.cards).toEqual([{ kind: 'note', title: 'visa_guidance', lines: [] }]);
    expect(
      await call('visa.requirements', 'tours', { nationality: 'NG', destination: 'NG' }, grant),
    ).toMatchObject({ status: 'denied', reason: 'invalid' });

    const addons = await call<{ addons: Record<string, unknown>[] }>(
      'addons.search',
      'cars',
      { type: 'airport_transfer', countryCode: 'NG' },
      grant,
    );
    expect(addons.result?.addons[0]).toMatchObject({
      title: 'Airport transfer',
      price: ngn(25_000),
      chargedPer: 'booking',
    });
    expectInternal(addons.result?.cards);
  });

  it("reads a traveller's own bookings without a name, a contact, a reference or a payment link", async () => {
    const mine = await flightBooking(ada);
    const theirs = await flightBooking(bola);

    const list = await call<{
      shown: number;
      bookings: { bookingId: string; what: string; bookingStatus: string; total: Wire }[];
    }>('bookings.list', 'bookings', {});
    expect(list.status).toBe('ok');
    expect(list.result?.bookings.map((booking) => booking.bookingId)).toEqual([mine.id]);
    expect(list.result?.bookings[0]).toMatchObject({
      kind: 'flights',
      bookingStatus: 'priced',
      cancellationStatus: 'none',
    });
    expect(list.result?.bookings[0]?.what).toMatch(/^Lagos \(LOS\) to Abuja \(ABV\), /);
    expect(list.result?.cards?.[0]).toMatchObject({
      kind: 'booking',
      href: `/bookings/${mine.id}`,
      ref: { type: 'booking', id: mine.id },
    });

    const one = await call<{
      bookingStatus: string;
      total: Wire;
      paid: Wire;
      dueNow: Wire | null;
      facts: { key: string; text: string }[];
    }>('bookings.get', 'bookings', { bookingId: mine.id });
    expect(one.status).toBe('ok');
    expect(one.result).toMatchObject({
      bookingId: mine.id,
      bookingStatus: 'priced',
      cancellationStatus: 'none',
      paid: ngn(0),
      refunds: [],
      airlineChangedTheFlight: false,
    });
    expect(one.result?.dueNow).toEqual(one.result?.total);
    const keys = (one.result?.facts ?? []).map((fact) => fact.key);
    expect(keys).toEqual(
      expect.arrayContaining(['booking.status', 'booking.payment', 'flight.1', 'flight.2']),
    );

    const options = await call<{
      methods: string[];
      dueNow: Wire | null;
      lastPaymentStatus: string;
    }>('payments.options', 'payments', { bookingId: mine.id });
    expect(options.status).toBe('ok');
    expect(options.result).toMatchObject({
      bookingStatus: 'priced',
      lastPaymentStatus: 'none',
      planInForce: null,
      waitsForCompanyApproval: false,
    });
    expect(options.result?.methods.length).toBeGreaterThan(0);
    expect(options.result?.dueNow).toEqual(one.result?.total);

    // Nothing a model reads names the traveller, reaches them or opens the booking for anyone.
    const seen = JSON.stringify([list, one, options]);
    for (const secret of [
      'Ngozi',
      'Eze',
      CONTACT.email,
      CONTACT.phone,
      mine.reference,
      'checkout',
      'accessToken',
    ]) {
      expect(seen).not.toContain(secret);
    }

    // Someone else's booking, and one that never existed, are the same nothing.
    for (const bookingId of [theirs.id, '019a0000-0000-7000-8000-00000000dead']) {
      for (const tool of ['bookings.get', 'payments.options']) {
        expect(
          await call(tool, tool === 'bookings.get' ? 'bookings' : 'payments', { bookingId }),
        ).toMatchObject({
          status: 'error',
          reason: 'not_found',
          result: null,
        });
      }
    }
    // A guest's grant does not open the account at all.
    const guest = await guestGrant();
    expect(await call('bookings.list', 'bookings', {}, guest)).toMatchObject({ reason: 'scope' });
    expect(await call('bookings.get', 'bookings', { bookingId: mine.id }, guest)).toMatchObject({
      reason: 'scope',
    });
  });

  it('plans a combined trip for the signed-in traveller and reads it back, theirs only', async () => {
    const planned = await call<{
      trip: { tripId: string; tripState: string; partsNotChosenYet: string[] } | null;
    }>('trips.plan', 'trip_builder', {
      origin: 'LOS',
      destination: 'ABV',
      departDate: inDays(30),
      returnDate: inDays(33),
      adults: 2,
      parts: ['flight', 'hotel'],
    });
    expect(planned.status).toBe('ok');
    expect(planned.result?.problems).toEqual([]);
    const tripId = planned.result?.trip?.tripId ?? '';
    expect(planned.result?.trip).toMatchObject({
      from: 'Lagos (LOS)',
      to: 'Abuja (ABV)',
      adults: 2,
      tripState: 'empty',
      parts: [],
      partsNotChosenYet: ['flight', 'hotel'],
    });
    expect(planned.result?.cards?.[0]).toMatchObject({
      kind: 'trip',
      href: `/trips/${tripId}`,
      ref: { type: 'trip', id: tripId },
    });
    // It is an ordinary trip of the traveller's, and nobody else's.
    const stored = await ctx.prisma.trip.findUniqueOrThrow({ where: { id: tripId } });
    expect(stored.userId).toBe(ada.userId);
    await ctx.http().get(`/v1/trips/${tripId}`).set(bearer(ada.accessToken)).expect(200);

    const list = await call<{ shown: number; trips: { tripId: string }[] }>(
      'trips.list',
      'trip_builder',
      {},
    );
    expect(list.result?.trips.map((trip) => trip.tripId)).toEqual([tripId]);
    expect((await call('trips.get', 'trip_builder', { tripId })).status).toBe('ok');
    const bolas = await grantFor({ userId: bola.userId });
    expect(await call('trips.get', 'trip_builder', { tripId }, bolas)).toMatchObject({
      status: 'error',
      reason: 'not_found',
    });
    expect(
      (await call<{ shown: number }>('trips.list', 'trip_builder', {}, bolas)).result?.shown,
    ).toBe(0);

    // A plan the rules refuse is said in a code; an airport the catalog does not know likewise.
    const backwards = await call('trips.plan', 'trip_builder', {
      origin: 'LOS',
      destination: 'ABV',
      departDate: inDays(33),
      returnDate: inDays(30),
    });
    expect(backwards.result).toMatchObject({ trip: null });
    expect(backwards.result?.problems?.length).toBeGreaterThan(0);
    expect(
      (
        await call('trips.plan', 'trip_builder', {
          origin: 'LOS',
          destination: 'ZZZ',
          departDate: inDays(30),
          returnDate: inDays(33),
        })
      ).result,
    ).toMatchObject({ problems: ['unknown_airport'], trip: null });
    expect(await ctx.prisma.trip.count()).toBe(1);
  });

  it('answers from published help articles only', async () => {
    // The seeded articles are reference data other suites read: this test adds its own and
    // takes them away again.
    const published = new Date(Date.now() - 60_000);
    const mine = await Promise.all(
      [
        {
          question: 'Can I bring a kora on board?',
          answer: 'A kora travels as checked baggage in a hard case; tell us 48 hours ahead.',
          publishedAt: published,
        },
        {
          question: 'Can I bring a djembe on board?',
          answer: 'A small djembe fits in the cabin when it is within the carry-on size.',
          publishedAt: published,
        },
        {
          question: 'Kora draft, not published',
          answer: 'A kora needs 99 days of notice.',
          publishedAt: null,
        },
      ].map((data) => ctx.prisma.faq.create({ data: { locale: 'en-NG', ...data } })),
    );
    try {
      const grant = await guestGrant();
      const answer = await call<{
        found: number;
        articles: { question: string; answer: string }[];
      }>('support.faqs', 'support', { query: 'travelling with my kora' }, grant);
      expect(answer.status).toBe('ok');
      expect(answer.result?.articles[0]?.question).toBe('Can I bring a kora on board?');
      expect(answer.result?.articles[0]?.answer).toContain('48 hours');
      // A draft is not an answer, however well it matches.
      expect(JSON.stringify(answer.result)).not.toContain('99 days');
      expect(
        (
          await call<{ found: number }>(
            'support.faqs',
            'support',
            { query: 'xylophone quokka' },
            grant,
          )
        ).result?.found,
      ).toBe(0);
    } finally {
      await ctx.prisma.faq.deleteMany({ where: { id: { in: mine.map((faq) => faq.id) } } });
    }
  });

  it("hands over to the support team with the traveller's own words, once", async () => {
    const mine = await flightBooking(ada);
    const headers = bearer(ada.accessToken);
    const started = await ctx
      .http()
      .post('/v1/agent/conversations')
      .set(headers)
      .send({})
      .expect(201);
    const conversationId = (started.body as { conversation: { id: string } }).conversation.id;
    for (const text of [
      'My flight to Abuja was moved by the airline.',
      'I need a person to rebook me please.',
    ]) {
      await ctx
        .http()
        .post('/v1/agent/chat')
        .set(headers)
        .send({ conversationId, text })
        .expect(202);
      await ctx.background.drain();
    }

    const grant = await grantFor({ conversationId });
    const answer = await call<{
      handedOver: boolean;
      alreadyOpen: boolean;
      needsTheSupportPage: boolean;
      teamAimsToReplyBy: string | null;
      priorityQueue: boolean;
    }>('support.handover', 'support', { category: 'booking_change', bookingId: mine.id }, grant);
    expect(answer.status).toBe('ok');
    expect(answer.result).toMatchObject({
      problems: [],
      handedOver: true,
      alreadyOpen: false,
      needsTheSupportPage: false,
      priorityQueue: false,
    });
    await ctx.background.drain();
    const conversation = await ctx.prisma.supportConversation.findFirstOrThrow({
      where: { userId: ada.userId },
    });
    expect(conversation).toMatchObject({
      topic: 'assistant_handover',
      category: 'booking_change',
      bookingId: mine.id,
      status: 'open',
      // The traveller's words and the note for staff. The after-hours assistant is not
      // consulted on a conversation with a topic.
      messageCount: 2,
    });
    // The time the assistant may name is the conversation's own reply target, as text.
    expect(conversation.responseDueAt).not.toBeNull();
    expect(answer.result?.teamAimsToReplyBy).toBe(
      `${conversation.responseDueAt!.toISOString().slice(0, 10)} ${conversation
        .responseDueAt!.toISOString()
        .slice(11, 16)} UTC`,
    );

    // Staff are told what was already looked up, in a note the traveller never sees: agent
    // and tool names with how each call ended, and nobody's words.
    const inbox = await staffSession(ctx, 'tools-support@suskii.test', ['support']);
    const seen = await ctx
      .http()
      .get(`/v1/admin/support/conversations/${conversation.id}`)
      .set(inbox.headers)
      .expect(200);
    const notes = (
      seen.body as { messages: { author: string; internal: boolean; text: string }[] }
    ).messages.filter((message) => message.internal);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ author: 'system', internal: true });
    expect(notes[0]!.text).toContain('Handed over by the assistant (conversation A-');
    expect(notes[0]!.text).toContain('Agents that worked on it: concierge.');
    expect(notes[0]!.text).toContain('Tools it called: ');
    for (const words of ['Abuja', 'rebook', 'sample assistant']) {
      expect(notes[0]!.text).not.toContain(words);
    }
    expect(answer.result?.cards?.[0]).toMatchObject({
      kind: 'link',
      href: `/support/${conversation.id}`,
      ref: { type: 'support', id: conversation.id },
    });
    // Staff read what the traveller wrote, not a model's account of it.
    const read = await ctx
      .http()
      .get(`/v1/support/conversations/${conversation.id}`)
      .set(headers)
      .expect(200);
    const messages = (read.body as { messages: { author: string; text: string }[] }).messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      author: 'customer',
      text: 'My flight to Abuja was moved by the airline.\n\nI need a person to rebook me please.',
    });

    // The assistant's conversation says which support conversation took it over.
    expect(
      await ctx.prisma.agentConversation.findUniqueOrThrow({ where: { id: conversationId } }),
    ).toMatchObject({ handoverConversationId: conversation.id });

    // Asking again opens nothing new.
    const again = await call<{ alreadyOpen: boolean }>(
      'support.handover',
      'bookings',
      {},
      await grantFor({ conversationId }),
    );
    expect(again.result).toMatchObject({
      handedOver: true,
      alreadyOpen: true,
      teamAimsToReplyBy: answer.result?.teamAimsToReplyBy,
    });
    expect(await ctx.prisma.supportConversation.count()).toBe(1);
    // And leaves no second note.
    expect(await ctx.prisma.supportMessage.count({ where: { internal: true } })).toBe(1);

    // Someone else's booking cannot be attached: nothing is opened for it.
    const bolaStart = await ctx
      .http()
      .post('/v1/agent/conversations')
      .set(bearer(bola.accessToken))
      .send({})
      .expect(201);
    const bolaConversation = (bolaStart.body as { conversation: { id: string } }).conversation.id;
    await ctx
      .http()
      .post('/v1/agent/chat')
      .set(bearer(bola.accessToken))
      .send({ conversationId: bolaConversation, text: 'Please help with this booking.' })
      .expect(202);
    await ctx.background.drain();
    expect(
      await call(
        'support.handover',
        'support',
        { bookingId: mine.id },
        await grantFor({ userId: bola.userId, conversationId: bolaConversation }),
      ),
    ).toMatchObject({ status: 'error', reason: 'not_found' });
    expect(await ctx.prisma.supportConversation.count()).toBe(1);

    // A guest is shown the support page, where a conversation starts with a human check.
    const guest = await call<{ handedOver: boolean; needsTheSupportPage: boolean }>(
      'support.handover',
      'concierge',
      {},
      await guestGrant(),
    );
    expect(guest.result).toMatchObject({ handedOver: false, needsTheSupportPage: true });
    expect(guest.result?.cards?.[0]).toMatchObject({ kind: 'link', href: '/support' });
    expect(await ctx.prisma.supportConversation.count()).toBe(1);
  });

  it('shows prices seen elsewhere as indicative, and asks a person to confirm one', async () => {
    ctx.app.get(MockScrapeProvider).reset();
    const stay = { product: 'hotel', place: 'Lagos', from: inDays(30), to: inDays(32), adults: 2 };
    // No site is listed for hotels yet: nothing to read, said in a code.
    expect((await call('prices.indicative', 'hotels', stay)).result).toEqual({
      problems: ['no_source'],
      found: 0,
      prices: [],
      cards: [],
    });

    // A site still in review: outside production the mock vendor stands in for it.
    const admin = await staffSession(ctx, 'tools-sources@suskii.test', ['super_admin']);
    await ctx.app.get(PriceSourcesService).create(
      {
        domain: 'rooms.example.com',
        name: 'Rooms Example',
        products: ['hotel'],
        country: 'NG',
        currency: 'NGN',
        locale: 'en-NG',
        urlTemplates: {
          hotel: 'https://rooms.example.com/search?city={place}&in={from}&out={to}',
        },
        recipes: {
          hotel: {
            version: 'hotel-v1',
            methods: [{ method: 'structured_data', types: ['Hotel'] }],
          },
        },
        vendors: ['mock'],
        timeZone: 'Africa/Lagos',
      } as Parameters<PriceSourcesService['create']>[0],
      { userId: admin.userId, context: { ip: '127.0.0.1' } },
    );
    interface Seen {
      observationId: string;
      what: string;
      indicativePrice: Wire;
      seenOn: string;
      seenAt: string;
      indicative: boolean;
    }
    const answer = await call<{ found: number; prices: Seen[]; cards: Card[] }>(
      'prices.indicative',
      'hotels',
      stay,
      await guestGrant(),
    );
    expect(answer.status).toBe('ok');
    const prices = answer.result?.prices ?? [];
    expect(prices.length).toBeGreaterThan(0);
    expect(answer.result?.found).toBe(prices.length);
    for (const price of prices) {
      // What it is: seen on a named site at a stated time, and nothing more.
      expect(price).toMatchObject({ indicative: true, seenOn: 'Rooms Example' });
      expect(price.seenAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
      expect(price.indicativePrice.amountMinor).toBeGreaterThan(0);
    }
    // The cards are marked indicative and lead nowhere: there is nothing to book.
    const cards = answer.result?.cards ?? [];
    expect(cards).toHaveLength(prices.length);
    for (const entry of cards) {
      expect(entry).toMatchObject({ kind: 'price', indicative: true });
      expect(entry.href).toBeUndefined();
    }
    expectInternal(cards);
    // A question that is not one is refused in codes, and nothing is read for it.
    const bad = await call<{ problems: string[] }>('prices.indicative', 'hotels', {
      ...stay,
      to: inDays(20),
    });
    expect(bad.result?.problems.length).toBeGreaterThan(0);
    expect((await call('prices.indicative', 'payments', stay)).reason).toBe('agent');

    // Asking a person to confirm it: an account's request, which books nothing.
    const first = prices[0];
    const wanted = {
      product: 'hotel',
      what: first?.what ?? 'A room in Lagos',
      destination: 'Lagos',
      startDate: inDays(30),
      endDate: inDays(32),
      adults: 2,
      observationId: first?.observationId,
    };
    const guest = await call('quotes.request', 'hotels', wanted, await guestGrant());
    expect(guest.result).toMatchObject({ requested: false, needsToSignIn: true, quote: null });
    const personal = await call<{ problems: string[]; requested: boolean }>(
      'quotes.request',
      'hotels',
      { ...wanted, what: 'A room, call me on +234 801 234 5678' },
    );
    expect(personal.result).toMatchObject({ requested: false, problems: ['no_contact_details'] });
    expect(await ctx.prisma.assistedQuote.count()).toBe(0);

    interface Asked {
      quoteId: string;
      quoteState: string;
      offeredTotal: Wire | null;
      bookingId: string | null;
    }
    const asked = await call<{ requested: boolean; quote: Asked; cards: Card[] }>(
      'quotes.request',
      'hotels',
      wanted,
    );
    expect(asked.result).toMatchObject({
      problems: [],
      requested: true,
      quote: { quoteState: 'waiting_for_a_person', offeredTotal: null, bookingId: null },
    });
    const quoteId = asked.result?.quote.quoteId ?? '';
    expect(asked.result?.cards).toEqual([
      expect.objectContaining({ kind: 'price', href: `/quotes/${quoteId}` }),
    ]);
    // The request is the traveller's, in the conversation's currency, with the price it came
    // from kept as a reference.
    expect(
      await ctx.prisma.assistedQuote.findUniqueOrThrow({ where: { id: quoteId } }),
    ).toMatchObject({
      userId: ada.userId,
      status: 'requested',
      currency: 'NGN',
      observationId: first?.observationId,
      referenceMinor: BigInt(first?.indicativePrice.amountMinor ?? 0),
      referenceSource: 'Rooms Example',
    });

    // Its answer is read back; someone else has none, and a guest has no account to read.
    const mine = await call<{ found: number; quotes: Asked[] }>('quotes.list', 'hotels', {});
    expect(mine.result).toMatchObject({
      found: 1,
      quotes: [{ quoteId, quoteState: 'waiting_for_a_person' }],
    });
    const theirs = await call('quotes.list', 'hotels', {}, await grantFor({ userId: bola.userId }));
    expect(theirs.result).toEqual({ found: 0, quotes: [], cards: [] });
    expect((await call('quotes.list', 'hotels', {}, await guestGrant())).reason).toBe('scope');

    // A person verified it: the offer's total is what the traveller would pay, on its page.
    await ctx.app.get(AssistedQuotesService).offer(
      quoteId,
      {
        supplierName: 'Wholesale Rooms Ltd',
        supplierPrice: { amountMinor: 30_000_000, currency: 'NGN' },
        evidenceUrl: 'https://files.suskii.test/evidence/price.pdf',
        details: {
          title: 'Sea view room',
          summary: 'Two nights for two with breakfast. Free cancellation until five days before.',
          startDate: inDays(30),
          endDate: inDays(32),
          cityName: 'Lagos',
          countryCode: 'NG',
          refundable: true,
        },
      },
      { userId: admin.userId, context: { ip: '127.0.0.1' } },
    );
    const answered = await call<{ quotes: Asked[]; cards: Card[] }>('quotes.list', 'hotels', {});
    expect(answered.result?.quotes[0]).toMatchObject({
      quoteState: 'on_offer',
      offeredTotal: ngn(300_000),
    });
    expect(answered.result?.cards[0]).toMatchObject({
      kind: 'price',
      price: ngn(300_000),
      href: `/quotes/${quoteId}`,
    });
    // Who sells it to Suskii and the proof never reach a model.
    expect(JSON.stringify(answered)).not.toMatch(/Wholesale|files\.suskii/);
  });

  it('records each call with argument names only', async () => {
    const mine = await flightBooking(ada);
    const runId = await run();
    const grant = grants.issue({
      runId,
      conversationId: null,
      userId: ada.userId,
      roles: ['customer'],
      audience: 'customer',
      channel: 'web',
      scopes: [...GUEST_SCOPES, 'account'],
      locale: 'en-NG',
      currency: 'NGN',
      country: 'NG',
    });
    await call('bookings.get', 'bookings', { bookingId: mine.id }, grant);
    await call(
      'support.faqs',
      'bookings',
      { query: 'my card number is 4111 1111 1111 1111' },
      grant,
    );
    const rows = await ctx.prisma.agentToolCall.findMany({
      where: { runId },
      orderBy: { id: 'asc' },
    });
    expect(rows.map((row) => [row.tool, row.tier, row.status, row.argumentKeys])).toEqual([
      ['bookings.get', 'read', 'ok', ['bookingId']],
      ['support.faqs', 'read', 'ok', ['query']],
    ]);
    expect(JSON.stringify(rows)).not.toContain('4111');
    expect(JSON.stringify(rows)).not.toContain(mine.id);
  });
});

describe('customer agent tools with Cars switched off (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      AGENT_ENABLED: true,
      AGENT_SERVICE: 'mock',
      AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
      AGENT_RUN_TOKEN: RUN_TOKEN,
      CARS_RENTALS_ENABLED: false,
      CARS_BUSES_ENABLED: false,
    });
    await resetState(ctx);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('says a product is not offered instead of listing it', async () => {
    const run = await ctx.prisma.agentRun.create({
      data: { audience: 'customer', channel: 'web', agent: 'concierge', trigger: 'message' },
    });
    const grant = ctx.app.get(AgentGrants).issue({
      runId: run.id,
      conversationId: null,
      userId: null,
      roles: [],
      audience: 'customer',
      channel: 'web',
      scopes: GUEST_SCOPES,
      locale: 'en-NG',
      currency: 'NGN',
      country: 'NG',
    });
    const call = async (tool: string, args: Record<string, unknown>) =>
      (
        await ctx
          .http()
          .post(`/v1/internal/agent-tools/${tool}`)
          .set('authorization', `Bearer ${TOOLS_TOKEN}`)
          .send({ grant, agent: 'cars', arguments: args })
          .expect(200)
      ).body as Answer;
    const rentals = await call('cars.rentals', {
      city: 'Lagos',
      pickupAt: `${inDays(3)}T10:00`,
      returnAt: `${inDays(5)}T10:00`,
    });
    expect(rentals.result).toMatchObject({ problems: ['not_offered'], found: 0, cars: [] });
    const buses = await call('cars.buses', { from: 'Lagos', to: 'Ibadan', date: inDays(3) });
    expect(buses.result).toMatchObject({ problems: ['not_offered'], found: 0, trips: [] });
  });
});
