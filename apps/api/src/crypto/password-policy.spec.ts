import { PASSWORD_MIN_LENGTH } from '@suskii/shared';

import { ProblemDetailsException } from '../common/problem-details';

import type { BreachedPasswordChecker } from './breached-password';
import { COMMON_PASSWORDS_TEXT } from './common-passwords';
import { PasswordPolicy } from './password-policy';

function policy(breached: (password: string) => boolean = () => false) {
  const calls: string[] = [];
  const checker: BreachedPasswordChecker = {
    isBreached: (password) => {
      calls.push(password);
      return Promise.resolve(breached(password));
    },
  };
  return { policy: new PasswordPolicy(checker), calls };
}

async function slugOf(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof ProblemDetailsException) return error.slug;
    throw error;
  }
}

describe('PasswordPolicy (ASVS V6.2.4, V6.2.11, V6.2.12)', () => {
  it('bundles at least the 3000 most used passwords that meet the length policy', () => {
    const list = COMMON_PASSWORDS_TEXT.split('\n');
    expect(list.length).toBeGreaterThanOrEqual(3000);
    expect(list.every((entry) => entry.length >= PASSWORD_MIN_LENGTH)).toBe(true);
    expect(list.every((entry) => entry === entry.toLowerCase())).toBe(true);
    expect(new Set(list).size).toBe(list.length);
  });

  it('refuses common passwords in any case without asking HIBP', async () => {
    const { policy: check, calls } = policy();
    for (const password of ['1q2w3e4r5t', 'QWERTYUIOP', 'Password1234', 'basketball']) {
      expect(await slugOf(check.check(password))).toBe('password-breached');
    }
    expect(calls).toEqual([]);
  });

  it('refuses the brand and the account holder’s own details', async () => {
    const { policy: check } = policy();
    expect(await slugOf(check.check('SuskiiTravels2026'))).toBe('password-guessable');
    expect(
      await slugOf(check.check('ngozi.okafor.1990', { email: 'ngozi.okafor@example.com' })),
    ).toBe('password-guessable');
    expect(await slugOf(check.check('chukwuemeka-rules', { displayName: 'Chukwuemeka Obi' }))).toBe(
      'password-guessable',
    );
  });

  it('still consults HIBP for everything else and accepts passphrases', async () => {
    const { policy: check, calls } = policy((password) => password === 'leaked but long');
    expect(await slugOf(check.check('leaked but long'))).toBe('password-breached');
    expect(await slugOf(check.check('correct horse battery staple'))).toBeNull();
    expect(calls).toEqual(['leaked but long', 'correct horse battery staple']);
  });
});
