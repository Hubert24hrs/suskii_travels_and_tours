import { Injectable, Logger } from '@nestjs/common';

import { uuidv7 } from '../../common/uuid';
import { supportMessageContext } from '../../crypto/encryption-contexts';
import { FieldEncryption } from '../../crypto/field-encryption';
import { PrismaService } from '../../infra/prisma.service';

/** The assistant's latest runs a note looks back over: the turn that handed over and a few before. */
const RUNS = 5;
/** Tools named in one note; more than this is noise for the person reading it. */
const TOOLS = 12;

/** "flights.search ok x2", "bookings.list denied (scope)": a tool, how it ended, how often. */
function toolLines(calls: readonly { tool: string; status: string; reason: string | null }[]) {
  const tally = new Map<string, number>();
  for (const call of calls) {
    const outcome =
      call.status === 'ok' || !call.reason ? call.status : `${call.status} (${call.reason})`;
    const key = `${call.tool} ${outcome}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return [...tally.entries()]
    .slice(0, TOOLS)
    .map(([key, times]) => (times > 1 ? `${key} x${times}` : key));
}

/**
 * What the support team is told when the assistant hands a traveller over (ADR-101): an
 * internal note in the support conversation saying which agents worked on it, which tools
 * they called and how each call ended, so nobody asks the traveller again for what was
 * already looked up. Names of agents and tools and outcome codes only: never a word the
 * traveller or a model wrote, and never a tool's arguments or results. Internal notes reach no
 * traveller route, export or notification (ADR-083).
 */
@Injectable()
export class AgentHandoverNotes {
  private readonly logger = new Logger(AgentHandoverNotes.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryption,
  ) {}

  /** The note's text for an assistant conversation; `why` is a code of ours when there is one. */
  async text(agentConversationId: string, why: string | null = null): Promise<string> {
    const [conversation, runs] = await Promise.all([
      this.prisma.agentConversation.findUnique({
        where: { id: agentConversationId },
        select: { reference: true },
      }),
      this.prisma.agentRun.findMany({
        where: { conversationId: agentConversationId },
        orderBy: { id: 'desc' },
        take: RUNS,
        select: {
          agents: true,
          agent: true,
          toolCalls: { select: { tool: true, status: true, reason: true }, orderBy: { id: 'asc' } },
        },
      }),
    ]);
    const agents = [
      ...new Set(runs.flatMap((run) => (run.agents.length > 0 ? run.agents : [run.agent]))),
    ];
    const tools = toolLines(runs.reverse().flatMap((run) => run.toolCalls));
    return [
      `Handed over by the assistant${conversation ? ` (conversation ${conversation.reference})` : ''}.`,
      ...(why ? [`Why: ${why}.`] : []),
      `Agents that worked on it: ${agents.length > 0 ? agents.join(', ') : 'none'}.`,
      `Tools it called: ${tools.length > 0 ? tools.join('; ') : 'none'}.`,
      'This note lists names and outcomes only. What the traveller wrote is in the messages above.',
    ].join('\n');
  }

  /**
   * Adds the note to a support conversation. A note that cannot be written never undoes the
   * handover: the traveller is with people either way.
   */
  async add(
    supportConversationId: string,
    agentConversationId: string,
    why: string | null = null,
  ): Promise<void> {
    try {
      const body = await this.text(agentConversationId, why);
      const id = uuidv7();
      await this.prisma.$transaction(async (tx) => {
        await tx.supportMessage.create({
          data: {
            id,
            conversationId: supportConversationId,
            author: 'system',
            internal: true,
            bodyEncrypted: this.encryption.encrypt(body, supportMessageContext(id)),
          },
        });
        await tx.supportConversation.update({
          where: { id: supportConversationId },
          data: { messageCount: { increment: 1 } },
        });
      });
    } catch (error) {
      this.logger.warn(
        { supportConversationId, error: error instanceof Error ? error.name : 'unknown' },
        'the handover note could not be written',
      );
    }
  }
}
