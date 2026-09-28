import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { createLifecycle, type WorkerComponent } from './lifecycle.js';

const silentLogger = pino({ level: 'silent' });

function recordingComponent(
  name: string,
  events: string[],
  options: { failStart?: boolean; failStop?: boolean } = {},
): WorkerComponent {
  return {
    name,
    start: () => {
      events.push(`start:${name}`);
      return options.failStart
        ? Promise.reject(new Error(`${name} start failed`))
        : Promise.resolve();
    },
    stop: () => {
      events.push(`stop:${name}`);
      return options.failStop
        ? Promise.reject(new Error(`${name} stop failed`))
        : Promise.resolve();
    },
  };
}

describe('createLifecycle', () => {
  it('starts in order and stops in reverse order', async () => {
    const events: string[] = [];
    const lifecycle = createLifecycle(
      [recordingComponent('a', events), recordingComponent('b', events)],
      silentLogger,
    );

    await lifecycle.start();
    await lifecycle.stop();

    expect(events).toEqual(['start:a', 'start:b', 'stop:b', 'stop:a']);
  });

  it('stops only already-started components when a start fails, then rethrows', async () => {
    const events: string[] = [];
    const lifecycle = createLifecycle(
      [
        recordingComponent('a', events),
        recordingComponent('b', events, { failStart: true }),
        recordingComponent('c', events),
      ],
      silentLogger,
    );

    await expect(lifecycle.start()).rejects.toThrow('b start failed');
    expect(events).toEqual(['start:a', 'start:b', 'stop:a']);
  });

  it('keeps stopping remaining components when one fails to stop', async () => {
    const events: string[] = [];
    const lifecycle = createLifecycle(
      [recordingComponent('a', events), recordingComponent('b', events, { failStop: true })],
      silentLogger,
    );

    await lifecycle.start();
    await lifecycle.stop();

    expect(events).toEqual(['start:a', 'start:b', 'stop:b', 'stop:a']);
  });

  it('is idempotent when stop is called concurrently (e.g. SIGINT then SIGTERM)', async () => {
    const events: string[] = [];
    const lifecycle = createLifecycle([recordingComponent('a', events)], silentLogger);

    await lifecycle.start();
    await Promise.all([lifecycle.stop(), lifecycle.stop()]);

    expect(events).toEqual(['start:a', 'stop:a']);
  });
});
