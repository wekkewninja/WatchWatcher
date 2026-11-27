import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresDatabaseService } from '../src/services/postgresDatabase';
import { AuthService } from '../src/services/authService';
import type { AppConfig } from '../src/services/config';
import { deletionReceiptHash } from '../src/services/deletionReceipt';

const databaseUrl = process.env.MIGRATION_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('PostgreSQL progress isolation and revisions', () => {
  it('updates existing snapshots, rejects stale writes and isolates accounts', async () => {
    const schema = `progress_test_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: databaseUrl });
    const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    let created = false;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      const require = createRequire(import.meta.url);
      const migration = spawnSync(process.execPath, [require.resolve('node-pg-migrate/bin/node-pg-migrate'), 'up',
        '--migrations-dir', fileURLToPath(new URL('../migrations', import.meta.url)),
        '--schema', schema, '--migrations-schema', schema], {
        env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8',
      });
      expect(migration.status, migration.stderr).toBe(0);

      const accountA = randomUUID();
      const accountB = randomUUID();
      await pool.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4), ($5, $6, $7, $8)',
        [accountA, 'A', 'a@example.test', 'hash', accountB, 'B', 'b@example.test', 'hash']);
      const config: AppConfig = {
        environment: 'Test', databaseUrl, jwtSecret: undefined, jwtIssuer: 'test', jwtAudience: 'test',
        googleClientId: undefined, geminiApiKey: undefined, azureStorageAccount: undefined, azuriteConnectionString: undefined,
      };
      const database = new PostgresDatabaseService(config);
      (database as unknown as { pool: Pool }).pool = pool;
      const auth = new AuthService(database, {
        ...config, jwtSecret: 'synthetic-signing-secret-for-integration-tests',
        rateLimitSecret: 'synthetic-rate-limit-secret-for-integration-tests',
      });
      const firstSession = await auth.register({ name: 'Session', email: 'session@example.test', password: 'synthetic-password' });
      const secondSession = await auth.login({ email: 'session@example.test', password: 'synthetic-password' });
      await auth.logout(`Bearer ${firstSession.session}`);
      await auth.logout(`Bearer ${firstSession.session}`);
      await expect(auth.authenticate(`Bearer ${firstSession.session}`)).rejects.toMatchObject({ statusCode: 401 });
      await expect(auth.authenticate(`Bearer ${secondSession.session}`)).resolves.toMatchObject({ id: secondSession.accountId });
      await auth.deleteAccount(`Bearer ${secondSession.session}`, { confirmation: 'DELETE', reauthentication: { type: 'password', password: 'synthetic-password' } });
      await expect(auth.deleteAccount(`Bearer ${secondSession.session}`, { confirmation: 'DELETE', reauthentication: { type: 'password', password: 'synthetic-password' } })).resolves.toBeUndefined();
      await expect(auth.authenticate(`Bearer ${secondSession.session}`)).rejects.toMatchObject({ statusCode: 401 });
      expect((await pool.query('SELECT id FROM sessions WHERE account_id = $1', [secondSession.accountId])).rowCount).toBe(0);
      const simultaneous = await auth.register({ name: 'Concurrent', email: 'concurrent@example.test', password: 'synthetic-password' });
      const deletionRequest = { confirmation: 'DELETE' as const, reauthentication: { type: 'password' as const, password: 'synthetic-password' } };
      await expect(Promise.all([
        auth.deleteAccount(`Bearer ${simultaneous.session}`, deletionRequest),
        auth.deleteAccount(`Bearer ${simultaneous.session}`, deletionRequest),
      ])).resolves.toEqual([undefined, undefined]);
      const sessionA = randomUUID();
      const sessionB = randomUUID();
      await database.createSession(sessionA, accountA, new Date(Date.now() + 60_000));
      await database.createSession(sessionB, accountB, new Date(Date.now() + 60_000));
      const expired = randomUUID();
      await database.createSession(expired, accountA, new Date(Date.now() - 1000));
      expect(await database.findSessionAccount(expired, accountA)).toBeNull();
      expect(await database.findSessionAccount(sessionA, accountB)).toBeNull();
      await database.revokeSession(sessionA, accountB);
      expect(await database.findSessionAccount(sessionA, accountA)).toMatchObject({ id: accountA });
      const revoked = randomUUID();
      await database.createSession(revoked, accountA, new Date(Date.now() + 60_000));
      await database.revokeSession(revoked, accountA);
      await database.revokeSession(revoked, accountA);
      expect(await database.findSessionAccount(revoked, accountA)).toBeNull();
      await expect(database.deleteAccount(accountA, { type: 'password', passwordHash: 'hash' }, revoked, new Date(Date.now() + 60000))).rejects.toMatchObject({ statusCode: 401 });
      const snapshot = { topicMastery: { 'rule-5': 70 }, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };

      expect((await database.saveProgress(accountA, snapshot, 0)).revision).toBe(1);
      expect((await database.saveProgress(accountA, { ...snapshot, topicMastery: { 'rule-5': 90 } }, 1)).revision).toBe(2);
      await expect(database.saveProgress(accountA, snapshot, 1)).rejects.toMatchObject({ statusCode: 409 });
      await expect(database.getProgress(accountB)).resolves.toBeNull();
      await expect(database.saveProgress(accountB, snapshot, 1)).rejects.toMatchObject({ statusCode: 409 });
      expect((await database.saveProgress(accountB, snapshot, 0)).revision).toBe(1);
      expect((await database.getProgress(accountA))?.topicMastery).toEqual({ 'rule-5': 90 });

      const competing = await Promise.allSettled([
        database.saveProgress(accountA, snapshot, 2),
        database.saveProgress(accountA, snapshot, 2),
      ]);
      expect(competing.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(competing.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect((await database.getProgress(accountA))?.revision).toBe(3);
      expect((await database.getProgress(accountB))?.revision).toBe(1);

      const competingDeletion = await Promise.allSettled([
        database.saveProgress(accountA, snapshot, 3),
        database.deleteAccount(accountA, { type: 'password', passwordHash: 'hash' }, sessionA, new Date(Date.now() + 60000)),
      ]);
      expect(competingDeletion[1].status).toBe('fulfilled');
      expect(await database.findAccountById(accountA)).toBeNull();
      expect((await pool.query('SELECT id FROM sessions WHERE account_id = $1', [accountA])).rowCount).toBe(0);
      await expect(database.createSession(randomUUID(), accountA, new Date(Date.now() + 60_000))).rejects.toMatchObject({ code: '23503' });
      expect(await database.getProgress(accountA)).toBeNull();
      await expect(database.saveProgress(accountA, snapshot, 0)).rejects.toMatchObject({ code: '23503' });
      expect((await database.getProgress(accountB))?.revision).toBe(1);

      const challengeId = randomUUID();
      await pool.query("INSERT INTO account_identities (id, account_id, provider, provider_subject, provider_email) VALUES ($1, $2, 'google', $3, $4)", [randomUUID(), accountB, 'subject-b', 'b@example.test']);
      await database.createGoogleChallenge({ id: challengeId, nonceHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000) });
      await expect(database.deleteAccount(accountB, { type: 'google', subject: 'subject-other', challengeId, nonceHash: 'a'.repeat(64) }, sessionB, new Date(Date.now() + 60000))).rejects.toMatchObject({ statusCode: 403, code: 'REAUTHENTICATION_FAILED' });
      expect(await database.isGoogleChallengeValid(challengeId, 'a'.repeat(64))).toBe(true);
      const tokenExpiry = new Date(Date.now() + 10000);
      await database.deleteAccount(accountB, { type: 'google', subject: 'subject-b', challengeId, nonceHash: 'a'.repeat(64) }, sessionB, tokenExpiry);
      const receipt = await pool.query('SELECT session_hash, expires_at FROM deletion_receipts WHERE session_hash = $1', [deletionReceiptHash(accountB, sessionB)]);
      expect(receipt.rows[0].expires_at.getTime()).toBeLessThanOrEqual(tokenExpiry.getTime());
      expect(await database.isGoogleChallengeValid(challengeId, 'a'.repeat(64))).toBe(false);
      expect(await database.getProgress(accountB)).toBeNull();
      expect((await pool.query('SELECT id FROM account_identities WHERE account_id = $1', [accountB])).rowCount).toBe(0);

      const accountC = randomUUID();
      await pool.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)', [accountC, 'C', 'c@example.test', 'hash']);
      const sessionC = randomUUID();
      await database.createSession(sessionC, accountC, new Date(Date.now() + 60_000));
      const initialSyncAndDelete = await Promise.allSettled([
        database.saveProgress(accountC, snapshot, 0),
        database.deleteAccount(accountC, { type: 'password', passwordHash: 'hash' }, sessionC, new Date(Date.now() + 60000)),
      ]);
      expect(initialSyncAndDelete[1].status).toBe('fulfilled');
      expect(await database.findAccountById(accountC)).toBeNull();
      expect(await database.getProgress(accountC)).toBeNull();

      const cleanup = readFileSync(fileURLToPath(new URL('../maintenance/cleanup-expired-sessions.sql', import.meta.url)), 'utf8');
      const cleanupOwner = randomUUID();
      await pool.query('INSERT INTO users (id, name, email) VALUES ($1, $2, $3)', [cleanupOwner, 'Cleanup', 'cleanup@example.test']);
      await pool.query("INSERT INTO sessions (id, account_id, expires_at) SELECT gen_random_uuid(), $1, clock_timestamp() - interval '1 minute' FROM generate_series(1, 1001)", [cleanupOwner]);
      await pool.query("INSERT INTO sessions (id, account_id, expires_at) VALUES ($1, $2, clock_timestamp() + interval '1 hour')", [randomUUID(), cleanupOwner]);
      await pool.query("INSERT INTO deletion_receipts (session_hash, expires_at) SELECT md5(number::text) || md5(number::text), clock_timestamp() - interval '1 minute' FROM generate_series(1, 1001) AS number");
      const firstCleanup = await pool.query(cleanup);
      expect(firstCleanup.map((result) => result.rowCount)).toEqual([1000, 1000]);
      const secondCleanup = await pool.query(cleanup);
      expect(secondCleanup.map((result) => result.rowCount)).toEqual([1, 1]);
      expect((await pool.query('SELECT count(*)::int AS count FROM sessions WHERE account_id = $1', [cleanupOwner])).rows[0].count).toBe(1);
      expect((await pool.query('SELECT count(*)::int AS count FROM deletion_receipts WHERE expires_at > clock_timestamp()')).rows[0].count).toBeGreaterThan(0);
    } finally {
      await pool.end();
      if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });

  it('serializes logout behind an in-flight deletion and revokes only its receipt', async () => {
    const schema = `logout_race_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: databaseUrl });
    const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    let created = false;
    let gate: Awaited<ReturnType<Pool['connect']>> | undefined;
    let deletion: Promise<void> | undefined;
    let logout: Promise<void> | undefined;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      const require = createRequire(import.meta.url);
      const migration = spawnSync(process.execPath, [require.resolve('node-pg-migrate/bin/node-pg-migrate'), 'up',
        '--migrations-dir', fileURLToPath(new URL('../migrations', import.meta.url)),
        '--schema', schema, '--migrations-schema', schema], {
        env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8',
      });
      expect(migration.status, migration.stderr).toBe(0);
      const config: AppConfig = {
        environment: 'Test', databaseUrl, jwtSecret: 'synthetic-signing-secret-for-integration-tests',
        rateLimitSecret: 'synthetic-rate-limit-secret-for-integration-tests', jwtIssuer: 'test', jwtAudience: 'test',
        googleClientId: undefined, geminiApiKey: undefined, azureStorageAccount: undefined, azuriteConnectionString: undefined,
      };
      const database = new PostgresDatabaseService(config);
      (database as unknown as { pool: Pool }).pool = pool;
      const auth = new AuthService(database, config);
      const first = await auth.register({ name: 'Race', email: 'race@example.test', password: 'synthetic-password' });
      const other = await auth.register({ name: 'Other', email: 'other@example.test', password: 'synthetic-password' });
      const alreadyDeleted = await auth.register({ name: 'Receipt', email: 'receipt@example.test', password: 'synthetic-password' });
      const request = { confirmation: 'DELETE' as const, reauthentication: { type: 'password' as const, password: 'synthetic-password' } };
      const receipt = { confirmation: 'DELETE' as const, receiptOnly: true as const };
      await auth.deleteAccount(`Bearer ${alreadyDeleted.session}`, request);
      await pool.query(`CREATE FUNCTION hold_delete_for_test() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN PERFORM pg_advisory_xact_lock(719043221); RETURN OLD; END $$`);
      await pool.query('CREATE TRIGGER hold_delete_for_test BEFORE DELETE ON users FOR EACH ROW EXECUTE FUNCTION hold_delete_for_test()');
      gate = await pool.connect();
      await gate.query('SELECT pg_advisory_lock(719043221)');
      deletion = auth.deleteAccount(`Bearer ${first.session}`, request);
      void deletion.catch(() => undefined);
      const waitForBlocked = async (prefix: string) => vi.waitFor(async () => {
        const result = await pool.query<{ blocked: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND query LIKE $1 AND cardinality(pg_blocking_pids(pid)) > 0) AS blocked',
          [`${prefix}%`],
        );
        expect(result.rows[0].blocked).toBe(true);
      }, { timeout: 5000, interval: 20 });
      await waitForBlocked('DELETE FROM users WHERE id = $1');
      logout = auth.logout(`Bearer ${first.session}`);
      void logout.catch(() => undefined);
      await waitForBlocked('DELETE FROM sessions WHERE id = $1 AND account_id = $2');
      await gate.query('SELECT pg_advisory_unlock(719043221)');
      await expect(Promise.all([deletion, logout])).resolves.toEqual([undefined, undefined]);
      await expect(auth.logout(`Bearer ${first.session}`)).resolves.toBeUndefined();
      await expect(auth.authenticate(`Bearer ${first.session}`)).rejects.toMatchObject({ statusCode: 401 });
      await expect(auth.deleteAccount(`Bearer ${first.session}`, receipt)).rejects.toMatchObject({ statusCode: 401 });
      expect(await database.findAccountById(first.accountId)).toBeNull();
      await expect(auth.deleteAccount(`Bearer ${alreadyDeleted.session}`, receipt)).resolves.toBeUndefined();
      await expect(auth.authenticate(`Bearer ${other.session}`)).resolves.toMatchObject({ id: other.accountId });
      await auth.logout(`Bearer ${alreadyDeleted.session}`);
      await expect(auth.deleteAccount(`Bearer ${alreadyDeleted.session}`, receipt)).rejects.toMatchObject({ statusCode: 401 });
      await auth.logout(`Bearer ${other.session}`);
      await expect(auth.deleteAccount(`Bearer ${other.session}`, request)).rejects.toMatchObject({ statusCode: 401 });
      expect(await database.findAccountById(other.accountId)).not.toBeNull();
    } finally {
      if (gate) {
        await gate.query('SELECT pg_advisory_unlock(719043221)');
        gate.release();
      }
      await Promise.allSettled([deletion, logout].filter((operation): operation is Promise<void> => Boolean(operation)));
      await pool.end();
      if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  }, 30000);
});

