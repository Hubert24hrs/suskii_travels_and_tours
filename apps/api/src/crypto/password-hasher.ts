import { hash, parseOptions, verify, type Algorithm, type Options } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

// `Algorithm` is an ambient const enum, which isolatedModules cannot inline; 2 is Argon2id.
const ARGON2ID = 2 as Algorithm;

/** OWASP Password Storage Cheat Sheet: argon2id, m=19 MiB, t=2, p=1. */
const OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
};

@Injectable()
export class PasswordHasher {
  private dummyHash: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password, OPTIONS);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false;
    }
  }

  /**
   * Burns the same time as a real verification, so responses for unknown accounts cannot be
   * told apart from wrong passwords by timing.
   */
  async verifyDummy(password: string): Promise<false> {
    this.dummyHash ??= hash('suskii-timing-equaliser', OPTIONS);
    await this.verify(await this.dummyHash, password);
    return false;
  }

  /** True when a stored hash uses weaker parameters than the current policy. */
  needsRehash(passwordHash: string): boolean {
    try {
      const parsed = parseOptions(passwordHash);
      return (
        parsed.algorithm !== OPTIONS.algorithm ||
        parsed.memoryCost < (OPTIONS.memoryCost ?? 0) ||
        parsed.timeCost < (OPTIONS.timeCost ?? 0)
      );
    } catch {
      return true;
    }
  }
}
