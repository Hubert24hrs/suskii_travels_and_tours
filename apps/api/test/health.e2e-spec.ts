import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleRef.createNestApplication<INestApplication<App>>());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health responds 200 with status ok', async () => {
    await request(app.getHttpServer()).get('/health').expect(200).expect({ status: 'ok' });
  });

  it('keeps the health probe version-neutral (not under /v1)', async () => {
    await request(app.getHttpServer()).get('/v1/health').expect(404);
  });

  it('404s unknown versioned routes', async () => {
    await request(app.getHttpServer()).get('/v1/does-not-exist').expect(404);
  });
});
