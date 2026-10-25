import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';

import {
  naturalSearchRequestSchema,
  naturalSearchResultSchema,
  naturalSearchStatusSchema,
  type NaturalSearchRequest,
  type NaturalSearchResult,
  type NaturalSearchStatus,
} from '@suskii/shared';

import type { AuthenticatedRequest } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { Contract, named } from '../contract/contract';
import { AI_SEARCH_LIMITS, RateLimit, SEARCH_LIMITS } from '../rate-limit/rate-limit.decorator';

import { NaturalSearchService } from './natural-search.service';

const TAGS = ['Flights'];

@Public()
@Controller('flights/natural-search')
export class NaturalSearchController {
  constructor(private readonly search: NaturalSearchService) {}

  @Get()
  @RateLimit(SEARCH_LIMITS.searchIp)
  @Header('Cache-Control', 'public, max-age=60')
  @Contract({
    operationId: 'getNaturalSearchStatus',
    summary: 'Whether natural-language flight search is available',
    description: 'Clients show the "describe your trip" box only while `enabled` is true.',
    tags: TAGS,
    responses: { 200: named('NaturalSearchStatus', naturalSearchStatusSchema) },
  })
  status(): NaturalSearchStatus {
    return this.search.status();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RateLimit(AI_SEARCH_LIMITS.ip, AI_SEARCH_LIMITS.ipDaily, AI_SEARCH_LIMITS.user)
  @Contract({
    operationId: 'parseNaturalSearch',
    summary: 'Turn a trip description into a draft of the flight search form',
    description:
      'An LLM reads the text (scrubbed of e-mail addresses, phone numbers and document numbers) into the flight form: places resolved through the catalog, dates checked against the visitor\'s today, counts within the traveller rules. The result is a draft to show as editable fields, never a search. Every error means "use the form": 404 while the feature is off, 422 `ai-search-not-understood`, 429 for rate limits and `ai-search-budget-exceeded` (daily cost cap), 503 `ai-search-unavailable`.',
    tags: TAGS,
    body: named('NaturalSearchRequest', naturalSearchRequestSchema),
    responses: { 200: named('NaturalSearchResult', naturalSearchResultSchema) },
    errors: [404, 422, 429, 503],
  })
  parse(
    @Body() body: NaturalSearchRequest,
    @Req() request: AuthenticatedRequest,
  ): Promise<NaturalSearchResult> {
    return this.search.parse(body, { userId: request.auth?.userId ?? null, ip: request.ip ?? '' });
  }
}
