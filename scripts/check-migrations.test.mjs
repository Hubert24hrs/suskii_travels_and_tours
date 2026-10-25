import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkMigration } from './check-migrations.mjs';

const reasons = (sql) => checkMigration(sql).map((finding) => finding.reason);

describe('checkMigration (expand/contract guard)', () => {
  it('accepts the additive changes an expand release makes', () => {
    const sql = `
      -- CreateTable
      CREATE TABLE "rides" ("id" UUID NOT NULL, "fare" NUMERIC(10,2) NOT NULL, CONSTRAINT "rides_pkey" PRIMARY KEY ("id"));
      CREATE INDEX "rides_fare_idx" ON "rides"("fare");
      ALTER TABLE "payments" ADD COLUMN "installment_id" UUID,
      ADD COLUMN "kind" "PaymentKind" NOT NULL DEFAULT 'checkout',
      ADD COLUMN "amount" NUMERIC(10,2) NOT NULL DEFAULT 0,
      ALTER COLUMN "checkout_url" DROP NOT NULL;
      CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON "audit_log"
        FOR EACH STATEMENT EXECUTE FUNCTION audit_log_reject_mutation();
      -- DROP TABLE "old" is only mentioned in this comment
      ALTER TYPE "RideStatus" ADD VALUE 'no_driver';
    `;
    assert.deepEqual(reasons(sql), []);
  });

  it('flags every statement that breaks the revision still serving traffic', () => {
    const cases = [
      ['DROP TABLE "legacy";', 'drops a table'],
      ['ALTER TABLE "bookings" DROP COLUMN "legacy_code";', 'drops a column'],
      ['ALTER TABLE "bookings" RENAME COLUMN "ref" TO "reference";', 'renames a column'],
      ['ALTER TABLE "bookings" RENAME TO "orders";', 'renames a table'],
      ['ALTER TABLE "bookings" ALTER COLUMN "total" TYPE BIGINT;', "changes a column's type"],
      [
        'ALTER TABLE "bookings" ALTER COLUMN "total" SET DATA TYPE BIGINT;',
        "changes a column's type",
      ],
      ['ALTER TABLE "bookings" ALTER COLUMN "email" SET NOT NULL;', 'makes a column NOT NULL'],
      ['TRUNCATE "search_logs";', 'truncates a table'],
      [
        'ALTER TABLE "bookings" ADD COLUMN "channel" TEXT NOT NULL;',
        'adds a NOT NULL column without a default',
      ],
      [
        "ALTER TYPE \"RideStatus\" RENAME VALUE 'gone' TO 'cancelled';",
        'renames a type or enum value',
      ],
      ['DROP TYPE "RideStatus_old";', 'drops a type'],
    ];
    for (const [sql, reason] of cases) assert.deepEqual(reasons(sql), [reason], sql);
  });

  it('flags the enum rebuild Prisma writes when a value is removed', () => {
    const sql = `
      ALTER TYPE "Role" RENAME TO "Role_old";
      CREATE TYPE "Role" AS ENUM ('customer', 'staff');
      ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
      DROP TYPE "Role_old";
    `;
    assert.deepEqual(reasons(sql), [
      'renames a type or enum value',
      "changes a column's type",
      'drops a type',
    ]);
  });

  it('reports the line each finding starts on', () => {
    const sql = 'CREATE TABLE "a" ("id" INT);\n\nALTER TABLE "b"\n  DROP COLUMN "c";\n';
    assert.deepEqual(checkMigration(sql), [{ line: 3, reason: 'drops a column' }]);
  });

  it('lets a contract migration through when it says why it is safe', () => {
    const sql = `-- expand-contract: the 2026.11 release stopped reading bookings.legacy_code
ALTER TABLE "bookings" DROP COLUMN "legacy_code";`;
    assert.deepEqual(reasons(sql), []);
    // A note without a reason does not count.
    assert.deepEqual(reasons(`-- expand-contract: ok\n${sql.split('\n')[1]}`), ['drops a column']);
  });
});
