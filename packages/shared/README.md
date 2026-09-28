# @suskii/shared

Framework-agnostic code shared by the API, worker, web, admin and mobile apps: domain constants,
Zod schemas, types, and (from phase 3) money and date utilities.

Rules:

- No React, NestJS, Next.js, Expo or Node-only APIs. It must run in Node, browsers and Hermes.
- Built with `tsup` to ESM (`dist/index.js`) and CJS (`dist/index.cjs`) with type declarations, so
  both the ESM clients and the CommonJS NestJS API consume the same code.
- Every exported function has unit tests (`pnpm --filter @suskii/shared test`).
