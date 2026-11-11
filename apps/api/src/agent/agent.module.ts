import { Module } from '@nestjs/common';

import { AdminModule } from '../admin/admin.module';
import { AiSearchModule } from '../ai-search/ai-search.module';
import { AlertsModule } from '../alerts/alerts.module';
import { AssistedQuotesModule } from '../assisted-quotes/assisted-quotes.module';
import { AuthModule } from '../auth/auth.module';
import { BookingsModule } from '../bookings/bookings.module';
import { BusesModule } from '../buses/buses.module';
import { CatalogModule } from '../catalog/catalog.module';
import { CompaniesModule } from '../companies/companies.module';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { DealsModule } from '../deals/deals.module';
import { DocumentsModule } from '../documents/documents.module';
import { GroundModule } from '../ground/ground.module';
import { InhouseModule } from '../inhouse/inhouse.module';
import { PriceIntelModule } from '../price-intel/price-intel.module';
import { PrivacyModule } from '../privacy/privacy.module';
import { RentalsModule } from '../rentals/rentals.module';
import { SearchModule } from '../search/search.module';
import { StatusModule } from '../status/status.module';
import { SupportModule } from '../support/support.module';
import { TripsModule } from '../trips/trips.module';
import { VisaModule } from '../visa/visa.module';

import { AdminAgentController } from './admin-agent.controller';
import { AgentAdminService } from './agent-admin.service';
import { AgentBudget } from './agent-budget';
import { AgentFlags } from './agent-flags';
import { AgentGrants } from './agent-grants';
import { AgentPause } from './agent-pause';
import { AgentToolsTokenGuard } from './agent-service-route';
import { AgentSettingsService } from './agent-settings.service';
import { AgentShadows } from './shadow/agent-shadows.service';
import { AgentToolRegistry } from './agent-tool';
import { AgentToolGateway } from './agent-tool-gateway.service';
import { AgentController } from './agent.controller';
import { AdminAgentApprovalsController } from './approvals/admin-agent-approvals.controller';
import { AgentApprovalsService } from './approvals/agent-approvals.service';
import { AdminAgentChatController } from './chat/admin-agent-chat.controller';
import { AgentChatController } from './chat/agent-chat.controller';
import { AgentChatService } from './chat/agent-chat.service';
import { AGENT_CLIENT, HttpAgentClient, MockAgentClient } from './chat/agent-client';
import { AgentConversationsService } from './chat/agent-conversations.service';
import { AgentHandoverNotes } from './chat/agent-handover-notes';
import { AgentRunLog } from './chat/agent-run-log';
import { AgentConfirmationsController } from './confirmations/agent-confirmations.controller';
import { AgentConfirmationsService } from './confirmations/agent-confirmations.service';
import { AdminAgentInsightsController } from './insights/admin-agent-insights.controller';
import { AgentInsightsService } from './insights/agent-insights.service';
import { InternalAgentToolsController } from './internal-agent-tools.controller';
import { AgentMemoryController } from './memory/agent-memory.controller';
import { AgentMemoryService } from './memory/agent-memory.service';
import { AdminAgentKnowledgeController } from './knowledge/admin-agent-knowledge.controller';
import { KnowledgeService } from './knowledge/knowledge.service';
import { AccountTools } from './tools/account-tools';
import { CatalogTools } from './tools/catalog-tools';
import { CommitTools } from './tools/commit-tools';
import { DisruptionTools } from './tools/disruption-tools';
import { KnowledgeTools } from './tools/knowledge-tools';
import { MemoryTools } from './tools/memory-tools';
import { PlanningTools } from './tools/planning-tools';
import { PlatformTools } from './tools/platform-tools';
import { ProductTools } from './tools/product-tools';
import { QuoteTools } from './tools/quote-tools';
import { SearchTools } from './tools/search-tools';
import { StaffTools } from './tools/staff-tools';
import { SupportTools } from './tools/support-tools';
import { AgentToolCallers } from './tools/tool-support';
import { WatchTools } from './tools/watch-tools';
import { AgentWhatsApp } from './whatsapp/agent-whatsapp.service';

/**
 * Suskii Agent on the API side (ADR-101 to ADR-107): the switches, sealed grants, the tool
 * gateway and its tools. The agents themselves run in `apps/agent`; this module depends on the
 * domain modules whose services its tools call, never the other way round, so nothing in search,
 * booking or payment knows the assistant exists.
 */
@Module({
  imports: [
    AdminModule,
    AiSearchModule,
    AlertsModule,
    AssistedQuotesModule,
    AuthModule,
    BookingsModule,
    BusesModule,
    CatalogModule,
    CompaniesModule,
    DealsModule,
    DocumentsModule,
    GroundModule,
    InhouseModule,
    PriceIntelModule,
    PrivacyModule,
    RentalsModule,
    SearchModule,
    StatusModule,
    SupportModule,
    TripsModule,
    VisaModule,
  ],
  controllers: [
    AgentController,
    AgentChatController,
    AgentConfirmationsController,
    AgentMemoryController,
    AdminAgentController,
    AdminAgentChatController,
    AdminAgentApprovalsController,
    AdminAgentInsightsController,
    AdminAgentKnowledgeController,
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
    AgentToolCallers,
    PlatformTools,
    PlanningTools,
    CatalogTools,
    SearchTools,
    ProductTools,
    AccountTools,
    CommitTools,
    DisruptionTools,
    WatchTools,
    QuoteTools,
    AgentApprovalsService,
    AgentInsightsService,
    KnowledgeService,
    KnowledgeTools,
    AgentMemoryService,
    MemoryTools,
    StaffTools,
    SupportTools,
    AgentConversationsService,
    AgentHandoverNotes,
    AgentShadows,
    AgentChatService,
    AgentConfirmationsService,
    AgentRunLog,
    // Registers itself with the support module's WhatsApp answerers (ADR-084).
    AgentWhatsApp,
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
