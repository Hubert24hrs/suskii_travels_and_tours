import { describe, expect, it } from 'vitest';

import {
  emailSchema,
  loginRequestSchema,
  passwordSchema,
  phoneSchema,
  registerRequestSchema,
} from './auth';

describe('auth schemas', () => {
  it('normalises emails', () => {
    expect(emailSchema.parse('  Ada@Example.COM ')).toBe('ada@example.com');
    expect(emailSchema.safeParse('not-an-email').success).toBe(false);
  });

  it('enforces 10 to 128 character passwords', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('long enough pass').success).toBe(true);
    expect(passwordSchema.safeParse('x'.repeat(129)).success).toBe(false);
  });

  it('accepts only E.164 phone numbers', () => {
    expect(phoneSchema.parse(' +2348012345678 ')).toBe('+2348012345678');
    expect(phoneSchema.safeParse('08012345678').success).toBe(false);
  });

  it('strips unknown fields from registrations (no mass assignment)', () => {
    const parsed = registerRequestSchema.parse({
      email: 'a@b.co',
      password: 'correct horse',
      isAdmin: true,
    });
    expect(parsed).toStrictEqual({ email: 'a@b.co', password: 'correct horse' });
  });

  it('does not apply the password policy on login and defaults the transport to token', () => {
    expect(loginRequestSchema.parse({ email: 'a@b.co', password: 'x' })).toStrictEqual({
      email: 'a@b.co',
      password: 'x',
      transport: 'token',
    });
  });
});
