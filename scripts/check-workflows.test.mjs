import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { jobConditions, unavailableContexts, workflowIssues } from './check-workflows.mjs';

const workflow = (job) => `name: Example
on:
  workflow_dispatch:
    inputs:
      suite:
        type: choice
        options: [all, routing]
jobs:
${job}
`;

describe('check-workflows (job conditions GitHub can read)', () => {
  it('refuses a job condition that names the matrix: the mistake that kept a workflow from loading', () => {
    const source = workflow(`  eval:
    name: Eval (\${{ matrix.suite }})
    if: inputs.suite == 'all' || inputs.suite == matrix.suite
    runs-on: ubuntu-latest
    strategy:
      matrix:
        suite: [routing, grounding]
    steps:
      - run: echo`);
    const issues = workflowIssues('example.yml', source);
    assert.equal(issues.length, 1);
    assert.match(issues[0], /^example\.yml:11: the job "eval" names the matrix context/);
  });

  it('accepts the contexts a job condition may read, and the matrix built from an input', () => {
    const source = workflow(`  build:
    if: github.event_name == 'workflow_dispatch' || vars.DEPLOY_ENABLED == 'true'
    runs-on: ubuntu-latest
    steps:
      - run: echo
  eval:
    name: Eval (\${{ matrix.suite }})
    needs: build
    if: \${{ inputs.suite != 'none' && needs.build.result == 'success' }}
    runs-on: ubuntu-latest
    strategy:
      matrix:
        suite: >-
          \${{ fromJSON(inputs.suite == 'all' && '["routing","grounding"]' ||
          format('["{0}"]', inputs.suite)) }}
    steps:
      - if: matrix.suite == 'routing' && runner.os == 'Linux' && env.CI
        run: echo`);
    assert.deepEqual(workflowIssues('example.yml', source), []);
    assert.deepEqual(
      jobConditions(source).map(({ job }) => job),
      ['build', 'eval'],
    );
  });

  it('reads a folded condition as one expression', () => {
    const source = workflow(`  deploy:
    if: >-
      github.event_name == 'workflow_dispatch' ||
      (vars.DEPLOY_ENABLED == 'true' && secrets.TOKEN != '')
    runs-on: ubuntu-latest
    steps:
      - run: echo`);
    const [condition] = jobConditions(source);
    assert.equal(
      condition.expression,
      "github.event_name == 'workflow_dispatch' || (vars.DEPLOY_ENABLED == 'true' && secrets.TOKEN != '')",
    );
    assert.match(workflowIssues('example.yml', source)[0], /names the secrets context/);
  });

  it('names every context that does not exist yet, and leaves quoted text alone', () => {
    assert.deepEqual(unavailableContexts("steps.build.outcome == 'success' && runner.os"), [
      'steps',
      'runner',
    ]);
    assert.deepEqual(unavailableContexts('matrix.os == runner.os && env.CI && job.status'), [
      'matrix',
      'runner',
      'env',
      'job',
    ]);
    assert.deepEqual(
      unavailableContexts("inputs.target == 'matrix.suite' || inputs.env == 'x'"),
      [],
    );
    assert.deepEqual(
      unavailableContexts("github.event.inputs.matrix == 'a' && needs.env.result"),
      [],
    );
  });

  it('finds nothing wrong in the workflows of this repository', () => {
    const directory = join(
      fileURLToPath(new URL('.', import.meta.url)),
      '..',
      '.github',
      'workflows',
    );
    const files = readdirSync(directory).filter((name) => /\.ya?ml$/.test(name));
    assert.ok(files.length >= 10, 'the workflow files were found');
    const issues = files.flatMap((name) =>
      workflowIssues(name, readFileSync(join(directory, name), 'utf8')),
    );
    assert.deepEqual(issues, []);
  });
});
