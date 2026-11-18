import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';

import { BOOKING_TERMS_VERSION } from '@suskii/shared';

import { CONTACT, inDays, nextKey, staffSession } from './helpers/cars';
import { bearer, signUp, type TokenSession } from './helpers/flows';
import { pdfText } from './helpers/pdf-text';
import { rentalVehicle } from './helpers/rentals';
import { createTestApp, resetState, type TestContext } from './helpers/test-app';

/**
 * A whole trip planned with Ask Suskii and paid once, with every part of the platform running
 * (ADR-099, ADR-101, ADR-117, ADR-118). A traveller asks the assistant for Lagos to London. The
 * agent service runs as its own process, as production runs it: its LangGraph graph routes the
 * message to the trip builder, which searches flights, places, stays and rental cars through the
 * tool gateway, prepares the cheapest of each and sums them up on one combined trip, and its
 * guard checks the answer. The traveller then enters everyone's details once, pays once on the
 * provider's page, every part is confirmed, and the trip's receipt is ready.
 *
 * Only the model is stood in: a script (apps/agent/src/test) plays the turns a model would,
 * reading the days from the traveller's words and every id from what the tools really returned.
 */
const TOOLS_TOKEN = 'e2e-agent-tools-token-0123456789abcdefghijkl';
const RUN_TOKEN = 'e2e-agent-run-token-0123456789abcdefghijklmn';
const AGENT_DIR = join(__dirname, '..', '..', 'agent');
/** The scripted model's closing answer (whole-trip-script.ts). */
const ANSWER =
  'I prepared the cheapest flight, a hotel in London and a rental car there, and put them on one trip. Open the trip to enter everyone’s details once, then pay for everything in one payment.';

interface Wire {
  amountMinor: number;
  currency: string;
}
interface Card {
  kind: string;
  title: string;
  href: string | null;
  ref?: { type: string; id: string } | null;
}
interface Message {
  role: string;
  kind: string;
  agent: string | null;
  text: string;
  notice: string | null;
  cards: Card[];
}
interface Trip {
  id: string;
  reference: string;
  state: string;
  plan: {
    origin: { code: string };
    destination: { code: string };
    departDate: string;
    returnDate: string;
    adults: number;
    components: string[];
  };
  parts: {
    component: string;
    state: string;
    status: string;
    booking: { id: string; reference: string; total: Wire };
  }[];
  prepared?: { component: string; quoteId: string; price: Wire }[];
  total: Wire;
  totalWithPrepared?: Wire;
  due: Wire;
  receipt?: { paidAt: string; amount: Wire } | null;
}

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });

