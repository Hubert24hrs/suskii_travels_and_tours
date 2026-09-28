import { defineConfig } from 'tsup';

// Dual ESM + CJS: the web toolchain imports ESM; NativeWind's tailwind.config.js and Jest require CJS.
export default defineConfig({
  entry: ['src/index.ts', 'src/tailwind-preset.ts'],
  format: ['esm', 'cjs'],
  dts: {
    compilerOptions: {
      // tsup's declaration build injects the TS 6-deprecated `baseUrl` (ADR-002).
      ignoreDeprecations: '6.0',
    },
  },
  sourcemap: true,
  clean: true,
  target: 'es2022',
  treeshake: true,
});
