import { randomBytes, randomUUID } from 'node:crypto';

import { PERSONAS, type Persona, type PersonaKey, type StackState } from './personas';
import { totp } from './totp';

/**
 * Creates the e2e data through the public and admin API, as a real deployment would get it:
 * staff accounts (roles granted by the seeded super admin, authenticators enrolled with the
 * current code), a paid guest tour booking and a paid visa assistance booking. Passwords and
 * authenticator keys are random per run and only written to the gitignored test-results folder.
 */

type Json = Record<string, unknown>;

class Api {
  constructor(private readonly baseUrl: string) {}

  async call<T = Json>(
    method: string,
    path: string,
    { body, headers = {} }: { body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  /** Uploads a raw request body (driver documents are sent as the file bytes, not JSON). */
  async upload(path: string, body: Buffer, contentType: string, token: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'PUT',
      headers: { 'content-type': contentType, ...bearer(token) },
      body: new Uint8Array(body),
    });
    if (!response.ok) {
      throw new Error(
        `PUT ${path} answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
      );
    }
  }
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
const password = () => `e2e-${randomBytes(12).toString('base64url')}-staff`;
const isoDaysFromToday = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

interface SignIn {
  status: string;
  mfaToken?: string;
  accessToken?: string;
  user?: { id: string };
}

/** Registration answers 202 before the account exists in every case, so sign-in is retried. */
async function signIn(api: Api, email: string, secretPassword: string): Promise<SignIn> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await api.call<SignIn>('POST', '/v1/auth/login', {
        body: { email, password: secretPassword },
      });
    } catch (error) {
      if (attempt >= 20) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
  }
}

async function enrol(api: Api, accessToken: string): Promise<string> {
  const setup = await api.call<{ secret: string }>('POST', '/v1/me/mfa/totp', {
    headers: bearer(accessToken),
  });
  await api.call('POST', '/v1/me/mfa/totp/confirm', {
    headers: bearer(accessToken),
    body: { code: totp(setup.secret) },
  });
  return setup.secret;
}

/** The seeded super admin with an MFA-verified bearer session (enrols on first use). */
async function rootSession(api: Api, email: string, rootPassword: string): Promise<string> {
  const first = await signIn(api, email, rootPassword);
  if (!first.accessToken) throw new Error('The seeded super admin should not have MFA yet');
  const secret = await enrol(api, first.accessToken);
  const pending = await signIn(api, email, rootPassword);
  // The enrolment used the current step; the next one is still inside the accepted window.
  const verified = await api.call<{ accessToken: string }>('POST', '/v1/auth/mfa/verify', {
    body: { mfaToken: pending.mfaToken, code: totp(secret, 1), transport: 'token' },
  });
  return verified.accessToken;
}

async function createPersona(api: Api, root: string, key: PersonaKey): Promise<Persona> {
  const spec = PERSONAS[key];
  const email = `${key}@e2e.suskii.test`;
  const secretPassword = password();
  // The mock Turnstile verifier accepts any token but `fail`.
  await api.call('POST', '/v1/auth/register', {
    body: { email, password: secretPassword, turnstileToken: 'e2e-turnstile' },
  });
  let session = await signIn(api, email, secretPassword);
  const id = session.user?.id;
  if (!id) throw new Error(`No user id for ${email}`);
  if (spec.roles.length > 0) {
    // Changing roles signs the user out everywhere, so it happens before the persona's session.
    await api.call('PUT', `/v1/admin/users/${id}/roles`, {
      headers: bearer(root),
      body: { roles: spec.roles },
    });
    session = await signIn(api, email, secretPassword);
  }
  let secret: string | null = null;
  if (spec.enrolled) {
    if (!session.accessToken) throw new Error(`Unexpected MFA challenge for ${email}`);
    secret = await enrol(api, session.accessToken);
  }
  return { id, email, password: secretPassword, secret };
}

const TRAVELLER = {
  type: 'adult',
  title: 'ms',
  gender: 'f',
  givenNames: 'Ada',
  surname: 'Eze',
  dateOfBirth: '1990-01-01',
  nationality: 'NG',
  document: { number: 'A7654321', issuingCountry: 'NG', expiryDate: '2034-01-01' },
} as const;

/** Books a quote as a guest and pays it through the mock provider's signed-webhook path. */
/** A foreign card used from Ghana: held by the payment risk review (ADR-040, see stack.ts). */
const RISKY = { country: 'GH', card: { country: 'NG', fingerprint: 'e2e-risky-card' } } as const;

async function bookAndPay(
  api: Api,
  quote: { quoteId: string; termsVersion: string },
  email: string,
  risky = false,
): Promise<{ id: string; reference: string }> {
  const created = await api.call<{
    booking: { id: string; reference: string };
    accessToken: string;
  }>('POST', '/v1/bookings', {
    headers: { 'Idempotency-Key': randomUUID() },
    body: {
      quoteId: quote.quoteId,
      contact: { email, phone: '+2348012345678' },
      passengers: [TRAVELLER],
      termsVersion: quote.termsVersion,
      acceptTerms: true,
      turnstileToken: 'e2e',
    },
  });
  const token = { 'X-Booking-Token': created.accessToken };
  const payment = await api.call<{ checkoutUrl: string }>(
    'POST',
    `/v1/bookings/${created.booking.id}/payments`,
    {
      headers: {
        ...token,
        'Idempotency-Key': randomUUID(),
        ...(risky ? { 'cf-ipcountry': RISKY.country } : {}),
      },
      body: {},
    },
  );
  const reference = new URL(payment.checkoutUrl).pathname.split('/').at(-1);
  await api.call('POST', `/v1/payments/mock/${reference}/complete`, {
    body: { outcome: 'succeeded', ...(risky ? { card: RISKY.card } : {}) },
  });
  return created.booking;
}

async function waitForApplication(api: Api, root: string, reference: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const list = await api.call<{ applications: { id: string; bookingReference: string }[] }>(
      'GET',
      '/v1/admin/visa-applications?status=awaiting_documents',
      { headers: bearer(root) },
    );
    const application = list.applications.find(
      (candidate) => candidate.bookingReference === reference,
    );
    if (application) return application.id;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('The paid visa booking opened no application');
}

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d4944415478da63f8ffff3f0005fe02fe0dd8a8820000000049454e44ae426082',
  'hex',
);
const DRIVER_DOCUMENTS = [
  'licence',
  'vehicle_registration',
  'insurance',
  'roadworthiness',
  'selfie',
] as const;
const digits = (length: number) =>
  Array.from(randomBytes(length), (byte) => String(byte % 10)).join('');

/**
 * An application to drive with every document uploaded and one vehicle, as the driver app sends
 * it. The mock KYC provider verifies identity and licence (numbers not starting 000, 999 or 555);
 * the documents' background scan has to finish before a reviewer can approve them.
 */
async function applyToDrive(
  api: Api,
  root: string,
  applicant: Persona,
): Promise<{ id: string; name: string }> {
  const session = await signIn(api, applicant.email, applicant.password);
  if (!session.accessToken) throw new Error('The applicant should not have MFA');
  const token = session.accessToken;
  const applied = await api.call<{ id: string; givenNames: string; surname: string }>(
    'POST',
    '/v1/drivers/applications',
    {
      headers: bearer(token),
      body: {
        givenNames: 'Chinedu',
        surname: 'Okeke',
        dateOfBirth: '1990-04-12',
        cityName: 'Lagos',
        nin: `1${digits(10)}`,
        licenceNumber: `LAG${digits(9)}`,
        licenceExpiresOn: '2031-06-30',
      },
    },
  );
  for (const kind of DRIVER_DOCUMENTS) {
    await api.upload(`/v1/drivers/me/documents/${kind}`, PNG, 'image/png', token);
  }
  await api.call('POST', '/v1/drivers/me/vehicles', {
    headers: bearer(token),
    body: {
      make: 'Toyota',
      model: 'Camry',
      year: 2018,
      colour: 'Black',
      plate: `KJA-${digits(3)}-AB`,
      category: 'standard',
      seats: 4,
      insuranceExpiresOn: '2030-12-31',
    },
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const driver = await api.call<{ documents: { status: string }[] }>(
      'GET',
      `/v1/admin/drivers/${applied.id}`,
      { headers: bearer(root) },
    );
    if (driver.documents.every((document) => document.status === 'clean')) {
      return { id: applied.id, name: `${applied.givenNames} ${applied.surname}` };
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  throw new Error('The driver documents were not scanned');
}

export async function provision(
  apiUrl: string,
  root: { email: string; password: string },
): Promise<Omit<StackState, 'databaseUrl'>> {
  const api = new Api(apiUrl);
  const rootToken = await rootSession(api, root.email, root.password);

  const personas = {} as Record<PersonaKey, Persona>;
  for (const key of Object.keys(PERSONAS) as PersonaKey[]) {
    personas[key] = await createPersona(api, rootToken, key);
  }

  const tours = await api.call<{ tours: { slug: string }[] }>('GET', '/v1/tours?adults=1');
  const [booked, watched] = tours.tours;
  if (!booked || !watched) throw new Error('The demo seed should publish at least two tours');
  const detail = await api.call<{ departures: { id: string; bookable: boolean }[] }>(
    'GET',
    `/v1/tours/${booked.slug}?adults=1`,
  );
  const departure = detail.departures.find((candidate) => candidate.bookable);
  if (!departure) throw new Error(`No bookable departure for ${booked.slug}`);
  const tourQuote = await api.call<{ quoteId: string; termsVersion: string }>(
    'POST',
    '/v1/inhouse-quotes',
    {
      body: {
        kind: 'tour',
        departureId: departure.id,
        travellers: { adults: 1, children: 0, infants: 0 },
      },
    },
  );
  const tourBooking = await bookAndPay(api, tourQuote, 'ada.tour@example.com');
  const heldQuote = await api.call<{ quoteId: string; termsVersion: string }>(
    'POST',
    '/v1/inhouse-quotes',
    {
      body: {
        kind: 'tour',
        departureId: departure.id,
        travellers: { adults: 1, children: 0, infants: 0 },
      },
    },
  );
  const heldBooking = await bookAndPay(api, heldQuote, 'ada.held@example.com', true);

  const products = await api.call<{ products: { id: string }[] }>(
    'GET',
    '/v1/visa/products?destination=AE',
  );
  const product = products.products[0];
  if (!product) throw new Error('The demo seed should publish a visa product for AE');
  const visaQuote = await api.call<{ quoteId: string; termsVersion: string }>(
    'POST',
    '/v1/inhouse-quotes',
    {
      body: {
        kind: 'visa',
        productId: product.id,
        purpose: 'tourism',
        nationality: 'NG',
        travelDate: isoDaysFromToday(40),
        travellers: { adults: 1, children: 0, infants: 0 },
      },
    },
  );
  const visaBooking = await bookAndPay(api, visaQuote, 'ada.visa@example.com');
  const applicationId = await waitForApplication(api, rootToken, visaBooking.reference);
  const driver = await applyToDrive(api, rootToken, personas.applicant);

  return {
    personas,
    tourBooking,
    heldBooking,
    visa: { bookingId: visaBooking.id, applicationId },
    tourSlug: watched.slug,
    driver,
  };
}
