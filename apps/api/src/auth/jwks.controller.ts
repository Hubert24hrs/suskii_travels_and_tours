import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';
import type { z } from 'zod';

import { Contract } from '../contract/contract';

import { jwksSchema } from './auth.schemas';
import { Public } from './decorators';
import { AccessTokenService } from './tokens/access-token.service';

@Public()
@Controller({ path: '.well-known', version: VERSION_NEUTRAL })
export class JwksController {
  constructor(private readonly tokens: AccessTokenService) {}

  @Get('jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  @Contract({
    operationId: 'getJwks',
    summary: 'Public keys that verify access tokens (RFC 7517)',
    tags: ['Auth'],
    responses: { 200: jwksSchema },
  })
  getJwks(): z.infer<typeof jwksSchema> {
    return this.tokens.getJwks();
  }
}
