import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { Contract } from '../../contract/contract';
import { InternalRoute } from '../../internal/internal-route';

import { AgentCostWatch } from './agent-cost-watch.service';
import { agentCostCheckSchema, type AgentCostCheck } from './agent-insights.schemas';

/** Worker-only check of the assistant's monthly cost (ADR-106, the ADR-011 pattern). */
@InternalRoute()
@Controller('internal/agent')
export class InternalAgentCostController {
  constructor(private readonly watch: AgentCostWatch) {}

  @Post('cost-check')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'checkAgentCost',
    summary: "Compare the month's estimated cost of the assistant with the figure to tell at",
    description:
      "Reads this UTC month's settled cost of the assistant's runs and its forecast at the same daily rate. When a figure is set (`AGENT_MONTHLY_ALERT_MICROUSD`) and the forecast, after the first days of the month, or the spend itself reaches it, operations are told once a month per level. It pauses nothing and changes no cap.",
    tags: ['Internal'],
    responses: { 200: agentCostCheckSchema },
    errors: [401, 404],
  })
  check(): Promise<AgentCostCheck> {
    return this.watch.check();
  }
}
