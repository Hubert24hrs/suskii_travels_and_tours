#!/usr/bin/env node
/**
 * Expand/contract guard for Prisma migrations (ADR-060). A release runs `migrate deploy` while the
 * previous revision still serves traffic, so a new migration must keep that revision working:
 * add tables, nullable columns or columns with defaults, indexes and constraints the old code
 * already satisfies. Dropping or renaming a table or column, changing a column's type, making a
 * column NOT NULL, adding a NOT NULL column without a default, or truncating a table breaks it.
 *
 * Such a statement passes only in a migration that says why it is safe, on its own line:
 *   -- expand-contract: the 2026.11 release stopped reading bookings.legacy_code
 * (the contract step of an earlier expand, after every revision using the old shape is gone).
 *
 *   node scripts/check-migrations.mjs                 # migrations added since origin/<base>
 *   node scripts/check-migrations.mjs --base main     # compare with another branch
 *   node scripts/check-migrations.mjs path/to/migration.sql ...
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = 'apps/api/prisma/migrations';
const ACKNOWLEDGEMENT = /^\s*--\s*expand-contract:\s*\S.{9,}$/im;

/** Statements that break the revision still serving traffic, with the reason shown. */
export const RULES = [
  { pattern: /\bDROP\s+TABLE\b/i, reason: 'drops a table' },
  { pattern: /\bDROP\s+COLUMN\b/i, reason: 'drops a column' },
  { pattern: /\bRENAME\s+COLUMN\b/i, reason: 'renames a column' },
  { pattern: /\bALTER\s+TABLE\b[^;]*\bRENAME\s+TO\b/i, reason: 'renames a table' },
  { pattern: /\bALTER\s+TYPE\b[^;]*\bRENAME\b/i, reason: 'renames a type or enum value' },
  { pattern: /\bDROP\s+TYPE\b/i, reason: 'drops a type' },
  {
    pattern: /\bALTER\s+COLUMN\b[^;]*\b(SET\s+DATA\s+)?TYPE\b/i,
    reason: "changes a column's type",
  },
  { pattern: /\bALTER\s+COLUMN\b[^;]*\bSET\s+NOT\s+NULL\b/i, reason: 'makes a column NOT NULL' },
  // A TRUNCATE statement (a `BEFORE TRUNCATE` trigger that guards a table is not one).
  { pattern: /^TRUNCATE\b/i, reason: 'truncates a table' },
  {
    test: (statement) =>
      clauses(statement).some(
        (clause) =>
          /^ADD\s+COLUMN\b/i.test(clause) &&
          /\bNOT\s+NULL\b/i.test(clause) &&
          !/\bDEFAULT\b/i.test(clause),
      ),
    reason: 'adds a NOT NULL column without a default',
  },
];

/**
 * The comma-separated actions of an ALTER TABLE (`ADD COLUMN ..., ALTER COLUMN ...`), split at
 * top-level commas only, so `NUMERIC(10,2)` or a default string stays in one clause.
 */
function clauses(statement) {
  const body = statement.replace(/^ALTER\s+TABLE\s+("[^"]+"|\S+)\s*/i, '');
  const parts = [];
  let depth = 0;
  let quote = null;
  let current = '';
  for (const character of body) {
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
    } else if (character === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Statements of a migration with comments removed, each with the line it starts on. */
function statements(sql) {
  const result = [];
  let current = '';
  let startLine = 1;
  const lines = sql.split('\n');
  lines.forEach((raw, index) => {
    const line = raw.replace(/--.*$/, '');
    if (current.trim() === '') startLine = index + 1;
    current += `${line}\n`;
    if (line.includes(';')) {
      for (const [position, part] of current.split(';').entries()) {
        if (position === current.split(';').length - 1) {
          current = part;
        } else if (part.trim()) {
          result.push({ text: part.trim(), line: startLine });
        }
      }
      startLine = index + 2;
    }
  });
  if (current.trim()) result.push({ text: current.trim(), line: startLine });
  return result;
}

/** Findings for one migration: [] when it is safe or says why its contract step is. */
export function checkMigration(sql) {
  if (ACKNOWLEDGEMENT.test(sql)) return [];
  const findings = [];
  for (const statement of statements(sql)) {
    for (const rule of RULES) {
      const hit = rule.test ? rule.test(statement.text) : rule.pattern.test(statement.text);
      if (hit) findings.push({ line: statement.line, reason: rule.reason });
    }
  }
  return findings;
}

function addedMigrations(base) {
  const range = `origin/${base}...HEAD`;
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--diff-filter=A', range, '--', `${MIGRATIONS}/*/migration.sql`],
    { cwd: ROOT, encoding: 'utf8' },
  );
  return output
    .split('\n')
    .filter(Boolean)
    .map((file) => join(ROOT, file));
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { base: { type: 'string', default: process.env.GITHUB_BASE_REF || 'main' } },
  });
  const files = positionals.length > 0 ? positionals : addedMigrations(values.base);
  let failures = 0;
  for (const file of files) {
    for (const finding of checkMigration(readFileSync(file, 'utf8'))) {
      failures += 1;
      process.stdout.write(`${relative(ROOT, file)}:${finding.line}: ${finding.reason}\n`);
    }
  }
  if (failures > 0) {
    process.stdout.write(
      `\n${failures} statement(s) would break the revision still serving traffic. Split the change ` +
        'into expand and contract releases, or add an "-- expand-contract: <why it is safe now>" ' +
        'line to a contract migration (docs/runbooks/deploy-and-rollback.md).\n',
    );
    process.exit(1);
  }
  process.stdout.write(
    `check-migrations: ${files.length} migration(s) checked, all backwards-compatible\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
