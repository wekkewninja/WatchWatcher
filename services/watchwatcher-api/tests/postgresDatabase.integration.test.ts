import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { PostgresDatabaseService } from '../src/services/postgresDatabase';
import type { AppConfig } from '../src/services/config';

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
        database.deleteAccount(accountA, { type: 'password', passwordHash: 'hash' }),
      ]);
      expect(competingDeletion[1].status).toBe('fulfilled');
      expect(await database.findAccountById(accountA)).toBeNull();
      expect(await database.getProgress(accountA)).toBeNull();
      await expect(database.saveProgress(accountA, snapshot, 0)).rejects.toMatchObject({ code: '23503' });
      expect((await database.getProgress(accountB))?.revision).toBe(1);

      const challengeId = randomUUID();
      await pool.query("INSERT INTO account_identities (id, account_id, provider, provider_subject, provider_email) VALUES ($1, $2, 'google', $3, $4)", [randomUUID(), accountB, 'subject-b', 'b@example.test']);
      await database.createGoogleChallenge({ id: challengeId, nonceHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000) });
      await expect(database.deleteAccount(accountB, { type: 'google', subject: 'subject-other', challengeId, nonceHash: 'a'.repeat(64) })).rejects.toMatchObject({ statusCode: 403, code: 'REAUTHENTICATION_FAILED' });
      expect(await database.isGoogleChallengeValid(challengeId, 'a'.repeat(64))).toBe(true);
      await database.deleteAccount(accountB, { type: 'google', subject: 'subject-b', challengeId, nonceHash: 'a'.repeat(64) });
      expect(await database.isGoogleChallengeValid(challengeId, 'a'.repeat(64))).toBe(false);
      expect(await database.getProgress(accountB)).toBeNull();
      expect((await pool.query('SELECT id FROM account_identities WHERE account_id = $1', [accountB])).rowCount).toBe(0);

      const accountC = randomUUID();
      await pool.query('INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)', [accountC, 'C', 'c@example.test', 'hash']);
      const initialSyncAndDelete = await Promise.allSettled([
        database.saveProgress(accountC, snapshot, 0),
        database.deleteAccount(accountC, { type: 'password', passwordHash: 'hash' }),
      ]);
      expect(initialSyncAndDelete[1].status).toBe('fulfilled');
      expect(await database.findAccountById(accountC)).toBeNull();
      expect(await database.getProgress(accountC)).toBeNull();
    } finally {
      await pool.end();
      if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });
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
    } finally {
      await firstPool.end();
      await secondPool.end();
      if (created) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  });
});