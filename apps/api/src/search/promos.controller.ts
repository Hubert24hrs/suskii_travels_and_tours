import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import type { z } from 'zod';

import type { AuthenticatedRequest } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { Contract } from '../contract/contract';
import { RateLimit, SEARCH_LIMITS } from '../rate-limit/rate-limit.decorator';

import { clientContext } from './client-context';
import { PromoService } from './promo.service';
import { promoValidateBodySchema, promoValidationSchema } from './search.schemas';

@Public()
@Controller('pricing/promos')
export class PromosController {
  constructor(private readonly promos: PromoService) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  @RateLimit(SEARCH_LIMITS.promoIp, SEARCH_LIMITS.promoUser)
  @Contract({
    operationId: 'validatePromoCode',
    summary: 'Preview a promo code on a quote',
    description:
      'Returns the discounted price. Invalid, expired or ineligible codes all answer the same 422.',
    tags: ['Pricing'],
    body: promoValidateBodySchema,
    responses: { 200: promoValidationSchema },
    errors: [404, 410, 422],
  })
  validate(
    @Body() body: z.infer<typeof promoValidateBodySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof promoValidationSchema>> {
    return this.promos.validate(body.code, body.quoteId, clientContext(request));
  }
}
