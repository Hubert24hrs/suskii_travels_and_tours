import { Module } from '@nestjs/common';

import { AiSearchModule } from '../ai-search/ai-search.module';
import { CatalogModule } from '../catalog/catalog.module';
import { StatusModule } from '../status/status.module';

import { AdminAgentController } from './admin-agent.controller';
import { AgentAdminService } from './agent-admin.service';
import { AgentBudget } from './agent-budget';
import { AgentFlags } from './agent-flags';
import { AgentGrants } from './agent-grants';
import { AgentPause } from './agent-pause';
import { AgentToolsTokenGuard } from './agent-service-route';
import { AgentSettingsService } from './agent-settings.service';
import { AgentToolRegistry } from './agent-tool';
import { AgentToolGateway } from './agent-tool-gateway.service';
import { AgentController } from './agent.controller';
import { InternalAgentToolsController } from './internal-agent-tools.controller';
import { CatalogTools } from './tools/catalog-tools';
import { PlatformTools } from './tools/platform-tools';

/**
 * Suskii Agent on the API side (ADR-101 to ADR-107): the switches, sealed grants, the tool
 * gateway and its tools. The agents themselves run in `apps/agent`; this module depends on the
 * domain modules whose services its tools call, never the other way round, so nothing in search,
 * booking or payment knows the assistant exists.
 */
@Module({
  imports: [AiSearchModule, CatalogModule, StatusModule],
  controllers: [AgentController, AdminAgentController, InternalAgentToolsController],
  providers: [
    AgentFlags,
    AgentPause,
    AgentGrants,
    AgentBudget,
    AgentToolRegistry,
    AgentSettingsService,
    AgentToolGateway,
    AgentAdminService,
    AgentToolsTokenGuard,
    PlatformTools,
    CatalogTools,
  ],
  exports: [AgentFlags, AgentPause, AgentGrants, AgentBudget, AgentToolRegistry, AgentToolGateway],
})
export class AgentModule {}
