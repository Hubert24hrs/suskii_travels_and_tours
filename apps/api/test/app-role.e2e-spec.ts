import { randomBytes } from 'node:crypto';

import { Client, type DatabaseError } from 'pg';

import { appCredentials, ensureAppRole, scramVerifier } from '../src/infra/app-role';

/**
 * ADR-060, ASVS V13.2.2: the API's database role reads and writes rows and nothing else; the
 * release step creates it and rotates its password through the schema owner's connection.
 */
describe('app database role (e2e)', () => {
  const ownerUrl = (): string => {
    const url = process.env.E2E_DATABASE_URL;
    if (!url) throw new Error('E2E_DATABASE_URL missing (global setup)');
    return url;
  };
  const role = `suskii_app_e2e_${randomBytes(4).toString('hex')}`;
  const appUrl = (password: string): string => {
    const url = new URL(ownerUrl());
    url.username = role;
    url.password = password;
    return url.toString();
  };
  const firstPassword = randomBytes(24).toString('base64url');
  const secondPassword = randomBytes(24).toString('base64url');

  const asApp = async <T>(password: string, run: (client: Client) => Promise<T>): Promise<T> => {
    const client = new Client({ connectionString: appUrl(password) });
    await client.connect();
    try {
      return await run(client);
    } finally {
      await client.end();
    }
  };
  const denied = async (client: Client, sql: string): Promise<string | undefined> => {
    try {
      await client.query(sql);
      return undefined;
    } catch (error) {
      return (error as DatabaseError).code;
    }
  };
  const asOwner = async (sql: string): Promise<void> => {
    const client = new Client({ connectionString: ownerUrl() });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
  };

  afterAll(async () => {
    await asOwner(`DROP OWNED BY ${role}`);
    await asOwner(`DROP ROLE IF EXISTS ${role}`);
  });

  it('builds the SCRAM verifier PostgreSQL stores', () => {
    const verifier = scramVerifier('pencil', {
      salt: Buffer.from('W22ZaJ0SNY7soEsUEjb6gQ==', 'base64'),
    });
    // RFC 7677 section 3 test vector (user "user", password "pencil").
    expect(verifier).toBe(
      'SCRAM-SHA-256$4096:W22ZaJ0SNY7soEsUEjb6gQ==$WG5d8oPm3OtcPnkdi4Uo7BkeZkBFzpcXkuLmtbsT4qY=:wfPLwcE6nTWhTAmQ7tl2KeoiWGPlZqQxSrmfPwDl2dU=',
    );
  });

  it('rejects unsafe credentials without echoing them', () => {
    expect(() => appCredentials('postgresql://Bad-Name:x@localhost/db')).toThrow(
      'app-role: the app user must be a lower-case identifier',
    );
    expect(() => appCredentials('postgresql://suskii_app:short@localhost/db')).toThrow(
      /^app-role: the app password must have at least 24 characters$/,
    );
  });

  it('creates a role that reads and writes rows but cannot change the schema', async () => {
    expect(await ensureAppRole(ownerUrl(), appUrl(firstPassword))).toEqual({
      role,
      created: true,
    });
    await asApp(firstPassword, async (client) => {
      await client.query('SELECT count(*) FROM users');
      const email = `${role}@example.com`;
      await client.query(
        'INSERT INTO users (id, email, updated_at) VALUES (gen_random_uuid(), $1, now())',
        [email],
      );
      await client.query('UPDATE users SET display_name = $1 WHERE email = $2', ['Probe', email]);
      await client.query('DELETE FROM users WHERE email = $1', [email]);

      // 42501: insufficient privilege.
      expect(await denied(client, 'CREATE TABLE app_role_probe (id int)')).toBe('42501');
      expect(await denied(client, 'ALTER TABLE users ADD COLUMN probe int')).toBe('42501');
      expect(await denied(client, 'DROP TABLE users')).toBe('42501');
      expect(await denied(client, 'TRUNCATE users')).toBe('42501');
      expect(await denied(client, 'CREATE SCHEMA probe')).toBe('42501');
      expect(await denied(client, `CREATE ROLE ${role}_child`)).toBe('42501');
    });
  });

  it('rotates the password on the next release and keeps the grants', async () => {
    expect(await ensureAppRole(ownerUrl(), appUrl(secondPassword))).toEqual({
      role,
      created: false,
    });
    await expect(asApp(firstPassword, (client) => client.query('SELECT 1'))).rejects.toMatchObject({
      code: '28P01', // invalid_password
    });
    await asApp(secondPassword, (client) => client.query('SELECT count(*) FROM bookings'));
  });

  it('refuses a role that can do more, and the owner itself', async () => {
    await asOwner(`ALTER ROLE ${role} CREATEDB`);
    await expect(ensureAppRole(ownerUrl(), appUrl(secondPassword))).rejects.toThrow(
      'app-role: the app role can do more than read and write rows (rolcreatedb)',
    );
    await asOwner(`ALTER ROLE ${role} NOCREATEDB`);

    const owner = new URL(ownerUrl());
    owner.password = randomBytes(24).toString('base64url');
    await expect(ensureAppRole(ownerUrl(), owner.toString())).rejects.toThrow(
      'app-role: migrations and the app must connect as different roles',
    );
  });
});
