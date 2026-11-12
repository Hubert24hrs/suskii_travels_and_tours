import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';

import {
  AGENT_AUDIENCES,
  AGENT_CHANNELS,
  AGENT_SCOPES,
  ROLES,
  type AgentAudience,
  type AgentChannel,
  type AgentScope,
  type Role,
} from '@suskii/shared';

import { APP_CONFIG, type AppConfig } from '../config/config';
import { agentGrantContext } from '../crypto/encryption-contexts';
import { FieldEncryption } from '../crypto/field-encryption';

/** A grant is a few hundred bytes; anything far longer is not one of ours. */
const MAX_GRANT_LENGTH = 4096;

/**
 * Who a run acts for and what it may reach (ADR-101). The API writes it when a run starts and
 * reads it back on every tool call; the agent service carries it and cannot read or change it.
 */
export interface AgentGrant {
  runId: string;
  conversationId: string | null;
  /** The signed-in caller; null for a guest. Never taken from the model or the agent service. */
  userId: string | null;
  roles: Role[];
  audience: AgentAudience;
  channel: AgentChannel;
  scopes: AgentScope[];
  locale: string;
  currency: string;
  /** The edge's country when the run started. */
  country: string | null;
  expiresAt: Date;
}

const sealed = z.object({
  v: z.literal(1),
  r: z.uuid(),
  c: z.uuid().nullable(),
  u: z.uuid().nullable(),
  o: z.array(z.enum(ROLES)).max(ROLES.length),
  a: z.enum(AGENT_AUDIENCES),
  h: z.enum(AGENT_CHANNELS),
  s: z.array(z.enum(AGENT_SCOPES)).max(AGENT_SCOPES.length),
  l: z.string().min(2).max(12),
  m: z.string().regex(/^[A-Z]{3}$/),
  k: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .nullable(),
  e: z.number().int().positive(),
});

/**
 * Seals and opens grants: AES-256-GCM envelopes under the field encryption key ring with the
 * context `agent-grant`, so a grant cannot be read, altered or forged outside the API, and a
 * ciphertext from any other column never opens as one.
 */
@Injectable()
export class AgentGrants {
  constructor(
    private readonly encryption: FieldEncryption,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** A grant for a run that starts now, valid for `AGENT_GRANT_TTL_SECONDS`. */
  issue(grant: Omit<AgentGrant, 'expiresAt'>, now = Date.now()): string {
    return this.seal({
      ...grant,
      expiresAt: new Date(now + this.config.AGENT_GRANT_TTL_SECONDS * 1000),
    });
  }

  seal(grant: AgentGrant): string {
    const payload: z.infer<typeof sealed> = {
      v: 1,
      r: grant.runId,
      c: grant.conversationId,
      u: grant.userId,
      o: grant.roles,
      a: grant.audience,
      h: grant.channel,
      s: grant.scopes,
      l: grant.locale,
      m: grant.currency,
      k: grant.country,
      e: grant.expiresAt.getTime(),
    };
    return this.encryption.encrypt(JSON.stringify(payload), agentGrantContext());
  }

  /** The grant, or null when the token is not ours, was altered or has expired. */
  open(token: string, now = Date.now()): AgentGrant | null {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_GRANT_LENGTH) {
      return null;
    }
    let payload: z.infer<typeof sealed>;
    try {
      const parsed = sealed.safeParse(
        JSON.parse(this.encryption.decrypt(token, agentGrantContext())),
      );
      if (!parsed.success) return null;
      payload = parsed.data;
    } catch {
      return null;
    }
    if (payload.e <= now) return null;
    return {
      runId: payload.r,
      conversationId: payload.c,
      userId: payload.u,
      roles: payload.o,
      audience: payload.a,
      channel: payload.h,
      scopes: payload.s,
      locale: payload.l,
      currency: payload.m,
      country: payload.k,
      expiresAt: new Date(payload.e),
    };
  }
}
