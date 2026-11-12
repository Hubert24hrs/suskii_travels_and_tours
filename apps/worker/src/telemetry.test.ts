import { EventEmitter } from 'node:events';

import type { Job, Worker } from 'bullmq';
import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { InternalApiError } from './internal-api.js';
import { instrumentWorker } from './telemetry.js';

const job = (attemptsMade: number, attempts?: number) =>
  ({ name: 'refresh-deal-route', attemptsMade, opts: attempts ? { attempts } : {} }) as Job;

describe('instrumentWorker', () => {
  it('reports a job only once it has used up its attempts, with the request id', async () => {
    const worker = new EventEmitter();
    const capture = vi.fn(() => Promise.resolve());
    instrumentWorker(worker as unknown as Worker, {
      queue: 'refresh',
      message: 'refresh job failed',
      logger: pino({ level: 'silent' }),
      errors: { capture },
    });
    const error = new InternalApiError('refreshDealRoute', 503, 'worker-abc');

    worker.emit('failed', job(1, 3), error);
    worker.emit('failed', job(2, 3), error);
    expect(capture).not.toHaveBeenCalled();
    worker.emit('failed', job(3, 3), error);
    worker.emit('failed', job(1), new Error('single attempt'));
    worker.emit('completed', job(1));

    await Promise.resolve();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture).toHaveBeenNthCalledWith(1, error, {
      queue: 'refresh',
      job: 'refresh-deal-route',
      requestId: 'worker-abc',
    });
  });
});
