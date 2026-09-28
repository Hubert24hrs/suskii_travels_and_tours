import { type Logger } from './logger.js';

/** Anything the worker process owns and must start and stop cleanly (queues, servers). */
export interface WorkerComponent {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface Lifecycle {
  /** Starts components in order. If one fails, already-started ones are stopped and the error rethrown. */
  start(): Promise<void>;
  /** Stops started components in reverse order. Safe to call more than once. */
  stop(): Promise<void>;
}

export function createLifecycle(components: readonly WorkerComponent[], logger: Logger): Lifecycle {
  const started: WorkerComponent[] = [];
  let stopping: Promise<void> | undefined;

  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      // Reverse order: components stop before the things they were started after.
      for (const component of started.toReversed()) {
        try {
          await component.stop();
          logger.info({ component: component.name }, 'component stopped');
        } catch (error) {
          logger.error({ component: component.name, err: error }, 'component failed to stop');
        }
      }
      started.length = 0;
    })();
    return stopping;
  };

  const start = async (): Promise<void> => {
    for (const component of components) {
      try {
        await component.start();
      } catch (error) {
        logger.error({ component: component.name, err: error }, 'component failed to start');
        await stop();
        throw error;
      }
      started.push(component);
      logger.info({ component: component.name }, 'component started');
    }
  };

  return { start, stop };
}
