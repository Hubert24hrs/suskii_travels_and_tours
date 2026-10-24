# Dependency exceptions

CI fails on any high or critical advisory in production dependencies (`pnpm audit --prod
--audit-level high`) and on any fixable high or critical finding from Trivy. An advisory may be
ignored only when no fixed release exists and the vulnerable code cannot be reached from anything
the platform runs for users. Each exception is listed here and by id in `pnpm-workspace.yaml`
(`auditConfig.ignoreGhsas`), and is reviewed monthly and on every Expo SDK upgrade.

| Advisory            | Package and path                                   | Why it is not reachable                                                                                                                                                                                                      | Added      | Review by  |
| ------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- |
| GHSA-86w9-cpqp-85rv | `node-forge` via `expo` > `@expo/cli`              | The Expo CLI uses it on developer machines and in CI, for development certificates and code-signing tooling. It is not bundled into the app, the API, the worker or the websites, and no user-supplied signature reaches it. | 2026-10-06 | 2026-11-06 |
| GHSA-vfj7-8cjw-p6xm | `braces` via `expo` > `@expo/cli` > Metro file map | Metro expands glob patterns written in the project's own configuration while bundling. It never receives patterns from users, and it does not run in production.                                                             | 2026-10-06 | 2026-11-06 |

## Overrides

Transitive packages forced to a fixed release in `pnpm-workspace.yaml` (`overrides`), until the
parent package depends on it:

| Package          | Fixed in | Pulled in by                                      | Advisory                                 |
| ---------------- | -------- | ------------------------------------------------- | ---------------------------------------- |
| `deepmerge-ts`   | 8.0.0    | `@prisma/config` (pins 7.1.5; only `deepmerge()`) | GHSA-ggr8-5vv4-36mx                      |
| `mysql2`         | 3.22.0   | the Prisma CLI (MySQL driver; unused here)        | GHSA-3f6p-5ww8-9rcr                      |
| `shell-quote`    | 1.11.0   | `react-devtools-core` (React Native dev tooling)  | GHSA-pqg4-j6r4-53mv                      |
| `source-map-js`  | 1.2.2    | `postcss`, Tailwind                               | GHSA-68fv-2mgg-jv7q                      |
| `handlebars`     | 4.7.10   | `ts-jest` (tests only)                            | GHSA-8r5x-fm3f-whwj, GHSA-p8wg-vrv2-v86f |
| `undici`         | 8.12.3   | `testcontainers` (tests only)                     | GHSA-xjj6-f33q-929c                      |
| `fast-uri`       | 3.1.9    | `ajv` in commitlint (developer tooling)           | GHSA-w74x-v6f9-j3xg                      |
| `zod` (4.x)      | 4.6.7    | `eslint-plugin-react-hooks` (lint only)           | GHSA-mrhx-c7xc-m3w5                      |
| `zod` (Expo CLI) | 4.6.7    | `@expo/cli` (pins 3.x; dev-tools plugin schemas)  | GHSA-mrhx-c7xc-m3w5                      |

Prisma's CLI (`generate`, `migrate deploy`, `migrate status`) was checked with the
`deepmerge-ts` 8 override. The Expo CLI was checked with zod 4: its plugin and MCP schemas accept
and reject the same input, `expo export` and `expo prebuild` complete, and the bundle scan is clean.

## Open advisories (not ignored)

Found by the end-to-end audit on 2026-10-24 (`docs/audits/e2e-audit.md`). They are **not** in
`auditConfig.ignoreGhsas`, so CI's audit stays red until each is upgraded. The first two are blocked
by the pnpm trust policy: re-resolving the Babel graph that `next` 16.4 and Storybook 10.6.3 touch
reaches `semver@6.3.1`, which pnpm refuses as a trust downgrade (it was published after semver
7.5.x, which carried provenance). The policy was not relaxed without the owner.

| Advisory                                                   | Package                                | Fixed in | Blocked by                                  | Exposure until then                                                                                                                                              |
| ---------------------------------------------------------- | -------------------------------------- | -------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GHSA-2464-fhr4-w9xw (critical)                             | `next` 16.3.8 (web, admin)             | 16.4.1   | Trust policy (`semver@6.3.1`)               | The flaw is in `sharp` below 0.35.5; the lockfile already resolves `sharp` 0.35.5, the advisory's workaround.                                                    |
| GHSA-673q-mjm6-r5xr (critical)                             | `next` 16.3.8                          | 16.4.1   | Trust policy                                | Needs a `use cache` function returning typed arrays; neither app has a `use cache` function.                                                                     |
| GHSA-p3m5-59mp-jv5r (high)                                 | `next` 16.3.8                          | 16.4.1   | Trust policy                                | Needs at least one Server Action. The website's only two (currency and locale) became a route handler (`app/preferences/[name]/route.ts`); the console has none. |
| GHSA-f2ph-cmg5-wxc8 (critical), GHSA-px85-f4q5-jh77 (high) | `storybook` 10.6.0 (ui-web)            | 10.6.2   | Trust policy                                | Storybook's dev server on developer machines; nothing is deployed. Do not run `storybook dev` while browsing untrusted sites until upgraded.                     |
| GHSA-27r3-jxmh-p828 (high)                                 | `body-parser` 2.3.0 (API, via Express) | 2.4.0    | Release cooldown until 2026-10-25 11:39 UTC | Triggered by compressed request bodies. The API refuses any `Content-Encoding` other than identity with 415 before decompressing (`app.setup.ts`, platform e2e). |
| GHSA-q7qp-rjg7-q26m (high)                                 | `multer` 2.4.0 (API, via Nest)         | 2.5.0    | Release cooldown until 2026-10-25 11:58 UTC | The API never parses multipart bodies (no `FileInterceptor`; uploads are raw bodies), so multer never runs.                                                      |
