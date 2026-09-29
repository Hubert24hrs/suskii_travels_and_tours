import { Controller, Get, Header, NotFoundException, Param, Query } from '@nestjs/common';
import type { z } from 'zod';

import { Public } from '../auth/decorators';
import { Contract } from '../contract/contract';

import {
  contentPageSchema,
  contentQuerySchema,
  homeContentSchema,
  pageParamsSchema,
  siteContentSchema,
} from './content.schemas';
import { ContentService } from './content.service';

const TAGS = ['Content'];
/** CMS edits show within minutes; clients and CDNs may reuse a response briefly. */
const CACHE_SHORT = 'public, max-age=60, stale-while-revalidate=300';

type Query = z.infer<typeof contentQuerySchema>;

@Public()
@Controller('content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get('site')
  @Header('Cache-Control', CACHE_SHORT)
  @Contract({
    operationId: 'getSiteContent',
    summary: 'Header and footer content',
    description:
      'Support contacts, social and app store links, published pages, verified trust signals and supported payment methods. Empty values mean the business has not provided them yet.',
    tags: TAGS,
    query: contentQuerySchema,
    responses: { 200: siteContentSchema },
  })
  site(@Query() query: Query): Promise<z.infer<typeof siteContentSchema>> {
    return this.content.site(query.locale);
  }

  @Get('home')
  @Header('Cache-Control', CACHE_SHORT)
  @Contract({
    operationId: 'getHomeContent',
    summary: 'Homepage CMS blocks and FAQs',
    tags: TAGS,
    query: contentQuerySchema,
    responses: { 200: homeContentSchema },
  })
  home(@Query() query: Query): Promise<z.infer<typeof homeContentSchema>> {
    return this.content.home(query.locale);
  }

  @Get('pages/:slug')
  @Header('Cache-Control', CACHE_SHORT)
  @Contract({
    operationId: 'getContentPage',
    summary: 'Published CMS page (terms, privacy, about...)',
    tags: TAGS,
    params: pageParamsSchema,
    query: contentQuerySchema,
    responses: { 200: contentPageSchema },
    errors: [404],
  })
  async page(
    @Param('slug') slug: string,
    @Query() query: Query,
  ): Promise<z.infer<typeof contentPageSchema>> {
    const page = await this.content.page(slug, query.locale);
    if (!page) throw new NotFoundException();
    return page;
  }
}
