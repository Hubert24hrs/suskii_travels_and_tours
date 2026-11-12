import * as z from 'zod';

/**
 * Browsers run the web app under a strict CSP without 'unsafe-eval' (ADR-010). Zod probes for
 * eval support with `new Function` while it builds object schemas, which the CSP reports as a
 * violation, so browsers skip Zod's JIT. Servers keep it for faster parsing. Schema modules import
 * `z` from here, so the setting is in place before any schema is built, whatever order a bundler
 * evaluates modules in.
 */
if ('document' in globalThis) z.config({ jitless: true });

export { z };
