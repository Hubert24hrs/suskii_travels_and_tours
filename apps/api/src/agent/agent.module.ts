import { Module } from '@nestjs/common';

import { AiSearchModule } from '../ai-search/ai-search.module';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { CatalogModule } from '../catalog/catalog.module';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrivacyModule } from '../privacy/privacy.module';
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
import { AgentChatController } from './chat/agent-chat.controller';
import { AgentChatService } from './chat/agent-chat.service';
import { AGENT_CLIENT, HttpAgentClient, MockAgentClient } from './chat/agent-client';
import { AgentConversationsService } from './chat/agent-conversations.service';
import { AgentRunLog } from './chat/agent-run-log';
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
  imports: [AiSearchModule, AuthModule, BookingsModule, CatalogModule, PrivacyModule, StatusModule],
  controllers: [
    AgentController,
    AgentChatController,
    AdminAgentController,
    InternalAgentToolsController,
  ],
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
    AgentConversationsService,
    AgentChatService,
    AgentRunLog,
    MockAgentClient,
    {
      // The agent service over HTTP, or the mock inside the API (tests, a stack without it).
      // The env schema already refused the mock in production.
      provide: AGENT_CLIENT,
      inject: [APP_CONFIG, MockAgentClient],
      useFactory: (config: AppConfig, mock: MockAgentClient) =>
        config.AGENT_SERVICE === 'http' && config.AGENT_URL && config.AGENT_RUN_TOKEN
          ? new HttpAgentClient({ baseUrl: config.AGENT_URL, token: config.AGENT_RUN_TOKEN })
          : mock,
    },
  ],
  exports: [
    AgentFlags,
    AgentPause,
    AgentGrants,
    AgentBudget,
    AgentToolRegistry,
    AgentToolGateway,
    MockAgentClient,
  ],
})
export class AgentModule {}
