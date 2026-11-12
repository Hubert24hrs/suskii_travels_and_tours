# Dependency exceptions

CI fails on any high or critical advisory in production dependencies (`pnpm audit --prod
--audit-level high`) and on any fixable high or critical finding from Trivy. An advisory may be
ignored only when no fixed release exists and the vulnerable code cannot be reached from anything
the platform runs for users, or when the fix is backported as a patch the parent can load
(Patched in place, below). Each exception is listed here and by id in `pnpm-workspace.yaml`
(`auditConfig.ignoreGhsas`), and is reviewed monthly and on every Expo SDK upgrade.

| Advisory            | Package and path                                   | Why it is not reachable                                                                                                                                          | Added      | Review by  |
| ------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------- |
| GHSA-vfj7-8cjw-p6xm | `braces` via `expo` > `@expo/cli` > Metro file map | Metro expands glob patterns written in the project's own configuration while bundling. It never receives patterns from users, and it does not run in production. | 2026-10-06 | 2026-12-09 |

## Patched in place

`pnpm-workspace.yaml` (`patchedDependencies`) applies a patch from `patches/` when the fixed release
cannot be used. pnpm audit and Trivy still report the package's version, so the advisory is also
listed in `ignoreGhsas` and, under Trivy's id, in `.trivyignore`.

| Package and path                                                | Advisories                                                                               | Patch                                                                                                                                                                                                                                                                                                                                                                                                                          | Added      | Review by  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ---------- |
| `decode-uri-component` 0.2.2 via `expo-router` > `query-string` | GHSA-qr28-fpjm-wq7f (high; Trivy: CVE-2026-118664), GHSA-vcc3-ghjq-m6fr (CVE-2026-45822) | `patches/decode-uri-component@0.2.2.patch`: 0.5.1's linear decoder as CommonJS (the fixed 0.5 line is ESM-only and `query-string` 7 requires CommonJS), keeping 0.2.2's export (`+` is a space). On a 224 KB input with 22,400 distinct runs it takes 112 ms (0.2.2: 1.9 s); on a 3.6 KB malformed run 1 ms (0.2.2: 17 s). The 30 upstream cases decode the same; on malformed input it decodes the valid parts as 0.5.1 does. | 2026-11-09 | 2026-12-09 |

Drop the patch once `expo-router` moves to a `query-string` that loads the fixed line.

## Overrides

Transitive packages forced to a fixed release in `pnpm-workspace.yaml` (`overrides`), until the
parent package depends on it:

| Package             | Fixed in | Pulled in by                                               | Advisory                                       |
| ------------------- | -------- | ---------------------------------------------------------- | ---------------------------------------------- |
| `deepmerge-ts`      | 8.0.0    | `@prisma/config` (pins 7.1.5; only `deepmerge()`)          | GHSA-ggr8-5vv4-36mx                            |
| `mysql2`            | 3.22.0   | the Prisma CLI (MySQL driver; unused here)                 | GHSA-3f6p-5ww8-9rcr                            |
| `shell-quote`       | 1.11.0   | `react-devtools-core` (React Native dev tooling)           | GHSA-pqg4-j6r4-53mv                            |
| `source-map-js`     | 1.2.2    | `postcss`, Tailwind                                        | GHSA-68fv-2mgg-jv7q                            |
| `handlebars`        | 4.7.10   | `ts-jest` (tests only)                                     | GHSA-8r5x-fm3f-whwj, GHSA-p8wg-vrv2-v86f       |
| `undici`            | 8.12.3   | `testcontainers` (tests only)                              | GHSA-xjj6-f33q-929c                            |
| `fast-uri`          | 3.1.9    | `ajv` in commitlint (developer tooling)                    | GHSA-w74x-v6f9-j3xg                            |
| `zod` (4.x)         | 4.6.7    | `eslint-plugin-react-hooks` (lint only)                    | GHSA-mrhx-c7xc-m3w5                            |
| `zod` (Expo CLI)    | 4.6.7    | `@expo/cli` (pins 3.x; dev-tools plugin schemas)           | GHSA-mrhx-c7xc-m3w5                            |
| `zod` (Lighthouse)  | 4.6.7    | `chromium-bidi` via puppeteer (pins 3.x; BiDi mapper only) | GHSA-mrhx-c7xc-m3w5                            |
| `semver` (6.x)      | 7.8.5    | Babel 7, `eslint-plugin-import`/`react`, istanbul (pin 6)  | Trust policy (6.3.1 has no provenance)         |
| `body-parser`       | 2.4.0    | Express 5 in `@nestjs/platform-express`                    | GHSA-27r3-jxmh-p828                            |
| `multer`            | 2.5.0    | `@nestjs/platform-express` (no multipart route here)       | GHSA-q7qp-rjg7-q26m                            |
| `systeminformation` | 5.33.16  | OpenTelemetry host metrics in the API (Windows-only flaw)  | GHSA-3f7j-7jwc-fxfj                            |
| `node-forge`        | 1.4.1    | `@expo/cli` (development certificates)                     | GHSA-86w9-cpqp-85rv and five more (2026-10-30) |

Prisma's CLI (`generate`, `migrate deploy`, `migrate status`) was checked with the
`deepmerge-ts` 8 override. The Expo CLI was checked with zod 4: its plugin and MCP schemas accept
and reject the same input, `expo export` and `expo prebuild` complete, and the bundle scan is clean. Lighthouse was run end to end with chromium-bidi on zod 4: puppeteer only loads the BiDi
mapper for the WebDriver BiDi protocol, and Lighthouse drives Chrome over CDP.

## Open advisories (not ignored)

Moderate and low advisories CI does not gate on (it fails on high and critical), reviewed
2026-10-27. None has a fixed release the parent package accepts:

| Advisory            | Severity | Package and path                                               | Why it stays for now                                                                                  |
| ------------------- | -------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| GHSA-w5hq-g745-h8pq | Moderate | `uuid` 7.0.3 via `expo` > `@expo/config-plugins` > `xcode`     | Runs only in `expo prebuild` on developer machines and CI; the vulnerable `buf` argument is not used. |
| GHSA-rj75-hqrm-r3gf | Moderate | `postcss-selector-parser` 6.1.4 via `tailwindcss` (NativeWind) | Build time only, on the project's own class names.                                                    |
| GHSA-g7r4-m6w7-qqqr | Low      | `esbuild` 0.27.7 via `tsup` (design tokens build)              | Affects esbuild's development server on Windows; the tokens build never starts it.                    |

Earlier, the end-to-end audit on 2026-10-24 (`docs/audits/e2e-audit.md`) found four that were not
ignored; all are fixed without relaxing the pnpm trust policy or the release cooldown:

- `next` 16.4.1 and Storybook 10.6.3 (2026-10-24): the only semver 6 release with the ReDoS fix
  (6.3.1) has no provenance, so the `semver@<7` override moves its users (Babel 7, two ESLint
  plugins, istanbul) to semver 7.8.5, which keeps every function they call (`satisfies`,
  `intersects`, `lt`, `gt`, `valid`, `parse`).
- `body-parser` 2.4.0 (GHSA-27r3-jxmh-p828) and `multer` 2.5.0 (GHSA-q7qp-rjg7-q26m)
  (2026-10-25): installed through the overrides above once both passed the three-day release
  cooldown (published 2026-10-22 11:39 and 11:58 UTC). The API keeps refusing compressed request
  bodies (415, `app.setup.ts`) and registers no multipart route.
