import { randomBytes } from 'node:crypto';

import { Client, type DatabaseError } from 'pg';

import {
  appCredentials,
  ensureAgentRole,
  ensureAppRole,
  scramVerifier,
} from '../src/infra/app-role';

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
  describe('the agent service role (ADR-103)', () => {
    const agentRole = `suskii_agent_e2e_${randomBytes(4).toString('hex')}`;
    const agentPassword = randomBytes(24).toString('base64url');
    const urlFor = (name: string, password: string): string => {
      const url = new URL(ownerUrl());
      url.username = name;
      url.password = password;
      return url.toString();
    };
    const as = async <T>(url: string, run: (client: Client) => Promise<T>): Promise<T> => {
      const client = new Client({ connectionString: url });
      await client.connect();
      try {
        return await run(client);
      } finally {
        await client.end();
      }
    };
    const THREAD = `role-probe-${randomBytes(4).toString('hex')}`;

    afterAll(async () => {
      await asOwner(`DELETE FROM "agent"."checkpoints" WHERE thread_id = '${THREAD}'`);
      await asOwner(`DROP OWNED BY ${agentRole}`);
      await asOwner(`DROP ROLE IF EXISTS ${agentRole}`);
    });

    it('keeps checkpoints and reaches nothing of the application', async () => {
      expect(
        await ensureAgentRole(ownerUrl(), urlFor(agentRole, agentPassword), appUrl(secondPassword)),
      ).toEqual({ role: agentRole, created: true });

      await as(urlFor(agentRole, agentPassword), async (client) => {
        await client.query(
          `INSERT INTO "agent"."checkpoints" (thread_id, checkpoint_id, checkpoint) VALUES ($1, 'c1', '{"said":"hello"}')`,
          [THREAD],
        );
        const read = await client.query(
          'SELECT checkpoint FROM "agent"."checkpoints" WHERE thread_id = $1',
          [THREAD],
        );
        expect(read.rows).toHaveLength(1);
        await client.query(`UPDATE "agent"."checkpoints" SET type = 'x' WHERE thread_id = $1`, [
          THREAD,
        ]);

        // 42501: insufficient privilege. Not one application table, by any verb.
        for (const sql of [
          'SELECT count(*) FROM users',
          'SELECT count(*) FROM bookings',
          'SELECT count(*) FROM agent_messages',
          'SELECT count(*) FROM payments',
          "INSERT INTO agent_settings (key, value, updated_at) VALUES ('x', '1', now())",
          'DELETE FROM agent_conversations',
          'CREATE TABLE "agent"."probe" (id int)',
          'ALTER TABLE "agent"."checkpoints" ADD COLUMN probe int',
          'DROP TABLE "agent"."checkpoints"',
          'CREATE SCHEMA probe',
          `CREATE ROLE ${agentRole}_child`,
        ]) {
          expect([sql, await denied(client, sql)]).toEqual([sql, '42501']);
        }
      });
    });

    it("lets the API's role delete a thread and read nothing a checkpoint holds", async () => {
      await asApp(secondPassword, async (client) => {
        for (const sql of [
          'SELECT checkpoint FROM "agent"."checkpoints"',
          'SELECT * FROM "agent"."checkpoints"',
          'SELECT blob FROM "agent"."checkpoint_blobs"',
          `INSERT INTO "agent"."checkpoints" (thread_id, checkpoint_id, checkpoint) VALUES ('x', 'c', '{}')`,
          `UPDATE "agent"."checkpoints" SET type = 'y'`,
          'TRUNCATE "agent"."checkpoints"',
        ]) {
          expect([sql, await denied(client, sql)]).toEqual([sql, '42501']);
        }
        const deleted = await client.query(
          'DELETE FROM "agent"."checkpoints" WHERE thread_id = $1',
          [THREAD],
        );
        expect(deleted.rowCount).toBe(1);
      });
    });

    it('refuses an agent role that can do more, or that is the app or the owner', async () => {
      await asOwner(`GRANT SELECT ON users TO ${agentRole}`);
      await expect(
        ensureAgentRole(ownerUrl(), urlFor(agentRole, agentPassword), appUrl(secondPassword)),
      ).rejects.toThrow(
        'app-role: the agent role can do more than keep checkpoints (reaches_application_tables)',
      );
      await asOwner(`REVOKE SELECT ON users FROM ${agentRole}`);
      expect(
        await ensureAgentRole(ownerUrl(), urlFor(agentRole, agentPassword), appUrl(secondPassword)),
      ).toEqual({ role: agentRole, created: false });

      await expect(
        ensureAgentRole(ownerUrl(), appUrl(secondPassword), appUrl(secondPassword)),
      ).rejects.toThrow('app-role: the agent service and the app must connect as different roles');
      const owner = new URL(ownerUrl());
      owner.password = randomBytes(24).toString('base64url');
      await expect(ensureAgentRole(ownerUrl(), owner.toString())).rejects.toThrow(
        'app-role: migrations and the agent service must connect as different roles',
      );

      // An app role that was given sight of checkpoints is refused too.
      await asOwner(`GRANT SELECT ON "agent"."checkpoints" TO ${role}`);
      await expect(
        ensureAgentRole(ownerUrl(), urlFor(agentRole, agentPassword), appUrl(secondPassword)),
      ).rejects.toThrow(
        'app-role: the app role can do more than delete threads (SELECT on checkpoints)',
      );
      await asOwner(`REVOKE SELECT ON "agent"."checkpoints" FROM ${role}`);
    });
  });
});
