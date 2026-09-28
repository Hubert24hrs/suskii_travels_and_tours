// ESLint config for the Expo (React Native) app.
import expoConfig from 'eslint-config-expo/flat.js';

import { baseConfig } from './base.mjs';

/**
 * @param {Parameters<typeof baseConfig>[0]} options
 * @returns {import('eslint').Linter.Config[]}
 */
export function expoAppConfig(options) {
  const [ignores, ...rest] = baseConfig(options);
  return [ignores, ...expoConfig, ...rest];
}
