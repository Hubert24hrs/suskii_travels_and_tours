#!/usr/bin/env node
// Checks the GitHub workflow files for a mistake GitHub answers by refusing the whole file.
//
// A job's own `if` is evaluated before the job's matrix, runner, steps or secrets exist. It may
// name only the `github`, `needs`, `vars` and `inputs` contexts. A workflow whose job condition
// names another one (`if: inputs.suite == matrix.suite`) is not loaded at all: it cannot be
// started by hand, and every push records a failed run with no job and the file's path for a
// name. Nothing in a pull request's checks shows it. agent-eval.yml was in that state from the
// day it was added until this check was written.
//
// What to do instead: build the matrix from the input (`strategy.matrix` may read `inputs`),
// or put the condition on the steps.
//
//   node scripts/check-workflows.mjs            (every file in .github/workflows)
//   node scripts/check-workflows.mjs a.yml b.yml
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Contexts a job-level `if` cannot read: they do not exist yet when it is evaluated. */
const NOT_YET = ['matrix', 'strategy', 'steps', 'runner', 'env', 'secrets', 'job'];

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * The `if` of each job in a workflow: `{ job, line, expression }`, with a folded or literal
 * condition joined into one line. Reads the layout Prettier gives the files (jobs at two
 * spaces, their keys at four), which the format check enforces.
 */
export function jobConditions(source) {
  const lines = source.split('\n');
  const found = [];
  let inJobs = false;
  let job = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const indent = indentOf(line);
    if (indent === 0) {
      inJobs = /^jobs:\s*(#.*)?$/.test(line);
      job = null;
      continue;
    }
    if (!inJobs) continue;
    if (indent === 2) {
      job = /^ {2}([\w-]+):/.exec(line)?.[1] ?? null;
      continue;
    }
    const condition = indent === 4 && job ? /^ {4}if:\s*(.*)$/.exec(line) : null;
    if (!condition) continue;
    const parts = [];
    const first = condition[1].trim();
    // `if: >-` or `if: |`: the condition is the indented block that follows.
    if (!/^[>|][+-]?$/.test(first) && first !== '') parts.push(first);
    let next = index + 1;
    while (next < lines.length && (lines[next].trim() === '' || indentOf(lines[next]) > 4)) {
      if (lines[next].trim() !== '') parts.push(lines[next].trim());
      next += 1;
    }
    found.push({ job, line: index + 1, expression: parts.join(' ') });
  }
  return found;
}

/** The contexts a job condition names that do not exist when it is read. Quoted text is not code. */
export function unavailableContexts(expression) {
  const code = expression.replace(/'(?:[^']|'')*'/g, "''");
  return NOT_YET.filter((context) => new RegExp(`(^|[^\\w.])${context}\\s*[.[]`).test(code));
}

/** What is wrong with one workflow file, as sentences; empty when nothing is. */
export function workflowIssues(file, source) {
  return jobConditions(source).flatMap(({ job, line, expression }) =>
    unavailableContexts(expression).map(
      (context) =>
        `${file}:${line}: the job "${job}" names the ${context} context in its own "if". ` +
        'GitHub reads a job\'s "if" before that context exists and refuses to load the workflow. ' +
        'Build the matrix from the input, or put the condition on the steps.',
    ),
  );
}

function main(args) {
  const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
  const directory = join(root, '.github', 'workflows');
  const files =
    args.length > 0
      ? args
      : readdirSync(directory)
          .filter((name) => /\.ya?ml$/.test(name))
          .sort()
          .map((name) => join('.github', 'workflows', name));
  const issues = files.flatMap((file) =>
    workflowIssues(file, readFileSync(join(root, file), 'utf8')),
  );
  for (const issue of issues) process.stderr.write(`${issue}\n`);
  if (issues.length > 0) process.exit(1);
  process.stdout.write(`${files.length} workflow files: every job condition can be read.\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2));
}
