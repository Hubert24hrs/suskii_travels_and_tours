# ADR-005: Zod route contracts and a native OpenAPI 3.1 generator

- Status: Accepted
- Date: 2026-09-29
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec requires REST under `/v1`, an OpenAPI 3.1 document generated from the API, a typed client in
`packages/api-client` generated from it, and a CI check that the client compiles. Zod is already the
schema language shared by web, mobile and the API (`@suskii/shared`).

The usual NestJS route is `@nestjs/swagger` (DTO classes + decorators) or `nestjs-zod`. At the time
of writing neither declares support for NestJS 12, and both describe the API twice: once as runtime
validation and once as documentation decorators, which drift.

## Decision

One `@Contract()` decorator per route, holding Zod schemas for params, query, body and every
response status, plus operation metadata (`operationId`, summary, tags, documented errors,
`idempotent`). It drives three things:

1. **Input validation** (`ContractInterceptor`): params, query and body are parsed with Zod;
   failures return `400 validation-failed` problem details listing `location`, `path`, `code` and
   `message`, never the submitted value (it may be a password).
2. **Output filtering**: the handler result is parsed with the response schema for the status Nest
   will send. Unknown fields are stripped, so an internal field (password hash, token hash) can
   never leak by accident. An undocumented status or a schema violation is logged and becomes a
   generic 500.
3. **OpenAPI 3.1** (`src/openapi/openapi.ts`): routes are discovered with Nest's
   `DiscoveryService`; schemas are converted with Zod 4's `z.toJSONSchema` (draft 2020-12, the
   dialect OpenAPI 3.1 uses). Schemas registered with `named('AuthUser', schema)` become
   `components/schemas` (input variants get an `Input` suffix when they differ). Problem responses,
   `401` on protected routes, `429` everywhere, `Idempotency-Key` on idempotent routes and
   `X-CSRF-Token` on every write are added automatically. Duplicate `operationId`s fail generation.

`pnpm generate:api` builds the API, writes `apps/api/openapi.json`, and regenerates
`packages/api-client/src/schema.ts` with openapi-typescript. The client is openapi-fetch (typed
paths, params and bodies) plus openapi-react-query hooks. Both generated files are committed:

- an e2e test fails when `openapi.json` no longer matches the code;
- CI regenerates both files and fails on any diff, then typechecks the client.

## Consequences

- One source of truth per endpoint; documentation cannot drift from validation.
- Response filtering costs one Zod parse per response (microseconds for our payloads).
- Handlers return plain objects with ISO-8601 strings for dates (Zod transforms are not
  representable in JSON Schema, so conversion happens in the handler or a presenter).
- We own about 300 lines of generator code instead of depending on a Swagger module.

## Revisit when

- `@nestjs/swagger` or `nestjs-zod` support NestJS 12 and Zod 4 natively with a single source of
  truth; switching would be mechanical because contracts are data.
