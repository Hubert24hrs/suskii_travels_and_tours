import { Injectable } from '@nestjs/common';

import {
  AGENT_AUTONOMY_LEVELS,
  AGENT_NAMES,
  agentAutonomyKey,
  DEFAULT_AGENT_AUTONOMY,
  effectiveAutonomy,
  raisesAutonomy,
  type AgentAutonomy,
  type AgentAutonomySubject,
  type AgentName,
} from '@suskii/shared';

import { conflict, type StaffActor } from '../admin/admin-helpers';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../infra/prisma.service';

import { AgentToolRegistry } from './agent-tool';

export interface AutonomySetting {
  subject: AgentAutonomySubject;
  name: string;
  level: AgentAutonomy;
  /** False while staff have set nothing and the default applies. */
  set: boolean;
}

const levelOf = (value: unknown): AgentAutonomy | undefined =>
  typeof value === 'string' && (AGENT_AUTONOMY_LEVELS as readonly string[]).includes(value)
    ? (value as AgentAutonomy)
    : undefined;

/**
 * Autonomy levels of agents and tools (ADR-107): rows of `agent_settings`, read on every tool
 * call so a change needs no restart. A missing or unreadable row means the default,
 * `supervised`; nothing can be set above `autonomous` or to a value outside the three levels.
 */
@Injectable()
export class AgentSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tools: AgentToolRegistry,
  ) {}

  /** The level a call by `agent` to `tool` runs at: the stricter of the two settings. */
  async autonomyFor(agent: AgentName, tool: string): Promise<AgentAutonomy> {
    const keys = [agentAutonomyKey('agent', agent), agentAutonomyKey('tool', tool)];
    const rows = await this.prisma.agentSetting.findMany({ where: { key: { in: keys } } });
    const value = (key: string | undefined): AgentAutonomy | undefined =>
      levelOf(rows.find((row) => row.key === key)?.value);
    return effectiveAutonomy(value(keys[0]), value(keys[1]));
  }

  /** Every agent and registered tool with its level, for the console. */
  async autonomy(): Promise<AutonomySetting[]> {
    const rows = await this.prisma.agentSetting.findMany({
      where: { key: { startsWith: 'autonomy.' } },
    });
    const stored = new Map(rows.map((row) => [row.key, levelOf(row.value)]));
    const one = (subject: AgentAutonomySubject, name: string): AutonomySetting => {
      const level = stored.get(agentAutonomyKey(subject, name));
      return { subject, name, level: level ?? DEFAULT_AGENT_AUTONOMY, set: level !== undefined };
    };
    return [
      ...AGENT_NAMES.map((name) => one('agent', name)),
      ...this.tools.list().map((tool) => one('tool', tool.name)),
    ];
  }

  /** True when the subject exists: one of the agents, or a tool the gateway serves. */
  known(subject: AgentAutonomySubject, name: string): boolean {
    return subject === 'agent'
      ? (AGENT_NAMES as readonly string[]).includes(name)
      : this.tools.get(name) !== undefined;
  }

  /**
   * Sets a level, audited with where it came from and whether it gave the agent more room. The
   * route asks for a fresh authenticator check either way; stopping everything at once is the
   * pause switch, which needs none.
   */
  async setAutonomy(
    input: { subject: AgentAutonomySubject; name: string; level: AgentAutonomy },
    staff: StaffActor,
  ): Promise<AutonomySetting> {
    const key = agentAutonomyKey(input.subject, input.name);
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.agentSetting.findUnique({ where: { key } });
      const from = levelOf(current?.value) ?? DEFAULT_AGENT_AUTONOMY;
      if (current && from === input.level) {
        throw conflict('agent-autonomy-unchanged', 'That is already the level');
      }
      await tx.agentSetting.upsert({
        where: { key },
        create: { key, value: input.level },
        update: { value: input.level },
      });
      await this.audit.record(
        {
          action: 'agent.autonomy_changed',
          actorUserId: staff.userId,
          targetType: `agent_${input.subject}`,
          metadata: {
            subject: input.subject,
            name: input.name,
            from,
            to: input.level,
            raised: raisesAutonomy(from, input.level),
          },
          context: staff.context,
        },
        tx,
      );
      return { subject: input.subject, name: input.name, level: input.level, set: true };
    });
  }
}
