/**
 * Step-up for the riskiest admin actions (ADR-037). When the API answers 403 `step-up-required`,
 * the API client asks the mounted prompt for an authenticator code and repeats the request once.
 * Concurrent requests share one prompt. Client only.
 */

type Prompt = () => Promise<boolean>;

let prompt: Prompt | null = null;
let pending: Promise<boolean> | null = null;

/** The console shell registers its dialog; null when it unmounts. */
export function registerStepUpPrompt(next: Prompt | null): void {
  prompt = next;
}

/** Resolves true once the session has stepped up, false when staff cancel or nothing is mounted. */
export function requestStepUp(): Promise<boolean> {
  if (!prompt) return Promise.resolve(false);
  pending ??= prompt().finally(() => {
    pending = null;
  });
  return pending;
}

const STEP_UP_TYPE = 'urn:suskii:problem:step-up-required';

/** True for the API's step-up problem (reads a clone, so the caller can still read the body). */
export async function isStepUpRequired(response: Response): Promise<boolean> {
  if (response.status !== 403) return false;
  try {
    const body = (await response.clone().json()) as { type?: unknown };
    return body.type === STEP_UP_TYPE;
  } catch {
    return false;
  }
}
