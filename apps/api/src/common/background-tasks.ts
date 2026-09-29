import { Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';

/**
 * Runs work after the response is sent (e.g. emails whose timing would otherwise reveal whether
 * an account exists). Failures are logged, never surfaced; shutdown waits for pending work.
 * Replaced by BullMQ jobs in the worker once notifications move there (phase 7).
 */
@Injectable()
export class BackgroundTasks implements OnApplicationShutdown {
  private readonly logger = new Logger(BackgroundTasks.name);
  private readonly pending = new Set<Promise<void>>();

  run(name: string, task: () => Promise<unknown>): void {
    const promise = new Promise<void>((resolve) => setImmediate(resolve))
      .then(task)
      .then(
        () => undefined,
        (error: unknown) => {
          this.logger.error({ err: error, task: name }, 'background task failed');
        },
      )
      .finally(() => this.pending.delete(promise));
    this.pending.add(promise);
  }

  /** Resolves when all queued work has finished (tests and graceful shutdown). */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.all([...this.pending]);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.drain();
  }
}
