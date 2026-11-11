import { Injectable } from '@nestjs/common';

import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../infra/prisma.service';
import { THREAD_TABLES } from './unmanaged-tables';

type Db = Pick<PrismaService, '$executeRaw'>;

/**
 * The API's one right over the agent service's checkpoints (ADR-103): deleting a thread's
 * rows. A thread is a conversation (`thread_id` is its id). The API's role may delete here and
 * read the thread id to do so; it cannot read what a checkpoint holds, and nothing else of the
 * API touches the `agent` schema.
 */
@Injectable()
export class AgentThreads {
  constructor(private readonly prisma: PrismaService) {}

  /** Deletes the checkpoints of these conversations, in the caller's transaction when given. */
  async delete(conversationIds: readonly string[], db: Db = this.prisma): Promise<number> {
    if (conversationIds.length === 0) return 0;
    let deleted = 0;
    for (const table of THREAD_TABLES) {
      deleted += await db.$executeRaw(
        Prisma.sql`DELETE FROM ${Prisma.raw(table)} WHERE "thread_id" = ANY(${[...conversationIds]}::text[])`,
      );
    }
    return deleted;
  }

  /**
   * Deletes every thread without a conversation that had a message since `cutoff`: threads
   * idle for 30 days, and threads whose conversation is gone. Returns the checkpoints deleted.
   */
  async purgeIdle(cutoff: Date, db: Db = this.prisma): Promise<number> {
    let checkpoints = 0;
    for (const table of THREAD_TABLES) {
      const count = await db.$executeRaw(
        Prisma.sql`DELETE FROM ${Prisma.raw(table)} AS t
                   WHERE NOT EXISTS (
                     SELECT 1 FROM "agent_conversations" AS c
                     WHERE c."id"::text = t."thread_id" AND c."last_message_at" >= ${cutoff}
                   )`,
      );
      if (table.endsWith('."checkpoints"')) checkpoints = count;
    }
    return checkpoints;
  }
}
