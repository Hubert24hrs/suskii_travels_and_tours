# @suskii/config

Shared tooling configuration. Nothing here ships to production.

| Export                           | Use                                                               |
| -------------------------------- | ----------------------------------------------------------------- |
| `@suskii/config/tsconfig/*.json` | `base` (strict), `library`, `node`, `nestjs`, `nextjs` presets    |
| `@suskii/config/eslint/base`     | `baseConfig({ tsconfigRootDir })`: type-aware TS rules + Prettier |
| `@suskii/config/eslint/node`     | `nodeConfig(...)` for Node services and libraries                 |
| `@suskii/config/eslint/nest`     | `nestConfig(...)` with decorator-metadata-safe type import rules  |
| `@suskii/config/eslint/next`     | `nextConfig(...)` = base + `eslint-config-next/core-web-vitals`   |
| `@suskii/config/eslint/expo`     | `expoAppConfig(...)` = base + `eslint-config-expo`                |
| `@suskii/config/prettier`        | Prettier options (re-exported by the root `prettier.config.mjs`)  |
| `@suskii/config/vitest`          | `baseVitestConfig` to merge into workspace Vitest configs         |

Example `eslint.config.mjs` in a workspace:

```js
import { nodeConfig } from '@suskii/config/eslint/node';

export default nodeConfig({ tsconfigRootDir: import.meta.dirname });
```

Changing anything in this package invalidates every Turborepo cache entry (it is listed in
`globalDependencies`), because lint and type rules affect every workspace.