describe.skipIf(!databaseUrl)('PostgreSQL distributed identifier limits', () => {
  it('shares atomic capped windows between independent instances and resets after expiry', async () => {
    const schema = `limits_test_${randomUUID().replaceAll('-', '')}`;
    const admin = new Pool({ connectionString: databaseUrl });
    const firstPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    const secondPool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` });
    let created = false;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      created = true;
      const require = createRequire(import.meta.url);
      const migration = spawnSync(process.execPath, [require.resolve('node-pg-migrate/bin/node-pg-migrate'), 'up',
        '--migrations-dir', fileURLToPath(new URL('../migrations', import.meta.url)),
        '--schema', schema, '--migrations-schema', schema], {
        env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8',
      });
      expect(migration.status, migration.stderr).toBe(0);
      const config: AppConfig = {
        environment: 'Test', databaseUrl, jwtSecret: undefined, jwtIssuer: 'test', jwtAudience: 'test',
        googleClientId: undefined, geminiApiKey: undefined, azureStorageAccount: undefined, azuriteConnectionString: undefined,
      };
      const first = new PostgresDatabaseService(config);
      const second = new PostgresDatabaseService(config);
      (first as unknown as { pool: Pool }).pool = firstPool;
      (second as unknown as { pool: Pool }).pool = secondPool;
      const key = 'a'.repeat(64);
      const results = await Promise.all(Array.from({ length: 20 }, (_, index) =>
        (index % 2 ? first : second).consumeIdentifierLimit(key, 5, 900)));
      expect(results.filter((result) => result.allowed)).toHaveLength(5);
      expect(results.filter((result) => !result.allowed)).toHaveLength(15);
      expect(results.every((result) => result.retryAfter >= 1 && result.retryAfter <= 900)).toBe(true);
      const stored = await firstPool.query('SELECT key_hash, attempt_count, expires_at FROM identifier_rate_limits');
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]).toMatchObject({ key_hash: key, attempt_count: 6 });
      await firstPool.query("UPDATE identifier_rate_limits SET expires_at = clock_timestamp() - interval '1 second' WHERE key_hash = $1", [key]);
      const afterExpiry = await Promise.all(Array.from({ length: 8 }, (_, index) =>
        (index % 2 ? first : second).consumeIdentifierLimit(key, 5, 900)));
      expect(afterExpiry.filter((result) => result.allowed)).toHaveLength(5);
      expect(afterExpiry.filter((result) => !result.allowed)).toHaveLength(3);
      expect((await first.consumeIdentifierLimit('b'.repeat(64), 5, 3600)).allowed).toBe(true);
      const authConfig = { ...config, jwtSecret: 'synthetic-signing-secret-for-integration-tests', rateLimitSecret: 'synthetic-rate-limit-secret-for-integration-tests' };
      const authInstances = [new AuthService(first, authConfig), new AuthService(second, authConfig)];
      const evaluationResults = await Promise.allSettled(Array.from({ length: 40 }, (_, index) => authInstances[index % 2].consumeEvaluationLimit('synthetic-account-a')));
      expect(evaluationResults.filter((result) => result.status === 'fulfilled')).toHaveLength(30);
      expect(evaluationResults.filter((result) => result.status === 'rejected')).toHaveLength(10);
      await expect(authInstances[0].consumeEvaluationLimit('synthetic-account-b')).resolves.toBeUndefined();
      const evaluationRows = await firstPool.query('SELECT key_hash FROM identifier_rate_limits');
      expect(JSON.stringify(evaluationRows.rows)).not.toContain('synthetic-account');
    } finally {
      await firstPool.end();
      await secondPool.end();
      if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });
});