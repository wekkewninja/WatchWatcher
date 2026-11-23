import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/services/config';
import { PostgresDatabaseService } from '../src/services/postgresDatabase';

const config: AppConfig = {
  environment: 'Test',
  databaseUrl: 'postgresql://test:test@localhost:5432/test',
  jwtSecret: undefined,
  jwtIssuer: 'watchwatcher-api',
  jwtAudience: 'watchwatcher-app',
  googleClientId: undefined,
  geminiApiKey: undefined,
  azureStorageAccount: undefined,
  azuriteConnectionString: undefined,
};

function databaseWithQuery(query: ReturnType<typeof vi.fn>) {
  const database = new PostgresDatabaseService(config);
  (database as unknown as { pool: { query: typeof query } }).pool = { query };
  return database;
}

describe('PostgresDatabaseService exercise progress', () => {
  it('reads exercise attempts only from the requested account snapshot', async () => {
    const attempts = [{
      id: '32f63760-6b39-4f06-935e-430251d1b785',
      ruleId: 'rule-19',
      selectedOptionId: 'b',
      correct: true,
      attemptedAt: '2026-11-22T12:00:00.000Z',
    }];
    const query = vi.fn().mockResolvedValue({ rows: [{
      topic_mastery: {},
      weak_spot_log: [],
      drill_queue: [],
      rule_exercise_attempts: attempts,
      revision: 3,
      synced_at: new Date('2026-11-22T12:01:00.000Z'),
    }] });
    const database = databaseWithQuery(query);

    const progress = await database.getProgress('account-a');

    expect(query.mock.calls[0]?.[0]).toContain('WHERE account_id = $1');
    expect(query.mock.calls[0]?.[1]).toEqual(['account-a']);
    expect(progress?.ruleExerciseAttempts).toEqual(attempts);
    expect(progress?.accountId).toBe('account-a');
  });

  it('writes attempt events under the authenticated account and revision', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ revision: 4, synced_at: new Date('2026-11-22T12:02:00.000Z') }] });
    const database = databaseWithQuery(query);
    const attempts = [{
      id: '32f63760-6b39-4f06-935e-430251d1b785',
      ruleId: 'rule-5',
      selectedOptionId: 'a',
      correct: false,
      attemptedAt: '2026-11-22T12:00:00.000Z',
    }];

    await database.saveProgress('account-b', {
      topicMastery: {},
      weakSpotLog: [],
      drillQueue: ['rule-5'],
      ruleExerciseAttempts: attempts,
    }, 3);

    expect(query.mock.calls[0]?.[0]).toContain('rule_exercise_attempts = EXCLUDED.rule_exercise_attempts');
    expect(query.mock.calls[0]?.[1]).toEqual(['account-b', '{}', '[]', '["rule-5"]', JSON.stringify(attempts), 3]);
  });
});

