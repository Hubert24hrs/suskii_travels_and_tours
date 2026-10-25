import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';

import { Client } from 'pg';

/**
 * The application's own database role (ADR-060, ASVS V13.2.2). Migrations run as the role that
 * owns the schema; the API connects as a separate role that may only read and write rows. This
 * step of a release (scripts/release-database.mjs, as the owner) creates that role when it is
 * missing, sets its password from DATABASE_APP_URL as a SCRAM verifier (the password itself never
 * reaches the server or its logs), grants it data access, and refuses to finish if the role can
 * do more than that.
 */

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const MIN_PASSWORD_LENGTH = 24;

/**
 * A PostgreSQL SCRAM-SHA-256 verifier (RFC 5802, RFC 7677) in the form `pg_authid` stores, as
 * `psql \password` sends it. Generated passwords are ASCII, so SASLprep leaves them unchanged.
 */
export function scramVerifier(
  password: string,
  { salt = randomBytes(16), iterations = 4096 }: { salt?: Buffer; iterations?: number } = {},
): string {
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}

/** Credentials of the app role from its connection URL; errors never include them. */
export function appCredentials(appUrl: string): { role: string; password: string } {
  const url = new URL(appUrl);
  const role = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!ROLE_NAME.test(role)) {
    throw new Error('app-role: the app user must be a lower-case identifier');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `app-role: the app password must have at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
  return { role, password };
}

interface RoleCheck {
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolreplication: boolean;
  rolbypassrls: boolean;
  member_of_roles: boolean;
  creates_in_schema: boolean;
  creates_schemas: boolean;
  owns_tables: boolean;
}

/**
 * Creates or updates the app role through the owner's connection, then checks it holds no
 * attribute, membership or schema right beyond reading and writing rows.
 */
export async function ensureAppRole(
  ownerUrl: string,
  appUrl: string,
): Promise<{ role: string; created: boolean }> {
  const { role, password } = appCredentials(appUrl);
  const client = new Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ owner: string; database: string }>(
      'SELECT current_user AS owner, current_database() AS database',
    );
    const { owner, database } = rows[0] ?? { owner: '', database: '' };
    if (owner === role) {
      throw new Error('app-role: migrations and the app must connect as different roles');
    }
    const name = client.escapeIdentifier(role);
    const existing = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
    const created = existing.rowCount === 0;
    // Only LOGIN and the password are set: a non-superuser owner cannot change attributes such as
    // SUPERUSER at all, so they are verified below instead.
    if (created) await client.query(`CREATE ROLE ${name} LOGIN`);
    await client.query(
      `ALTER ROLE ${name} WITH LOGIN PASSWORD ${client.escapeLiteral(scramVerifier(password))}`,
    );

    for (const statement of [
      `GRANT CONNECT ON DATABASE ${client.escapeIdentifier(database)} TO ${name}`,
      `GRANT USAGE ON SCHEMA public TO ${name}`,
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${name}`,
      `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${name}`,
      `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${name}`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${name}`,
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${name}`,
    ]) {
      await client.query(statement);
    }

    const check = await client.query<RoleCheck>(
      `SELECT r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolreplication, r.rolbypassrls,
              EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member = r.oid) AS member_of_roles,
              has_schema_privilege(r.rolname, 'public', 'CREATE') AS creates_in_schema,
              has_database_privilege(r.rolname, current_database(), 'CREATE') AS creates_schemas,
              EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relowner = r.oid) AS owns_tables
         FROM pg_roles r WHERE r.rolname = $1`,
      [role],
    );
    const excess = Object.entries(check.rows[0] ?? {})
      .filter(([, value]) => value === true)
      .map(([key]) => key);
    if (excess.length > 0) {
      throw new Error(
        `app-role: the app role can do more than read and write rows (${excess.join(', ')})`,
      );
    }
    return { role, created };
  } finally {
    await client.end();
  }
}
