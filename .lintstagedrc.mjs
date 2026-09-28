// Runs on `git commit` via Husky. Full lint/typecheck/test runs in CI.
import path from 'node:path';

const LINTABLE = /^(apps|packages)\/.+\.(ts|tsx|js|jsx|mjs|cjs)$/;

const quote = (files) => files.map((file) => JSON.stringify(file)).join(' ');
const toPosixRelative = (file) => path.relative(process.cwd(), file).split(path.sep).join('/');

/** @type {import('lint-staged').Configuration} */
const config = {
  // One task list for every staged file so ESLint and Prettier never race on the same file.
  '*': (files) => {
    const lintable = files.filter((file) => LINTABLE.test(toPosixRelative(file)));
    return [
      // The v10 lookup flag makes ESLint 9 use the nearest eslint.config.mjs per file,
      // so each workspace's own type-aware config applies.
      ...(lintable.length > 0
        ? [`eslint --flag v10_config_lookup_from_file --fix --no-warn-ignored ${quote(lintable)}`]
        : []),
      `prettier --write --ignore-unknown ${quote(files)}`,
    ];
  },
};

export default config;
