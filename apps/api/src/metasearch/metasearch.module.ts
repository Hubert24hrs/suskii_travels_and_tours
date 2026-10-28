import { Module } from '@nestjs/common';

import { SearchModule } from '../search/search.module';

import { AdminMetasearchController } from './admin-metasearch.controller';
import { MetasearchAdminService } from './metasearch-admin.service';
import { MetasearchLinks } from './metasearch-links';
import { MetasearchController } from './metasearch.controller';
import { MetasearchService } from './metasearch.service';

/** Metasearch partners: the live price API, deep-link landings and the console (ADR-081). */
@Module({
  imports: [SearchModule],
  controllers: [MetasearchController, AdminMetasearchController],
  providers: [MetasearchLinks, MetasearchService, MetasearchAdminService],
})
export class MetasearchModule {}
