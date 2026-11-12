import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  type INestApplication,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { z } from 'zod';

import { Public } from '../auth/decorators';
import { ProblemDetailsFilter } from '../common/problem-details';
import { buildOpenApiDocument, type ResponseObject } from '../openapi/openapi';

import { Contract, named } from './contract';
import { ContractInterceptor } from './contract.interceptor';

const widgetSchema = named('TestWidget', z.object({ id: z.uuid(), name: z.string() }));
const createWidgetSchema = z.object({
  name: z.string().min(2),
  tier: z.enum(['basic', 'pro']).default('basic'),
});

@Controller('widgets')
class WidgetController {
  @Public()
  @Post()
  @Contract({
    operationId: 'createWidget',
    summary: 'Create a widget',
    tags: ['Test'],
    body: createWidgetSchema,
    responses: { 201: widgetSchema },
    idempotent: true,
  })
  create(@Body() body: z.infer<typeof createWidgetSchema>): unknown {
    // Extra internal field must be stripped by the response contract.
    return {
      id: '0192f0e0-0000-7000-8000-000000000001',
      name: `${body.name}:${body.tier}`,
      internalSecret: 'x',
    };
  }

  @Get(':id')
  @Contract({
    operationId: 'getWidget',
    summary: 'Get a widget',
    tags: ['Test'],
    params: z.object({ id: z.uuid() }),
    query: z.object({ expand: z.coerce.boolean().optional() }),
    responses: { 200: widgetSchema },
    errors: [404],
  })
  get(@Param('id') id: string, @Query() query: { expand?: boolean }): unknown {
    return { id, name: query.expand ? 'expanded' : 'plain' };
  }

  @Public()
  @Post('broken')
  @HttpCode(HttpStatus.OK)
  @Contract({
    operationId: 'brokenWidget',
    summary: 'Returns data violating its contract',
    tags: ['Test'],
    responses: { 200: widgetSchema },
  })
  broken(): unknown {
    return { id: 'not-a-uuid' };
  }
}

describe('contracts', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DiscoveryModule],
      controllers: [WidgetController],
      providers: [
        { provide: APP_FILTER, useClass: ProblemDetailsFilter },
        { provide: APP_INTERCEPTOR, useClass: ContractInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('validates input, applies defaults and strips undocumented output fields', async () => {
    const response = await request(app.getHttpServer())
      .post('/widgets')
      .send({ name: 'Kite', unknown: true })
      .expect(201);
    expect(response.body).toStrictEqual({
      id: '0192f0e0-0000-7000-8000-000000000001',
      name: 'Kite:basic',
    });
  });

  it('rejects invalid input with problem+json issues that never echo values', async () => {
    const response = await request(app.getHttpServer())
      .post('/widgets')
      .send({ name: 'k', tier: 'secret-value' })
      .expect(400)
      .expect('Content-Type', /application\/problem\+json/);
    expect(response.body.type).toBe('urn:suskii:problem:validation-failed');
    expect(response.body.errors.map((e: { path: string }) => e.path).sort()).toEqual([
      'name',
      'tier',
    ]);
    expect(JSON.stringify(response.body)).not.toContain('secret-value');
  });

  it('parses params and coerces query values', async () => {
    await request(app.getHttpServer()).get('/widgets/not-a-uuid').expect(400);
    const ok = await request(app.getHttpServer())
      .get('/widgets/0192f0e0-0000-7000-8000-000000000002?expand=true')
      .expect(200);
    expect(ok.body.name).toBe('expanded');
  });

  it('turns contract-violating responses into a generic 500', async () => {
    const response = await request(app.getHttpServer()).post('/widgets/broken').expect(500);
    expect(response.body).not.toHaveProperty('detail');
  });

  it('generates an OpenAPI 3.1 document with components, parameters and security', () => {
    const doc = buildOpenApiDocument(app);
    expect(doc.openapi).toBe('3.1.0');
    const create = doc.paths['/v1/widgets']?.post;
    if (!create) throw new Error('createWidget missing');
    expect(create.operationId).toBe('createWidget');
    expect(create.security).toEqual([]);
    expect(create.parameters).toContainEqual(
      expect.objectContaining({ name: 'Idempotency-Key', in: 'header', required: true }),
    );
    const created = create.responses['201'] as Extract<ResponseObject, { description: string }>;
    expect(created.content?.['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/TestWidget',
    });
    expect(create.parameters).toContainEqual(
      expect.objectContaining({ name: 'X-CSRF-Token', in: 'header', required: false }),
    );
    expect(create.responses['400']).toEqual({ $ref: '#/components/responses/Problem400' });

    const get = doc.paths['/v1/widgets/{id}']?.get;
    if (!get) throw new Error('getWidget missing');
    expect(get.security).toBeUndefined();
    expect(get.parameters).toContainEqual(
      expect.objectContaining({ name: 'id', in: 'path', required: true }),
    );
    expect(get.parameters).toContainEqual(
      expect.objectContaining({ name: 'expand', in: 'query', required: false }),
    );
    expect(Object.keys(get.responses)).toEqual(expect.arrayContaining(['200', '401', '404']));

    expect(doc.components.schemas).toHaveProperty('TestWidget');
    expect(JSON.stringify(doc.components.schemas.TestWidget)).not.toContain('pattern');
  });
});
