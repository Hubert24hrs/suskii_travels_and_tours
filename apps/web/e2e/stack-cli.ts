import { startStack } from './stack';

/**
 * Runs the e2e stack (API, worker refresh and web from build output) until SIGTERM or SIGINT, for
 * clients tested outside Playwright, such as the mobile app's Maestro flows (ADR-024).
 */
void startStack().then(
  (stack) => {
    process.stdout.write('STACK READY\n');
    const stop = (): void => {
      void stack.stop().then(() => process.exit(0));
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);
    setInterval(() => undefined, 1 << 30);
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  },
);
