import { generateKeyPairSync } from 'node:crypto';

import { NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { decodePolyline, haversineMetres, money } from '@suskii/shared';

import type { AppConfig } from '../config/config';
import { parseEnv } from '../config/env.schema';

import { CarsFeatureGuard, CarsFeatureRoute, CarsFlags, carsFeatureEnabled } from './cars-flags';
import { MockKycProvider } from './kyc';
import { MockMapsProvider, RouteTooLongError, RoutingService, straightLineEstimate } from './maps';
import { MockPayoutProvider } from './payouts';
import { TicketSigner } from './ticket-signer';

const env = (extra: Record<string, string> = {}): AppConfig =>
  parseEnv({
    DATABASE_URL: 'postgresql://suskii:pw@localhost:5432/suskii',
    REDIS_URL: 'redis://localhost:6379',
    ...extra,
  });

const IKEJA = { lat: 6.6018, lng: 3.3515 };
const LEKKI = { lat: 6.4698, lng: 3.5852 };
const ABUJA = { lat: 9.0765, lng: 7.3986 };

const base64Pem = (pem: string | Buffer): string => Buffer.from(pem).toString('base64');

describe('Cars flags (ADR-049)', () => {
  it('turns products on outside production and off in production unless set', () => {
    expect(carsFeatureEnabled(env(), 'rides')).toBe(true);
    expect(carsFeatureEnabled(env({ CARS_RIDES_ENABLED: 'false' }), 'rides')).toBe(false);
    const production = { ...env(), NODE_ENV: 'production' } as AppConfig;
    expect(carsFeatureEnabled(production, 'buses')).toBe(false);
    expect(carsFeatureEnabled({ ...production, CARS_BUSES_ENABLED: true }, 'buses')).toBe(true);
  });

  it('widens the service area for West Africa', () => {
    expect(new CarsFlags(env()).serviceArea.minLng).toBeGreaterThan(0);
    expect(
      new CarsFlags(env({ CARS_WEST_AFRICA_ENABLED: 'true' })).serviceArea.minLng,
    ).toBeLessThan(0);
  });

  it('answers 404 on routes of a switched-off product', () => {
    class Routes {
      @CarsFeatureRoute('rentals')
      list(): string {
        return 'rentals';
      }
      open(): string {
        return 'open';
      }
    }
    const context = (handler: () => string): ExecutionContext =>
      ({ getHandler: () => handler, getClass: () => Routes }) as unknown as ExecutionContext;
    const off = new CarsFeatureGuard(
      new Reflector(),
      new CarsFlags(env({ CARS_RENTALS_ENABLED: 'false' })),
    );
    expect(() => off.canActivate(context(Routes.prototype.list))).toThrow(NotFoundException);
    expect(off.canActivate(context(Routes.prototype.open))).toBe(true);
    const on = new CarsFeatureGuard(new Reflector(), new CarsFlags(env()));
    expect(on.canActivate(context(Routes.prototype.list))).toBe(true);
  });
});

describe('TicketSigner (ADR-050)', () => {
  const claims = { tid: 'ticket-1', trp: 'trip-1', st: '3A', nbf: 1_000, exp: 2_000 };
  const at = (seconds: number) => new Date(seconds * 1000);

  it('signs ids and a window, and verifies them', () => {
    const signer = new TicketSigner(env());
    signer.onModuleInit();
    const payload = signer.sign(claims);
    expect(payload.startsWith('SUSKII-T1.')).toBe(true);
    expect(signer.verify(payload, at(1_500))).toEqual({ valid: true, claims });
    expect(signer.verify(payload, at(999))).toEqual({ valid: false, reason: 'not_yet_valid' });
    expect(signer.verify(payload, at(2_001))).toEqual({ valid: false, reason: 'expired' });
  });

  it('rejects tampered, foreign and malformed payloads', () => {
    const signer = new TicketSigner(env());
    signer.onModuleInit();
    const [prefix, kid, body, signature] = signer.sign(claims).split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, st: '1A' })).toString('base64url');
    expect(signer.verify([prefix, kid, forged, signature].join('.'), at(1_500))).toEqual({
      valid: false,
      reason: 'bad_signature',
    });
    expect(
      signer.verify([prefix, 'ffffffffffffffff', body, signature].join('.'), at(1_500)),
    ).toEqual({ valid: false, reason: 'unknown_key' });
    expect(signer.verify('SUSKII-V1:ABC', at(1_500))).toEqual({
      valid: false,
      reason: 'malformed',
    });
    const other = new TicketSigner(env());
    other.onModuleInit();
    expect(other.verify(signer.sign(claims), at(1_500)).valid).toBe(false);
  });

  it('keeps verifying tickets signed with a previous key after a rotation', () => {
    const old = generateKeyPairSync('ed25519');
    const before = new TicketSigner(
      env({
        CARS_TICKET_SIGNING_KEY: base64Pem(old.privateKey.export({ type: 'pkcs8', format: 'pem' })),
      }),
    );
    before.onModuleInit();
    const ticket = before.sign(claims);
    const after = new TicketSigner(
      env({
        CARS_TICKET_PREVIOUS_PUBLIC_KEYS: base64Pem(
          old.publicKey.export({ type: 'spki', format: 'pem' }),
        ),
      }),
    );
    after.onModuleInit();
    expect(after.verify(ticket, at(1_500)).valid).toBe(true);
    expect(after.keys()).toHaveLength(2);
  });

  it('refuses a signing key that is not Ed25519', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const signer = new TicketSigner(
      env({
        CARS_TICKET_SIGNING_KEY: base64Pem(rsa.privateKey.export({ type: 'pkcs8', format: 'pem' })),
      }),
    );
    expect(() => signer.onModuleInit()).toThrow(/Ed25519/);
  });
});