describe('a whole trip planned with Ask Suskii and paid once (e2e)', () => {
  let ctx: TestContext;
  let agent: ChildProcess | null = null;
  let output = '';
  let ada: TokenSession;

  const stopAgent = async (): Promise<void> => {
    const child = agent;
    agent = null;
    if (child?.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    });
  };

  beforeAll(async () => {
    const agentPort = await freePort();
    const agentUrl = `http://127.0.0.1:${agentPort}`;
    ctx = await createTestApp({
      RATE_LIMIT_ENABLED: false,
      AGENT_ENABLED: true,
      AGENT_SERVICE: 'http',
      AGENT_URL: agentUrl,
      AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
      AGENT_RUN_TOKEN: RUN_TOKEN,
      AGENT_RUN_TIMEOUT_MS: 60_000,
    });
    // The agent service calls the gateway back, so the API listens on a real port.
    await ctx.app.listen(0, '127.0.0.1');
    const { port: apiPort } = ctx.app.getHttpServer().address() as AddressInfo;

    // From source, like agent-service.e2e-spec.ts, with the scripted model in place of a vendor.
    agent = spawn(process.execPath, [require.resolve('tsx/cli'), 'src/test/scripted-service.ts'], {
      cwd: AGENT_DIR,
      env: {
        PATH: process.env.PATH ?? '',
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        AGENT_PORT: String(agentPort),
        API_INTERNAL_URL: `http://127.0.0.1:${apiPort}`,
        AGENT_TOOLS_TOKEN: TOOLS_TOKEN,
        AGENT_RUN_TOKEN: RUN_TOKEN,
        AGENT_DATABASE_URL: process.env.E2E_DATABASE_URL ?? '',
        AGENT_MODEL_PROVIDER: 'mock',
        AGENT_TEST_SCRIPT: 'whole-trip',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    agent.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    agent.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));

    const deadline = Date.now() + 60_000;
    for (;;) {
      if (agent.exitCode !== null) throw new Error(`the agent service stopped: ${output}`);
      const ready = await fetch(`${agentUrl}/ready`)
        .then((response) => response.ok)
        .catch(() => false);
      if (ready) break;
      if (Date.now() > deadline) throw new Error(`the agent service did not start: ${output}`);
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }, 90_000);
  beforeEach(async () => {
    await ctx.background.drain();
    await resetState(ctx);
    // A car to rent at a London branch, published by staff as the fleet's would be.
    const { headers: staff } = await staffSession(ctx, 'whole-trip-ops@suskii.test', [
      'content_manager',
      'operations',
    ]);
    await rentalVehicle(ctx, staff, {
      fields: {
        cityName: 'London',
        branchName: 'Heathrow branch',
        branchAddress: 'Bath Road, Hounslow',
        lat: 51.4706,
        lng: -0.4543,
        timeZone: 'Europe/London',
      },
    });
    ada = await signUp(ctx, 'whole-trip-ada@example.com');
  });
  afterAll(async () => {
    await stopAgent();
    await ctx.background.drain();
    await ctx.close();
  });

  const headers = () => bearer(ada.accessToken);
  const getTrip = async (tripId: string): Promise<Trip> =>
    (await ctx.http().get(`/v1/trips/${tripId}`).set(headers()).expect(200)).body as Trip;

  it('prepares a flight, a stay and a car for Lagos to London, books them from one form, takes one payment and gives a receipt', async () => {
    const depart = inDays(30);
    const back = inDays(37);

    // 1. The traveller asks Ask Suskii.
    const conversation = await ctx
      .http()
      .post('/v1/agent/conversations')
      .set(headers())
      .send({})
      .expect(201);
    const conversationId = (conversation.body as { conversation: { id: string } }).conversation.id;
    const sent = await ctx
      .http()
      .post('/v1/agent/chat')
      .set(headers())
      .send({
        conversationId,
        text: `Plan my trip from Lagos to London for one adult, leaving ${depart} and coming back ${back}. Take the cheapest flight, the cheapest hotel and the cheapest rental car in London, and put them on one trip so I pay once.`,
      })
      .expect(202);
    const runId = (sent.body as { runId: string }).runId;
    await ctx.background.drain();

    // 2. The trip builder answered, after the guard passed its words, with the trip's card.
    const messages = (
      (await ctx.http().get(`/v1/agent/conversations/${conversationId}`).set(headers()).expect(200))
        .body as { messages: Message[] }
    ).messages;
    const answer = messages.at(-1);
    expect(answer).toMatchObject({
      role: 'assistant',
      kind: 'text',
      agent: 'trip_builder',
      text: ANSWER,
      notice: null,
    });
    const run = await ctx.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({
      status: 'succeeded',
      outcome: 'answered',
      agent: 'trip_builder',
      modelProvider: 'mock',
      toolCallCount: 8,
    });
    // Every tool ran through the gateway with the run's grant, in the order a model asked.
    const calls = await ctx.prisma.agentToolCall.findMany({
      where: { runId },
      orderBy: { createdAt: 'asc' },
    });
    expect(calls.map((call) => [call.tool, call.status])).toEqual([
      ['flights.search', 'ok'],
      ['catalog.places', 'ok'],
      ['flights.prepare_booking', 'ok'],
      ['hotels.search', 'ok'],
      ['cars.rentals', 'ok'],
      ['hotels.prepare_booking', 'ok'],
      ['cars.prepare_booking', 'ok'],
      ['trips.prepare_checkout', 'ok'],
    ]);
    const tripCard = answer?.cards.find((card) => card.kind === 'trip');
    // The card opens the form that takes everyone's details once, then the one payment.
    const tripId = /^\/trips\/([0-9a-f-]{36})\/details$/.exec(tripCard?.href ?? '')?.[1] ?? '';
    expect(tripId).not.toBe('');
    // Nothing was booked or paid by the assistant.
    expect(await ctx.prisma.booking.count()).toBe(0);
    expect(await ctx.prisma.payment.count()).toBe(0);

    // 3. The trip holds the three prepared parts, each with its price, and one total.
    const planned = await getTrip(tripId);
    expect(planned.plan).toMatchObject({
      origin: { code: 'LOS' },
      destination: { code: 'LHR' },
      departDate: depart,
      returnDate: back,
      adults: 1,
      components: ['flight', 'hotel', 'car'],
    });
    const prepared = planned.prepared ?? [];
    expect(prepared.map((part) => part.component)).toEqual(['flight', 'hotel', 'car']);
    for (const part of prepared) expect(part.price.amountMinor).toBeGreaterThan(0);
    expect(planned.totalWithPrepared).toEqual({
      amountMinor: prepared.reduce((total, part) => total + part.price.amountMinor, 0),
      currency: 'NGN',
    });

    // 4. Everyone's details once: every prepared part becomes an ordinary booking on the trip.
    const booked = await ctx
      .http()
      .post(`/v1/trips/${tripId}/book`)
      .set('Idempotency-Key', nextKey('e2e-whole-trip-form'))
      .set(headers())
      .send({
        contact: CONTACT,
        travellers: [
          {
            type: 'adult',
            title: 'ms',
            gender: 'f',
            givenNames: 'Ada',
            surname: 'Okafor',
            dateOfBirth: '1988-06-15',
            nationality: 'NG',
            document: { number: 'B1234567', issuingCountry: 'NG', expiryDate: inDays(3000) },
            travellerId: null,
          },
        ],
        termsVersion: BOOKING_TERMS_VERSION,
        acceptTerms: true,
      })
      .expect(200);
    const trip = booked.body as Trip;
    expect(trip.parts.map((part) => [part.component, part.state])).toEqual([
      ['flight', 'to_pay'],
      ['hotel', 'to_pay'],
      ['car', 'to_pay'],
    ]);
    expect(trip.prepared).toEqual([]);
    expect(trip.due).toEqual(trip.total);
    expect(trip.receipt ?? null).toBeNull();

    // 5. One payment for all three, on the provider's page.
    const session = await ctx
      .http()
      .post(`/v1/trips/${tripId}/payments`)
      .set('Idempotency-Key', nextKey('e2e-whole-trip-pay'))
      .set(headers())
      .send({})
      .expect(201);
    expect(session.body).toMatchObject({ parts: 3, amount: trip.total });
    const reference = (session.body.checkoutUrl as string).split('/').pop() ?? '';
    await ctx
      .http()
      .post(`/v1/payments/mock/${reference}/complete`)
      .send({ outcome: 'succeeded' })
      .expect(200);
    await ctx.background.drain();

    // 6. The webhook settled every booking, and each part was confirmed by its own supplier.
    const paid = await getTrip(tripId);
    expect(paid.state).toBe('paid');
    expect(paid.due).toEqual({ amountMinor: 0, currency: 'NGN' });
    expect(paid.parts.map((part) => [part.component, part.status, part.state])).toEqual([
      ['flight', 'CONFIRMED', 'confirmed'],
      ['hotel', 'CONFIRMED', 'confirmed'],
      ['car', 'CONFIRMED', 'confirmed'],
    ]);

    // 7. The receipt: the trip's answer says it is ready, and the PDF says what was paid.
    expect(paid.receipt).toEqual({ paidAt: expect.any(String), amount: paid.total });
    const pdf = await ctx
      .http()
      .get(`/v1/trips/${tripId}/receipt`)
      .set(headers())
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const text = await pdfText(pdf.body as Buffer);
    expect(text).toContain('Receipt');
    expect(text).toContain(paid.reference);
    expect(text).toContain('Payment reference');
    for (const part of paid.parts) expect(text).toContain(part.booking.reference);
    for (const name of ['Flight', 'Hotel', 'Rental car']) expect(text).toContain(name);
    expect(text).toContain('Total paid');
    expect(text).not.toMatch(/Okafor|traveller@example\.com|\+?234\s?801/);

    // The flight's own e-ticket and the stay's voucher are on their bookings, as for any booking.
    const flight = paid.parts.find((part) => part.component === 'flight');
    const documents = await ctx
      .http()
      .get(`/v1/bookings/${flight?.booking.id ?? ''}`)
      .set(headers())
      .expect(200);
    expect(documents.body.status).toBe('CONFIRMED');
  });
});
