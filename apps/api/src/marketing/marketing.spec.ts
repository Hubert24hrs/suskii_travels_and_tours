import { createHash } from 'node:crypto';

import { parseEnv } from '../config/env.schema';

import {
  hashEmail,
  hashPhone,
  MockAdConversions,
  type PurchaseEvent,
} from './ad-conversions.provider';
import { adConversionsProviders } from './marketing.module';
import { MetaConversions } from './meta/meta-conversions';
import { TikTokEvents } from './tiktok/tiktok-events';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const TOKEN = 'token-that-must-never-appear-in-a-url-0123';
const ENV = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
};

const event: PurchaseEvent = {
  eventId: '0192d3a0-7c1e-7b2a-9f00-1234567890ab',
  eventTime: new Date('2026-10-28T10:00:00Z'),
  value: '125000.50',
  currency: 'NGN',
  sourceUrl: 'https://suskii.example/bookings/0192d3a0-7c1e-7b2a-9f00-1234567890ab',
  contentIds: ['flight'],
  hashedEmail: sha256('ada@example.com'),
  hashedPhone: sha256('2348012345678'),
  clickIds: {
    fbp: 'fb.1.1714546784212.1116446470',
    fbc: 'fb.1.1714546784212.IwAR2F4',
    ttp: '2Kx4mP9qLzQ0aBcDeFgHiJ',
    ttclid: 'E.C.P.CsoBhTkQ',
  },
};

interface Captured {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, body: unknown): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const impl: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push({ url, init: init ?? {} });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { fetch: impl, calls };
}

const bodyOf = (call: Captured | undefined): Record<string, unknown> => {
  const raw = call?.init.body;
  return JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown>;
};

describe('hashing for ad networks (ADR-079)', () => {
  it('normalises before hashing: trimmed lower-case email, digits-only phone', () => {
    expect(hashEmail('  Ada@Example.COM ')).toBe(sha256('ada@example.com'));
    expect(hashPhone('+234 801 234 5678')).toBe(sha256('2348012345678'));
    expect(hashPhone('00234-801-234-5678')).toBe(sha256('2348012345678'));
  });

  it('sends nothing for values that cannot match anyone', () => {
    expect(hashEmail('not an email')).toBeNull();
    expect(hashPhone('12')).toBeNull();
  });
});

describe('MetaConversions', () => {
  const meta = (fetchImpl: typeof fetch, testEventCode?: string) =>
    new MetaConversions({
      baseUrl: 'https://graph.facebook.com/v24.0',
      pixelId: '1234567890',
      accessToken: TOKEN,
      testEventCode,
      fetch: fetchImpl,
    });

  it('posts one Purchase with hashed contact, click ids and the event id; the token stays out of the URL', async () => {
    const { fetch, calls } = fakeFetch(200, { events_received: 1 });
    await meta(fetch, 'TEST123').sendPurchase(event, AbortSignal.timeout(1000));
    const [call] = calls;
    expect(call?.url).toBe('https://graph.facebook.com/v24.0/1234567890/events');
    expect(call?.url).not.toContain(TOKEN);
    expect(call?.init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect(bodyOf(call)).toEqual({
      data: [
        {
          event_name: 'Purchase',
          event_time: 1_793_181_600,
          event_id: event.eventId,
          action_source: 'website',
          event_source_url: event.sourceUrl,
          user_data: {
            em: [event.hashedEmail],
            ph: [event.hashedPhone],
            fbp: event.clickIds.fbp,
            fbc: event.clickIds.fbc,
          },
          custom_data: {
            currency: 'NGN',
            value: 125000.5,
            content_type: 'product',
            content_ids: ['flight'],
          },
        },
      ],
      access_token: TOKEN,
      test_event_code: 'TEST123',
    });
  });

  it('leaves out what it does not have and refuses an unaccepted event', async () => {
    const { fetch, calls } = fakeFetch(200, { events_received: 1 });
    await meta(fetch).sendPurchase(
      { ...event, hashedPhone: null, clickIds: {} },
      AbortSignal.timeout(1000),
    );
    const body = bodyOf(calls[0]);
    expect((body.data as { user_data: unknown }[])[0]?.user_data).toEqual({
      em: [event.hashedEmail],
    });
    expect(body).not.toHaveProperty('test_event_code');

    await expect(
      meta(fakeFetch(200, { events_received: 0 }).fetch).sendPurchase(
        event,
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('did not accept');
    // Only the status reaches the error, never the body (which can echo request values).
    await expect(
      meta(fakeFetch(400, { error: { message: TOKEN } }).fetch).sendPurchase(
        event,
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('Meta Conversions API answered HTTP 400');
  });
});

describe('TikTokEvents', () => {
  const tiktok = (fetchImpl: typeof fetch) =>
    new TikTokEvents({
      baseUrl: 'https://business-api.tiktok.com/open_api/v1.3',
      pixelId: 'C0TESTPIXEL0001',
      accessToken: TOKEN,
      fetch: fetchImpl,
    });

  it('posts one web Purchase with the token in its header', async () => {
    const { fetch, calls } = fakeFetch(200, { code: 0, message: 'OK' });
    await tiktok(fetch).sendPurchase(event, AbortSignal.timeout(1000));
    const [call] = calls;
    expect(call?.url).toBe('https://business-api.tiktok.com/open_api/v1.3/event/track/');
    expect(call?.init.headers).toMatchObject({ 'Access-Token': TOKEN });
    expect(bodyOf(call)).toEqual({
      event_source: 'web',
      event_source_id: 'C0TESTPIXEL0001',
      data: [
        {
          event: 'Purchase',
          event_time: 1_793_181_600,
          event_id: event.eventId,
          user: {
            email: event.hashedEmail,
            phone: event.hashedPhone,
            ttp: event.clickIds.ttp,
            ttclid: event.clickIds.ttclid,
          },
          properties: {
            currency: 'NGN',
            value: 125000.5,
            content_type: 'product',
            contents: [{ content_id: 'flight' }],
          },
          page: { url: event.sourceUrl },
        },
      ],
    });
  });

  it('treats a non-zero code as a refusal, even with HTTP 200', async () => {
    await expect(
      tiktok(fakeFetch(200, { code: 40001, message: 'bad' }).fetch).sendPurchase(
        event,
        AbortSignal.timeout(1000),
      ),
    ).rejects.toThrow('did not accept');
  });
});

describe('adConversionsProviders', () => {
  it('builds one adapter per configured network, and none by default', () => {
    expect(adConversionsProviders(parseEnv(ENV))).toEqual([]);
    const providers = adConversionsProviders(
      parseEnv({
        ...ENV,
        AD_CONVERSIONS: 'mock,meta,tiktok',
        META_PIXEL_ID: '1234567890',
        META_CAPI_ACCESS_TOKEN: TOKEN,
        TIKTOK_PIXEL_ID: 'C0TESTPIXEL0001',
        TIKTOK_EVENTS_ACCESS_TOKEN: TOKEN,
      }),
    );
    expect(providers.map((provider) => provider.network)).toEqual(['mock', 'meta', 'tiktok']);
    expect(providers[0]).toBeInstanceOf(MockAdConversions);
  });

  it('needs the id and token of each network', () => {
    expect(() => parseEnv({ ...ENV, AD_CONVERSIONS: 'meta' })).toThrow(/META_PIXEL_ID/);
    expect(() =>
      parseEnv({ ...ENV, AD_CONVERSIONS: 'tiktok', TIKTOK_PIXEL_ID: 'C0TESTPIXEL0001' }),
    ).toThrow(/TIKTOK_EVENTS_ACCESS_TOKEN/);
  });
});
