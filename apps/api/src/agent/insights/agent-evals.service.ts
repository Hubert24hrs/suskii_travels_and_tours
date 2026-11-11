import { HttpStatus, Injectable } from '@nestjs/common';

import {
  AGENT_EVAL_MODES,
  AGENT_EVAL_SUITES,
  type AgentEvalMode,
  type AgentEvalResult,
  type AgentEvalSuite,
} from '@suskii/shared';

import { conflict, type StaffActor } from '../../admin/admin-helpers';
import { AuditService } from '../../audit/audit.service';
import { ProblemDetailsException } from '../../common/problem-details';
import { Prisma, type AgentEvalResult as EvalRow } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma.service';

import type { AdminAgentEval, AdminAgentEvals } from './agent-insights.schemas';

/** A clock a few minutes ahead of ours is a clock; a result dated beyond that is a mistake. */
const CLOCK_SKEW_MS = 5 * 60_000;
/** The history the console lists; the latest of each suite and mode is always there too. */
const RECENT = 30;

const duplicate = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

const figuresOf = (value: Prisma.JsonValue): Record<string, number> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  );
};

const present = (row: EvalRow): AdminAgentEval => ({
  id: row.id,
  suite: row.suite as AgentEvalSuite,
  mode: row.mode as AgentEvalMode,
  passed: row.passed,
  cases: row.cases,
  held: row.held,
  figures: figuresOf(row.figures),
  failed: row.failed,
  models: row.models,
  commit: row.commit,
  ranAt: row.ranAt.toISOString(),
  recordedAt: row.createdAt.toISOString(),
});

/**
 * The register of agent eval runs (ADR-106): what the eval command wrote with `--json`,
 * recorded by staff, so "was this model measured, on which commit, and did it pass" has an
 * answer outside CI. A record is a statement by the person who recorded it, audited as theirs;
 * it changes nothing about how the assistant answers.
 */
@Injectable()
export class AgentEvalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async record(result: AgentEvalResult, staff: StaffActor): Promise<AdminAgentEval> {
    const ranAt = new Date(result.ranAt);
    if (ranAt.getTime() > Date.now() + CLOCK_SKEW_MS) {
      throw new ProblemDetailsException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'eval-in-future',
        'An eval cannot have run in the future',
      );
    }
    try {
      return await this.prisma.$transaction(async (tx) => {
        const row = await tx.agentEvalResult.create({
          data: {
            suite: result.suite,
            mode: result.mode,
            passed: result.passed,
            cases: result.cases,
            held: result.held,
            figures: result.figures,
            failed: result.failed,
            models: result.models,
            commit: result.commit,
            ranAt,
          },
        });
        await this.audit.record(
          {
            action: 'agent.eval_recorded',
            actorUserId: staff.userId,
            targetType: 'agent_eval_result',
            targetId: row.id,
            metadata: {
              suite: row.suite,
              mode: row.mode,
              passed: row.passed,
              cases: row.cases,
              held: row.held,
            },
            context: staff.context,
          },
          tx,
        );
        return present(row);
      });
    } catch (error) {
      if (duplicate(error)) {
        throw conflict('eval-already-recorded', 'This run of the eval is already recorded');
      }
      throw error;
    }
  }

  /** The latest run of each suite against recorded answers and against a model, and the history. */
  async list(): Promise<AdminAgentEvals> {
    const [latest, recent] = await Promise.all([
      Promise.all(
        AGENT_EVAL_SUITES.flatMap((suite) =>
          AGENT_EVAL_MODES.map((mode) =>
            this.prisma.agentEvalResult.findFirst({
              where: { suite, mode },
              orderBy: [{ ranAt: 'desc' }, { id: 'desc' }],
            }),
          ),
        ),
      ),
      this.prisma.agentEvalResult.findMany({
        orderBy: [{ ranAt: 'desc' }, { id: 'desc' }],
        take: RECENT,
      }),
    ]);
    return {
      latest: latest.filter((row): row is EvalRow => row !== null).map(present),
      recent: recent.map(present),
    };
  }
}
