import { Body, Controller, Post, Req } from '@nestjs/common';
import type { z } from 'zod';

import { ATTESTATION_HEADER } from '../attestation/attestation.schemas';
import type { AuthenticatedRequest } from '../auth/auth-context';
import { Public } from '../auth/decorators';
import { Contract } from '../contract/contract';
import { RateLimit, SUPPORT_LIMITS } from '../rate-limit/rate-limit.decorator';

import { GroupRequestsService } from './group-requests.service';
import { supportCaller } from './support.controller';
import { groupRequestBodySchema, startedSupportSchema } from './support.schemas';

/** Flights for ten travellers or more: a request the team answers, not a search. */
@Public()
@Controller('flights/group-requests')
export class GroupRequestsController {
  constructor(private readonly groups: GroupRequestsService) {}

  @Post()
  @RateLimit(SUPPORT_LIMITS.startIp)
  @Contract({
    operationId: 'requestGroupFlight',
    summary: 'Ask for a flight for ten travellers or more',
    description:
      'Airlines price groups through their group desks, so this starts a support conversation (topic `group_booking`) with the request as its first message; the team replies there. Bot checks, the guest email and the access token work as for `startSupportConversation`. 400 `validation-failed` for an unknown airport or a date in the past.',
    tags: ['Flights', 'Support'],
    headers: [ATTESTATION_HEADER],
    body: groupRequestBodySchema,
    responses: { 201: startedSupportSchema },
    errors: [400, 409, 422],
  })
  create(
    @Body() body: z.infer<typeof groupRequestBodySchema>,
    @Req() request: AuthenticatedRequest,
  ): Promise<z.infer<typeof startedSupportSchema>> {
    return this.groups.create(body, supportCaller(request));
  }
}