describe('RoutingService (ADR-053)', () => {
  it('uses the provider and falls back to the straight-line estimate on failure', async () => {
    const mock = new MockMapsProvider();
    const routing = new RoutingService(env(), mock);
    const routed = await routing.route(IKEJA, LEKKI);
    expect(routed.estimate).toBe('routed');
    expect(decodePolyline(routed.polyline)).toHaveLength(3);
    mock.failNext = 1;
    const fallback = await routing.route(IKEJA, LEKKI);
    expect(fallback.estimate).toBe('straight_line');
    expect(fallback.distanceMetres).toBe(Math.round(haversineMetres(IKEJA, LEKKI) * 1.4));
    expect(fallback).toEqual(straightLineEstimate(IKEJA, LEKKI));
  });

  it('refuses trips over the maximum, and fallback trips over the fallback cap', async () => {
    const mock = new MockMapsProvider();
    await expect(new RoutingService(env(), mock).route(IKEJA, ABUJA)).rejects.toBeInstanceOf(
      RouteTooLongError,
    );
    mock.failNext = 1;
    await expect(
      new RoutingService(env({ RIDE_FALLBACK_MAX_KM: '10' }), mock).route(IKEJA, LEKKI),
    ).rejects.toBeInstanceOf(RouteTooLongError);
  });
});

describe('mock KYC and payouts', () => {
  it('exercises every KYC outcome without echoing numbers', async () => {
    const kyc = new MockKycProvider();
    const person = { givenNames: 'Ada', surname: 'Obi', dateOfBirth: '1990-01-01' };
    const verified = await kyc.verifyIdentity({ ...person, nin: '12345678901' });
    expect(verified.outcome).toBe('verified');
    expect(verified.reference).not.toContain('12345678901');
    expect((await kyc.verifyIdentity({ ...person, nin: '00045678901' })).outcome).toBe('not_found');
    expect(
      (
        await kyc.verifyLicence({
          licenceNumber: '999ABC',
          surname: 'Obi',
          expiresOn: '2030-01-01',
        })
      ).outcome,
    ).toBe('mismatch');
  });

  it('pays once per reference', async () => {
    const payouts = new MockPayoutProvider();
    const request = {
      reference: 'payout:1',
      amount: money(500_000n, 'NGN'),
      bankCode: '058',
      accountNumber: '0123456789',
      accountName: 'Ada Obi',
    };
    const first = await payouts.send(request);
    expect(first.status).toBe('paid');
    expect(await payouts.send({ ...request, accountNumber: '0000000000' })).toEqual(first);
    expect(
      (await payouts.send({ ...request, reference: 'payout:2', accountNumber: '1110000' })).status,
    ).toBe('failed');
  });
});
