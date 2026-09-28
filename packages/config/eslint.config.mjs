import { nodeConfig } from './eslint/node.mjs';

// This package is plain ESM JavaScript (plus one hand-written .d.mts), so type-aware
// rules are off via the base config's JS override and declarations are skipped.
export default nodeConfig({ tsconfigRootDir: import.meta.dirname, ignores: ['**/*.d.mts'] });
