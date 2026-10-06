import { defineConfig } from 'vitest/config';

import base from './vitest.config';

/**
 * Visual regression (phase 11): key components rendered from their stories and compared with
 * reference screenshots. References are made on the CI image (`visual-baselines.yml`), because
 * font rasterising differs between Chromium builds and operating systems. `pnpm test:visual`
 * compares; add `--update` to rewrite them.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['src/**/*.visual.tsx'],
    browser: {
      ...base.test?.browser,
      viewport: { width: 480, height: 640 },
      expect: {
        toMatchScreenshot: {
          comparatorName: 'pixelmatch',
          // Anti-aliasing may move a few edge pixels; a real change moves far more than 1%.
          comparatorOptions: { threshold: 0.2, allowedMismatchedPixelRatio: 0.01 },
        },
      },
    },
  },
});
