import { reportError } from './error-reporting';

const FIRST_RETRY_MS = 500;
const MAX_RETRY_MS = 5_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the app's start-up step (open the encrypted cache, restore the session) until it succeeds.
 * The keychain refuses reads while the phone is locked, which happens when the system starts the
 * app in the background; a single failed attempt used to leave the app on a blank screen. The
 * first failure is reported; later attempts back off up to five seconds. Resolves to null once
 * `cancelled()` turns true.
 */
export async function untilStarted<T>(
  start: () => Promise<T>,
  {
    wait = sleep,
    cancelled = () => false,
  }: { wait?: typeof sleep; cancelled?: () => boolean } = {},
): Promise<T | null> {
  for (let attempt = 0; !cancelled(); attempt += 1) {
    try {
      return await start();
    } catch (error) {
      if (attempt === 0) void reportError(error, { kind: 'bootstrap' });
      await wait(Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** attempt));
    }
  }
  return null;
}