describe('PostgresDatabaseService accounts and transactions', () => {
  it('creates and looks up normalized password accounts', async () => {
    const account = { id: 'account-1', name: 'Sailor', email: 'sailor@example.com' };
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [account] })
      .mockResolvedValueOnce({ rows: [{ ...account, password_hash: 'hash' }] })
      .mockResolvedValueOnce({ rows: [] });
    const database = databaseWithQuery(query);
    expect(await database.createAccount({ id: account.id, name: account.name, email: 'SAILOR@EXAMPLE.COM', passwordHash: 'hash' })).toEqual(account);
    expect(query.mock.calls[0]?.[1]).toEqual([account.id, account.name, account.email, 'hash']);
    expect(await database.findAccountByEmail('SAILOR@EXAMPLE.COM')).toEqual({ ...account, passwordHash: 'hash' });
    expect(await database.findAccountByEmail('missing@example.com')).toBeNull();
  });

  it('maps unique account conflicts without masking unrelated errors', async () => {
    const query = vi.fn().mockRejectedValueOnce({ code: '23505' }).mockRejectedValueOnce(new Error('database unavailable'));
    const database = databaseWithQuery(query);
    const input = { id: 'account-1', name: 'Sailor', email: 'sailor@example.com', passwordHash: 'hash' };
    await expect(database.createAccount(input)).rejects.toMatchObject({ statusCode: 409 });
    await expect(database.createAccount(input)).rejects.toThrow('database unavailable');
  });

  it('creates, validates, and consumes one-use Google challenges', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'challenge' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'challenge' }] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    const database = databaseWithQuery(query);
    const expiresAt = new Date('2026-01-01T00:00:00.000Z');
    await database.createGoogleChallenge({ id: 'challenge', nonceHash: 'nonce-hash', expiresAt });
    expect(query.mock.calls[0]?.[0]).toContain('DELETE FROM google_auth_challenges');
    expect(query.mock.calls[1]?.[1]).toEqual(['challenge', 'nonce-hash', expiresAt]);
    expect(await database.isGoogleChallengeValid('challenge', 'nonce-hash')).toBe(true);
    expect(await database.consumeGoogleChallenge('challenge', 'nonce-hash')).toBe(true);
    expect(await database.consumeGoogleChallenge('challenge', 'nonce-hash')).toBe(false);
  });

  it('looks up Google identities by subject', async () => {
    const account = { id: 'account-1', name: 'Sailor', email: 'sailor@example.com' };
    const query = vi.fn().mockResolvedValueOnce({ rows: [account] }).mockResolvedValueOnce({ rows: [] });
    const database = databaseWithQuery(query);
    expect(await database.findAccountByGoogleSubject('subject-1')).toEqual(account);
    expect(query.mock.calls[0]?.[1]).toEqual(['subject-1']);
    expect(await database.findAccountByGoogleSubject('missing')).toBeNull();
  });

  it('creates a Google account in a transaction and consumes its challenge', async () => {
    const account = { id: 'account-1', name: 'Sailor', email: 'sailor@example.com' };
    const query = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rows: [account] }).mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const release = vi.fn();
    const database = new PostgresDatabaseService(config);
    (database as unknown as { pool: unknown }).pool = { connect: vi.fn().mockResolvedValue({ query, release }) };
    const input = { ...account, email: 'SAILOR@EXAMPLE.COM', subject: 'subject-1', challengeId: 'challenge-1', nonceHash: 'hash' };
    expect(await database.createGoogleAccount(input)).toEqual(account);
    expect(query.mock.calls.map((call) => call[0])).toEqual(['BEGIN', expect.stringContaining('DELETE FROM google_auth_challenges'), expect.stringContaining('INSERT INTO users'), expect.stringContaining('INSERT INTO account_identities'), 'COMMIT']);
    expect(query.mock.calls[2]?.[1]).toEqual([account.id, account.name, account.email]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back account creation when a Google challenge was already used', async () => {
    const query = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({});
    const release = vi.fn();
    const database = new PostgresDatabaseService(config);
    (database as unknown as { pool: unknown }).pool = { connect: vi.fn().mockResolvedValue({ query, release }) };
    await expect(database.createGoogleAccount({ id: 'account-1', name: 'Sailor', email: 'sailor@example.com', subject: 'subject-1', challengeId: 'challenge-1', nonceHash: 'hash' })).rejects.toMatchObject({ statusCode: 401 });
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });

  it('links a Google identity transactionally and rejects duplicate links', async () => {
    const query = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const release = vi.fn();
    const database = new PostgresDatabaseService(config);
    (database as unknown as { pool: unknown }).pool = { connect: vi.fn().mockResolvedValue({ query, release }) };
    const input = { accountId: 'account-1', email: 'SAILOR@EXAMPLE.COM', subject: 'subject-1', challengeId: 'challenge-1', nonceHash: 'hash' };
    await database.linkGoogleIdentity(input);
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT');
    expect(query.mock.calls[2]?.[1]).toEqual([expect.any(String), input.accountId, input.subject, 'sailor@example.com']);
    expect(release).toHaveBeenCalledOnce();

    query.mockReset().mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 1 }).mockRejectedValueOnce({ code: '23505' }).mockResolvedValueOnce({});
    await expect(database.linkGoogleIdentity(input)).rejects.toMatchObject({ statusCode: 409 });
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('handles missing snapshots, revision conflicts, and database health failures', async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ value: 1 }] }).mockRejectedValueOnce(new Error('offline'));
    const database = databaseWithQuery(query);
    expect(await database.getProgress('account-1')).toBeNull();
    await expect(database.saveProgress('account-1', { topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] }, 3)).rejects.toMatchObject({ statusCode: 409 });
    expect(await database.healthCheck()).toBe(true);
    expect(await database.healthCheck()).toBe(false);
    expect(await new PostgresDatabaseService({ ...config, databaseUrl: undefined }).healthCheck()).toBe(false);
  });
});