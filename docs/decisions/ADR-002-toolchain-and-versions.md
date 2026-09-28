# ADR-002: Toolchain and version pins

- Status: Accepted
- Date: 2026-09-28
- Deciders: Claude Code (implementer), pending owner review

## Context

The spec names the stack but not exact versions. On 2026-09-28 several ecosystems had just shipped
new majors whose tooling support is uneven. The rule was: use the newest version that the rest of
the toolchain officially supports, and verify it by running lint, typecheck, tests and build.

## Decisions

| Tool       | Pinned                                                    | Latest available | Why                                                                                                                                                                                                                                                                                                                                           |
| ---------- | --------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js    | **24 LTS, >= 24.9** (`.nvmrc`, `engines`, `engineStrict`) | 24.21            | Active LTS until 2028. The API's Jest setup needs Node >= 24.9 for `require(esm)` (see NestJS below). Node 22 is rejected at install with a clear error.                                                                                                                                                                                      |
| pnpm       | **10.33.0** (`packageManager`)                            | 12.6             | Stable and well understood. The pnpm 11/12 migration (config and lockfile changes) is a separate, reviewable upgrade.                                                                                                                                                                                                                         |
| TypeScript | **6.0.3**                                                 | 7.0.2            | TS 7 is the native (Go) compiler. `typescript-eslint` 8.x supports `<6.1.0` and `@nestjs/cli` 12 pins `~6.0.2`.                                                                                                                                                                                                                               |
| ESLint     | **9.39**                                                  | 10.11            | `eslint-config-next` 16 and `eslint-config-expo` 57 both depend on `eslint-plugin-react` 7.37.5, which **crashes on ESLint 10** (`contextOrFilename.getFilename is not a function`; verified). ESLint 9 is past upstream support, but it is a dev-only tool that never ships to users. Upgrade when `eslint-plugin-react` supports ESLint 10. |
| React      | **19.2.3**, exact, monorepo-wide                          | 19.3.0           | Expo SDK 57 requires exactly 19.2.3. One React version across web, admin and mobile avoids duplicate-React bugs in shared packages. Next.js 16 supports it.                                                                                                                                                                                   |
| Next.js    | 16.3.6                                                    | 16.3.6           | Spec asks for 15+. Turbopack builds, `next typegen` for route types.                                                                                                                                                                                                                                                                          |
| Expo       | SDK 57 (`expo ~57.0.25`, RN 0.86.3)                       | 57               | Latest SDK. Transitive `react-native-worklets` and `@react-native/metro-config` are pinned through pnpm `overrides` to the versions in `expo/bundledNativeModules.json`.                                                                                                                                                                      |
| NestJS     | 12.1                                                      | 12.1             | Latest. See below.                                                                                                                                                                                                                                                                                                                            |
| Jest       | 30 + ts-jest 29 (API)                                     | 30               | As the spec asks, following the official NestJS 12 template.                                                                                                                                                                                                                                                                                  |
| Vitest     | 5.0 (packages, worker; web from phase 1)                  | 5.0              | As the spec asks.                                                                                                                                                                                                                                                                                                                             |
| tsup       | 8.5                                                       | 8.5              | Builds `@suskii/shared` to dual ESM + CJS with declarations.                                                                                                                                                                                                                                                                                  |
| Zod        | 4.x                                                       | 4.6              | Shared validation.                                                                                                                                                                                                                                                                                                                            |

### NestJS 12 is ESM-only; the API compiles to CommonJS

`@nestjs/core` 12 ships as ESM only (`"type": "module"`). The official `@nestjs/schematics` 12 app
template still compiles the application to CommonJS (`module: nodenext`, no `"type": "module"`) and
relies on Node's `require(esm)`. We follow the official template because the Nest ecosystem (CLI,
testing, docs) targets it. Consequences:

- Runtime: Node >= 22.12 supports `require(esm)`, and we require 24.9 anyway.
- Tests: Jest 30 loads ESM from CommonJS test files only on Node >= 24.9 with
  `--experimental-vm-modules`. That is why the API `test` scripts run
  `node --experimental-vm-modules ./node_modules/jest/bin/jest.js`, as the template does.
- `@suskii/shared` ships **both** ESM and CJS builds, so CommonJS consumers never depend on
  `require(esm)` for our own code.

### TypeScript 6 migration notes

- TS 6 defaults `types` to `[]`, so every tsconfig lists its ambient types explicitly
  (`["node"]`, `["node", "jest"]`, `["react-native", "expo/types"]`).
- TS 6 requires an explicit `rootDir` when `outDir` is set (`apps/api/tsconfig.json`).
- `tsup`'s declaration build injects `baseUrl`, which TS 6 deprecates. `ignoreDeprecations: "6.0"`
  is scoped to that one step in `packages/shared/tsup.config.ts`. Our own tsconfigs never use
  `baseUrl`. Before any TypeScript 7 move, replace tsup with its successor `tsdown` (1.x).

### Package build strategy

- `@suskii/shared` (and future runtime packages) are **compiled** (tsup to `dist/`), not consumed as
  raw TypeScript, because the API and worker run plain Node without a bundler.
- Turborepo runs `^build` before `lint`, `typecheck`, `test` and `dev`, so consumers always see
  fresh declarations. `packages/config/**` is a global dependency: changing lint or TS rules
  invalidates every cache entry.

### Other tooling choices

- **Type-aware ESLint** (`recommendedTypeChecked` + `stylisticTypeChecked`), with
  `no-floating-promises`, `no-misused-promises` and `switch-exhaustiveness-check` as errors. For
  Nest, the parser is told about decorator metadata so `consistent-type-imports` never turns an
  injected class into a type-only import, which would break dependency injection at runtime.
- **lint-staged** runs ESLint 9 with `--flag v10_config_lookup_from_file` so each file is linted
  with its own workspace's config, then Prettier. The full checks run in CI.
- **CI** uses `turbo --affected` on pull requests (only changed workspaces and their dependents)
  and checks everything on `main` and manual runs.
- **Mobile build in CI**: `expo export` for iOS and Android bundles the app with Metro on every
  affected PR, which catches module resolution breakage in the pnpm monorepo early. Native binaries
  are built only by EAS (phase 7).

## Consequences

- Contributors must use Node 24 LTS. The README covers Windows installation.
- Two version pins trail their newest majors on purpose (TypeScript 6, ESLint 9). Each has a
  concrete unblock condition above. Dependabot keeps GitHub Actions current. The npm update bot
  (Dependabot or Renovate) is chosen in phase 11.
- Pinning React exactly means React upgrades follow Expo SDK upgrades.

## Revisit when

- `eslint-plugin-react` supports ESLint 10, then upgrade ESLint (and drop the lint-staged flag).
- `typescript-eslint` and `@nestjs/cli` support TypeScript 7, then migrate tsup to tsdown and
  upgrade TypeScript.
- Each Expo SDK upgrade: bump React, React Native and the pnpm `overrides` together.
