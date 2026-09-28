import { defineConfig } from 'tsup';

// Dual ESM + CJS output: Next.js, Metro and the ESM worker import the ESM build;
// the NestJS API (CommonJS) and Jest require the CJS build.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: {
    compilerOptions: {
      // tsup's declaration build injects `baseUrl`, which TypeScript 6 flags as deprecated.
      // Scoped to the dts step only; our own tsconfigs never set baseUrl (see ADR-002).
      ignoreDeprecations: '6.0',
    },
  },
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
});
