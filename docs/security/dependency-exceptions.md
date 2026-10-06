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

| Package         | Fixed in | Pulled in by                                      | Advisory            |
| --------------- | -------- | ------------------------------------------------- | ------------------- |
| `deepmerge-ts`  | 8.0.0    | `@prisma/config` (pins 7.1.5; only `deepmerge()`) | GHSA-ggr8-5vv4-36mx |
| `mysql2`        | 3.22.0   | the Prisma CLI (MySQL driver; unused here)        | GHSA-3f6p-5ww8-9rcr |
| `shell-quote`   | 1.11.0   | `react-devtools-core` (React Native dev tooling)  | GHSA-pqg4-j6r4-53mv |
| `source-map-js` | 1.2.2    | `postcss`, Tailwind                               | GHSA-68fv-2mgg-jv7q |

Prisma's CLI (`generate`, `migrate deploy`, `migrate status`) was checked with the
`deepmerge-ts` 8 override.
