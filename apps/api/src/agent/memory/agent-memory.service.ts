import { HttpStatus, Injectable } from '@nestjs/common';

import {
  AGENT_MEMORY_KEYS,
  agentMemoryAirlines,
  agentMemoryValue,
  type AgentMemoryKey,
} from '@suskii/shared';

import { AuditService } from '../../audit/audit.service';
import { CatalogService } from '../../catalog/catalog.service';
import { ProblemDetailsException } from '../../common/problem-details';
import type { RequestContext } from '../../common/request-context';
import { uuidv7 } from '../../common/uuid';
import { PrismaService } from '../../infra/prisma.service';

import type { AgentMemoryDto } from './agent-memory.schemas';

export type AgentMemorySource = 'traveller' | 'assistant';

const memoryOff = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.CONFLICT,
    'agent-memory-off',
    'The assistant is not remembering preferences',
    'Turn it on first: nothing is kept without your say.',
  );

const invalid = (): ProblemDetailsException =>
  new ProblemDetailsException(
    HttpStatus.UNPROCESSABLE_ENTITY,
    'agent-memory-invalid',
    'That is not a value this preference takes',
  );

/**
 * The travel preferences the assistant remembers (ADR-105): a short list of named values kept
 * only for a traveller who agreed, who sees every one, changes any and erases any. Turning it
 * off erases them all. A value is one of a fixed set, or a code that names a real airport or
 * airline: there is nowhere to write a sentence, so nothing personal ends up here.
 */
@Injectable()
export class AgentMemoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: CatalogService,
    private readonly audit: AuditService,
  ) {}

  async get(userId: string): Promise<AgentMemoryDto> {
    const [preference, rows] = await Promise.all([
      this.prisma.userPreference.findUnique({
        where: { userId },
        select: { assistantMemoryAt: true },
      }),
      this.prisma.agentMemory.findMany({ where: { userId } }),
    ]);
    const enabledAt = preference?.assistantMemoryAt ?? null;
    return {
      enabled: enabledAt !== null,
      enabledAt: enabledAt?.toISOString() ?? null,
      // In the list's own order, and nothing while it is off (there is nothing then).
      items: enabledAt
        ? AGENT_MEMORY_KEYS.flatMap((key) => {
            const row = rows.find((candidate) => candidate.key === key);
            return row
              ? [
                  {
                    key,
                    value: row.value,
                    source:
                      row.source === 'assistant' ? ('assistant' as const) : ('traveller' as const),
                    updatedAt: row.updatedAt.toISOString(),
                  },
                ]
              : [];
          })
        : [],
    };
  }

  /** The traveller agrees, or withdraws: withdrawing erases what was remembered. */
  async setEnabled(
    userId: string,
    enabled: boolean,
    context: RequestContext,
  ): Promise<AgentMemoryDto> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.userPreference.findUnique({
        where: { userId },
        select: { assistantMemoryAt: true },
      });
      const was = Boolean(existing?.assistantMemoryAt);
      if (was === enabled) return;
      const assistantMemoryAt = enabled ? new Date() : null;
      await tx.userPreference.upsert({
        where: { userId },
        create: { userId, assistantMemoryAt },
        update: { assistantMemoryAt },
      });
      const erased = enabled ? 0 : (await tx.agentMemory.deleteMany({ where: { userId } })).count;
      await this.audit.record(
        {
          action: enabled ? 'agent.memory_enabled' : 'agent.memory_disabled',
          actorUserId: userId,
          targetType: 'user',
          targetId: userId,
          context,
          metadata: enabled ? {} : { erased },
        },
        tx,
      );
    });
    return this.get(userId);
  }

  /** Whether the traveller agreed. Read every time: an erased memory must stay erased. */
  async enabled(userId: string): Promise<boolean> {
    const preference = await this.prisma.userPreference.findUnique({
      where: { userId },
      select: { assistantMemoryAt: true },
    });
    return Boolean(preference?.assistantMemoryAt);
  }

  /**
   * The value as it would be stored, or a refusal: not one this key takes, or a code that
   * names no airport or airline Suskii knows.
   */
  async check(key: AgentMemoryKey, raw: string): Promise<string> {
    const value = agentMemoryValue(key, raw);
    if (value === null) throw invalid();
    if (key === 'home_airport' && !(await this.catalog.airport(value))) throw invalid();
    if (key === 'airlines') {
      const codes = agentMemoryAirlines(value);
      // Airlines are synced from a supplier (ADR-006). Where none were synced yet, a test
      // stack on the demo supplier say, the code's form is all there is to check.
      const [known, any] = await Promise.all([
        this.prisma.airline.count({ where: { iataCode: { in: codes }, active: true } }),
        this.prisma.airline.count({ where: { active: true } }),
      ]);
      if (any > 0 && known !== codes.length) throw invalid();
    }
    return value;
  }

  /** Remembers one preference for a traveller who agreed; 409 while memory is off. */
  async put(
    userId: string,
    key: AgentMemoryKey,
    raw: string,
    source: AgentMemorySource,
  ): Promise<AgentMemoryDto> {
    const value = await this.check(key, raw);
    if (!(await this.enabled(userId))) throw memoryOff();
    await this.prisma.agentMemory.upsert({
      where: { userId_key: { userId, key } },
      create: { id: uuidv7(), userId, key, value, source },
      update: { value, source },
    });
    return this.get(userId);
  }

  /** Erases one preference. Erasing what is not there is not an error. */
  async remove(userId: string, key: AgentMemoryKey): Promise<AgentMemoryDto> {
    await this.prisma.agentMemory.deleteMany({ where: { userId, key } });
    return this.get(userId);
  }
}
