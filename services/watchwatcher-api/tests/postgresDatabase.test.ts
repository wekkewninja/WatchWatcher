import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../src/services/config';
import { PostgresDatabaseService } from '../src/services/postgresDatabase';
import { deletionReceiptHash } from '../src/services/deletionReceipt';

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
  it('passes only the hashed key and fixed quota to the atomic counter', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ allowed: false, retry_after: 37 }] });
    const database = databaseWithQuery(query);
    const key = 'a'.repeat(64);
    await expect(database.consumeIdentifierLimit(key, 5, 900)).resolves.toEqual({ allowed: false, retryAfter: 37 });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (key_hash) DO UPDATE'), [key, 5, 900]);
    expect(query.mock.calls[0][0]).toContain('LEAST(identifier_rate_limits.attempt_count + 1, $2 + 1)');
    expect(query.mock.calls[0][0]).toContain('clock_timestamp()');
  });
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

    expect(query.mock.calls[0]?.[0]).toContain('rule_exercise_attempts = $5::jsonb');
    expect(query.mock.calls[0]?.[1]).toEqual(['account-b', '{}', '[]', '["rule-5"]', JSON.stringify(attempts), 3]);
  });
});

describe('PostgresDatabaseService accounts and transactions', () => {
  it('revokes the matching session before its account-bound receipt in one transaction', async () => {
    const query = vi.fn().mockResolvedValue({});
    const release = vi.fn();
    const database = new PostgresDatabaseService(config);
    (database as unknown as { pool: unknown }).pool = { connect: vi.fn().mockResolvedValue({ query, release }) };
    await database.revokeSession('session-1', 'account-1');
    expect(query.mock.calls).toEqual([
      ['BEGIN ISOLATION LEVEL READ COMMITTED'],
      ['DELETE FROM sessions WHERE id = $1 AND account_id = $2', ['session-1', 'account-1']],
      ['DELETE FROM deletion_receipts WHERE session_hash = $1', [deletionReceiptHash('account-1', 'session-1')]],
      ['COMMIT'],
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back both revocations if receipt removal fails', async () => {
    const query = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce({});
    const release = vi.fn();
    const database = new PostgresDatabaseService(config);
    (database as unknown as { pool: unknown }).pool = { connect: vi.fn().mockResolvedValue({ query, release }) };
    await expect(database.revokeSession('session-1', 'account-1')).rejects.toThrow('unavailable');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
  it('locks the account and deletes it with a matching password hash', async () => {
    const query = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 1, rows: [{ password_hash: 'hash' }] }).mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const release = vi.fn();
    const database = new PostgresDatabaseService(config);
    (database as unknown as { pool: unknown }).pool = { connect: vi.fn().mockResolvedValue({ query, release }) };
    const expiresAt = new Date(Date.now() + 60000);
    await database.deleteAccount('account-1', { type: 'password', passwordHash: 'hash' }, 'session-1', expiresAt);
    expect(query.mock.calls.map((call) => call[0])).toEqual(['BEGIN', expect.stringContaining('FOR UPDATE'), expect.stringContaining('INSERT INTO deletion_receipts'), 'DELETE FROM users WHERE id = $1', 'COMMIT']);
    expect(query.mock.calls[2]?.[0]).toContain('LEAST(expires_at, $2)');
    expect(query.mock.calls[2]?.[1]).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/), expiresAt, 'session-1', 'account-1']);
    expect(query.mock.calls[3]?.[1]).toEqual(['account-1']);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rolls back when password, linked subject, or challenge no longer matches', async () => {
    const query = vi.fn();
    const release = vi.fn();
    const database = new PostgresDatabaseService(config);
    (database as unknown as { pool: unknown }).pool = { connect: vi.fn().mockResolvedValue({ query, release }) };
    query.mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 1, rows: [{ password_hash: 'changed' }] }).mockResolvedValueOnce({});
    await expect(database.deleteAccount('account-1', { type: 'password', passwordHash: 'old' }, 'session-1', new Date())).rejects.toMatchObject({ statusCode: 403, code: 'REAUTHENTICATION_FAILED' });
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    query.mockReset().mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 1, rows: [{ password_hash: null }] }).mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({});
    const google = { type: 'google' as const, subject: 'other', challengeId: 'challenge', nonceHash: 'hash' };
    await expect(database.deleteAccount('account-1', google, 'session-1', new Date())).rejects.toMatchObject({ statusCode: 403, code: 'REAUTHENTICATION_FAILED' });
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    query.mockReset().mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 1, rows: [{ password_hash: null }] }).mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 0 }).mockResolvedValueOnce({});
    await expect(database.deleteAccount('account-1', google, 'session-1', new Date())).rejects.toMatchObject({ statusCode: 403, code: 'REAUTHENTICATION_FAILED' });
    expect(query.mock.calls[3]?.[0]).toContain('DELETE FROM google_auth_challenges');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledTimes(3);
  });

  it('consumes a valid Google challenge in the deletion transaction and handles an absent account', async () => {
    const query = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 1, rows: [{ password_hash: null }] }).mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({ rowCount: 1 }).mockResolvedValueOnce({}).mockResolvedValueOnce({});
    const release = vi.fn();
    const database = new PostgresDatabaseService(config);
    (database as unknown as { pool: unknown }).pool = { connect: vi.fn().mockResolvedValue({ query, release }) };
    await database.deleteAccount('account-1', { type: 'google', subject: 'subject', challengeId: 'challenge', nonceHash: 'hash' }, 'session-1', new Date());
    expect(query.mock.calls[2]?.[1]).toEqual(['account-1', 'subject']);
    expect(query.mock.calls[3]?.[1]).toEqual(['challenge', 'hash']);
    expect(query.mock.calls[3]?.[0]).toContain('expires_at > clock_timestamp()');
    expect(query.mock.calls[4]?.[0]).toContain('INSERT INTO deletion_receipts');
    expect(query.mock.calls[5]?.[0]).toBe('DELETE FROM users WHERE id = $1');
    expect(query.mock.calls[6]?.[0]).toBe('COMMIT');
    query.mockReset().mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 0, rows: [] }).mockResolvedValueOnce({});
    await expect(database.deleteAccount('account-1', { type: 'password', passwordHash: 'hash' }, 'session-1', new Date())).rejects.toMatchObject({ statusCode: 401 });
    expect(query.mock.calls.map((call) => call[0])).toEqual(['BEGIN', expect.stringContaining('FOR UPDATE'), 'ROLLBACK']);
  });

  it('rolls back and propagates database errors during deletion', async () => {
    const query = vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValueOnce({});
    const release = vi.fn();
    const database = new PostgresDatabaseService(config);
    (database as unknown as { pool: unknown }).pool = { connect: vi.fn().mockResolvedValue({ query, release }) };
    await expect(database.deleteAccount('account-1', { type: 'password', passwordHash: 'hash' }, 'session-1', new Date())).rejects.toThrow('database unavailable');
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
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

  it('rolls back Google account creation when an email or identity uniqueness conflict occurs', async () => {
    const query = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ rowCount: 1 })
      .mockRejectedValueOnce({ code: '23505' }).mockResolvedValueOnce({});
    const release = vi.fn();
    const database = new PostgresDatabaseService(config);
    (database as unknown as { pool: unknown }).pool = { connect: vi.fn().mockResolvedValue({ query, release }) };

    await expect(database.createGoogleAccount({
      id: 'account-1', name: 'Sailor', email: 'sailor@example.com', subject: 'subject-1', challengeId: 'challenge-1', nonceHash: 'hash',
    })).rejects.toMatchObject({ statusCode: 409, message: 'This email or Google identity is already linked to an account.' });
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK');
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