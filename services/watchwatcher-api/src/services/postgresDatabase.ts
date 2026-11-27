import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { PublicAccount, ProgressSnapshot, StoredProgress } from '../../../shared/types/entities';
import type { AppConfig } from './config';
import { ConflictError, ReauthenticationError, ServiceUnavailableError, UnauthorizedError } from '../errors/errorTypes';
import type { IDatabaseService } from './interfaces/IDatabaseService';
import { deletionReceiptHash } from './deletionReceipt';

export class PostgresDatabaseService implements IDatabaseService {
  private pool: Pool | null = null;

  constructor(private readonly config: AppConfig) {}

  async createSession(id: string, accountId: string, expiresAt: Date): Promise<void> {
    await this.getPool().query('INSERT INTO sessions (id, account_id, expires_at) VALUES ($1, $2, $3)', [id, accountId, expiresAt]);
  }

  async findSessionAccount(id: string, accountId: string): Promise<{ id: string; name: string; email: string; passwordHash: string | null } | null> {
    const result = await this.getPool().query<{ id: string; name: string; email: string; password_hash: string | null }>(
      'SELECT users.id, users.name, users.email, users.password_hash FROM sessions JOIN users ON users.id = sessions.account_id WHERE sessions.id = $1 AND sessions.account_id = $2 AND sessions.expires_at > clock_timestamp()',
      [id, accountId],
    );
    const account = result.rows[0];
    return account ? { id: account.id, name: account.name, email: account.email, passwordHash: account.password_hash } : null;
  }

  async revokeSession(id: string, accountId: string): Promise<void> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      await client.query('DELETE FROM sessions WHERE id = $1 AND account_id = $2', [id, accountId]);
      await client.query('DELETE FROM deletion_receipts WHERE session_hash = $1', [deletionReceiptHash(accountId, id)]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async hasDeletionReceipt(sessionHash: string): Promise<boolean> {
    const result = await this.getPool().query('SELECT 1 FROM deletion_receipts WHERE session_hash = $1 AND expires_at > clock_timestamp()', [sessionHash]);
    return result.rowCount === 1;
  }

  async consumeIdentifierLimit(keyHash: string, limit: number, windowSeconds: number): Promise<{ allowed: boolean; retryAfter: number }> {
    const result = await this.getPool().query<{ allowed: boolean; retry_after: number }>(
      `INSERT INTO identifier_rate_limits (key_hash, attempt_count, expires_at)
       VALUES ($1, 1, clock_timestamp() + $3 * interval '1 second')
       ON CONFLICT (key_hash) DO UPDATE SET (attempt_count, expires_at) = (
         SELECT CASE WHEN identifier_rate_limits.expires_at <= sampled_at THEN 1
                  ELSE LEAST(identifier_rate_limits.attempt_count + 1, $2 + 1) END,
                CASE WHEN identifier_rate_limits.expires_at <= sampled_at
                  THEN sampled_at + $3 * interval '1 second' ELSE identifier_rate_limits.expires_at END
         FROM (SELECT clock_timestamp() AS sampled_at OFFSET 0) AS timestamp_sample
       )
       RETURNING attempt_count <= $2 AS allowed,
         GREATEST(1, CEIL(EXTRACT(EPOCH FROM (expires_at - clock_timestamp()))))::integer AS retry_after`,
      [keyHash, limit, windowSeconds],
    );
    return { allowed: result.rows[0].allowed, retryAfter: result.rows[0].retry_after };
  }

  async createAccount(input: { id: string; name: string; email: string; passwordHash: string }): Promise<PublicAccount> {
    try {
      const result = await this.getPool().query<{ id: string; name: string; email: string }>(
        'INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, email',
        [input.id, input.name, input.email.toLowerCase(), input.passwordHash],
      );
      return result.rows[0];
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictError('An account already exists for this email.');
      throw error;
    }
  }

  async findAccountById(id: string): Promise<{ id: string; name: string; email: string; passwordHash: string | null } | null> {
    const result = await this.getPool().query<{ id: string; name: string; email: string; password_hash: string | null }>(
      'SELECT id, name, email, password_hash FROM users WHERE id = $1 LIMIT 1',
      [id],
    );
    const account = result.rows[0];
    return account ? { id: account.id, name: account.name, email: account.email, passwordHash: account.password_hash } : null;
  }

  async findAccountByEmail(email: string): Promise<{ id: string; name: string; email: string; passwordHash: string | null } | null> {
    const result = await this.getPool().query<{ id: string; name: string; email: string; password_hash: string | null }>(
      'SELECT id, name, email, password_hash FROM users WHERE email = $1 LIMIT 1',
      [email.toLowerCase()],
    );
    const account = result.rows[0];
    return account ? { id: account.id, name: account.name, email: account.email, passwordHash: account.password_hash } : null;
  }

  async findAccountByGoogleSubject(subject: string): Promise<PublicAccount | null> {
    const result = await this.getPool().query<{ id: string; name: string; email: string }>(
      `SELECT users.id, users.name, users.email
       FROM users JOIN account_identities ON account_identities.account_id = users.id
       WHERE account_identities.provider = 'google' AND account_identities.provider_subject = $1
       LIMIT 1`,
      [subject],
    );
    return result.rows[0] ?? null;
  }

  async createGoogleChallenge(input: { id: string; nonceHash: string; expiresAt: Date }): Promise<void> {
    await this.getPool().query('DELETE FROM google_auth_challenges WHERE expires_at <= NOW()');
    await this.getPool().query(
      'INSERT INTO google_auth_challenges (id, nonce_hash, expires_at) VALUES ($1, $2, $3)',
      [input.id, input.nonceHash, input.expiresAt],
    );
  }

  async isGoogleChallengeValid(id: string, nonceHash: string): Promise<boolean> {
    const result = await this.getPool().query<{ id: string }>(
      'SELECT id FROM google_auth_challenges WHERE id = $1 AND nonce_hash = $2 AND expires_at > NOW()',
      [id, nonceHash],
    );
    return result.rowCount === 1;
  }

  async consumeGoogleChallenge(id: string, nonceHash: string): Promise<boolean> {
    const result = await this.getPool().query<{ id: string }>(
      'DELETE FROM google_auth_challenges WHERE id = $1 AND nonce_hash = $2 AND expires_at > NOW() RETURNING id',
      [id, nonceHash],
    );
    return result.rowCount === 1;
  }

  async createGoogleAccount(input: { id: string; name: string; email: string; subject: string; challengeId: string; nonceHash: string }): Promise<PublicAccount> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      const challenge = await client.query<{ id: string }>(
        'DELETE FROM google_auth_challenges WHERE id = $1 AND nonce_hash = $2 AND expires_at > NOW() RETURNING id',
        [input.challengeId, input.nonceHash],
      );
      if (challenge.rowCount !== 1) throw new UnauthorizedError('Google sign-in challenge is invalid, expired, or already used.');
      const user = await client.query<{ id: string; name: string; email: string }>(
        'INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, NULL) RETURNING id, name, email',
        [input.id, input.name, input.email.toLowerCase()],
      );
      await client.query(
        "INSERT INTO account_identities (id, account_id, provider, provider_subject, provider_email) VALUES ($1, $2, 'google', $3, $4)",
        [randomUUID(), input.id, input.subject, input.email.toLowerCase()],
      );
      await client.query('COMMIT');
      return user.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) throw new ConflictError('This email or Google identity is already linked to an account.');
      throw error;
    } finally { client.release(); }
  }

  async linkGoogleIdentity(input: { accountId: string; email: string; subject: string; challengeId: string; nonceHash: string }): Promise<void> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      const challenge = await client.query<{ id: string }>(
        'DELETE FROM google_auth_challenges WHERE id = $1 AND nonce_hash = $2 AND expires_at > NOW() RETURNING id',
        [input.challengeId, input.nonceHash],
      );
      if (challenge.rowCount !== 1) throw new UnauthorizedError('Google sign-in challenge is invalid, expired, or already used.');
      await client.query(
        "INSERT INTO account_identities (id, account_id, provider, provider_subject, provider_email) VALUES ($1, $2, 'google', $3, $4)",
        [randomUUID(), input.accountId, input.subject, input.email.toLowerCase()],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      if (isUniqueViolation(error)) throw new ConflictError('This Google identity is already linked to an account.');
      throw error;
    } finally { client.release(); }
  }

  async deleteAccount(accountId: string, verification: { type: 'password'; passwordHash: string } | { type: 'google'; subject: string; challengeId: string; nonceHash: string }, sessionId: string, tokenExpiresAt: Date): Promise<void> {
    const client = await this.getPool().connect();
    try {
      await client.query('BEGIN');
      const account = await client.query<{ password_hash: string | null }>(
        'SELECT users.password_hash FROM users JOIN sessions ON sessions.account_id = users.id WHERE users.id = $1 AND sessions.id = $2 AND sessions.expires_at > clock_timestamp() FOR UPDATE OF users, sessions',
        [accountId, sessionId],
      );
      if (account.rowCount === 0) throw new UnauthorizedError('Session is invalid or expired.');
      if (verification.type === 'password') {
        if (account.rows[0].password_hash !== verification.passwordHash) throw new ReauthenticationError();
      } else {
        const identity = await client.query(
          "SELECT 1 FROM account_identities WHERE account_id = $1 AND provider = 'google' AND provider_subject = $2",
          [accountId, verification.subject],
        );
        if (identity.rowCount !== 1) throw new ReauthenticationError();
        const challenge = await client.query(
          'DELETE FROM google_auth_challenges WHERE id = $1 AND nonce_hash = $2 AND expires_at > clock_timestamp() RETURNING id',
          [verification.challengeId, verification.nonceHash],
        );
        if (challenge.rowCount !== 1) throw new ReauthenticationError();
      }
      await client.query(
        'INSERT INTO deletion_receipts (session_hash, expires_at) SELECT $1, LEAST(expires_at, $2) FROM sessions WHERE id = $3 AND account_id = $4',
        [deletionReceiptHash(accountId, sessionId), tokenExpiresAt, sessionId, accountId],
      );
      await client.query('DELETE FROM users WHERE id = $1', [accountId]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async getProgress(accountId: string): Promise<StoredProgress | null> {
    const result = await this.getPool().query<{
      topic_mastery: ProgressSnapshot['topicMastery'];
      weak_spot_log: ProgressSnapshot['weakSpotLog'];
      drill_queue: ProgressSnapshot['drillQueue'];
      rule_exercise_attempts: ProgressSnapshot['ruleExerciseAttempts'];
      objective_practice_attempts: NonNullable<ProgressSnapshot['objectivePracticeAttempts']>;
      exam_sessions: NonNullable<ProgressSnapshot['examSessions']>;
      deleted_exam_session_ids: NonNullable<ProgressSnapshot['deletedExamSessionIds']>;
      exam_history_deleted_at: Date | null;
      revision: number;
      synced_at: Date;
    }>(
      'SELECT topic_mastery, weak_spot_log, drill_queue, rule_exercise_attempts, objective_practice_attempts, exam_sessions, deleted_exam_session_ids, exam_history_deleted_at, revision, synced_at FROM progress_snapshots WHERE account_id = $1',
      [accountId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      accountId,
      topicMastery: row.topic_mastery,
      weakSpotLog: row.weak_spot_log,
      drillQueue: row.drill_queue,
      ruleExerciseAttempts: row.rule_exercise_attempts,
      objectivePracticeAttempts: row.objective_practice_attempts,
      examSessions: row.exam_sessions,
      deletedExamSessionIds: row.deleted_exam_session_ids,
      examHistoryDeletedAt: row.exam_history_deleted_at?.toISOString() ?? null,
      revision: row.revision,
      syncedAt: row.synced_at.toISOString(),
    };
  }

  async saveProgress(accountId: string, snapshot: ProgressSnapshot, expectedRevision: number): Promise<{ syncedAt: string; revision: number }> {
    const result = await this.getPool().query<{ revision: number; synced_at: Date }>(
      expectedRevision === 0
            ? `INSERT INTO progress_snapshots (account_id, topic_mastery, weak_spot_log, drill_queue, rule_exercise_attempts, objective_practice_attempts, exam_sessions, deleted_exam_session_ids, exam_history_deleted_at, revision, synced_at)
              SELECT $1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::timestamptz, 1, NOW() WHERE $10 = 0
           ON CONFLICT (account_id) DO NOTHING RETURNING revision, synced_at`
        : `UPDATE progress_snapshots SET topic_mastery = $2::jsonb, weak_spot_log = $3::jsonb,
            drill_queue = $4::jsonb, rule_exercise_attempts = $5::jsonb, objective_practice_attempts = $6::jsonb,
              exam_sessions = $7::jsonb, deleted_exam_session_ids = $8::jsonb, exam_history_deleted_at = $9::timestamptz, revision = revision + 1, synced_at = NOW()
              WHERE account_id = $1 AND revision = $10 RETURNING revision, synced_at`,
          [accountId, JSON.stringify(snapshot.topicMastery), JSON.stringify(snapshot.weakSpotLog), JSON.stringify(snapshot.drillQueue), JSON.stringify(snapshot.ruleExerciseAttempts), JSON.stringify(snapshot.objectivePracticeAttempts ?? []), JSON.stringify(snapshot.examSessions ?? []), JSON.stringify(snapshot.deletedExamSessionIds ?? []), snapshot.examHistoryDeletedAt ?? null, expectedRevision],
    );
    const updated = result.rows[0];
    if (!updated) throw new ConflictError('Progress changed on the server. Reload before syncing again.');
    return { revision: updated.revision, syncedAt: updated.synced_at.toISOString() };
  }

  async healthCheck(): Promise<boolean> {
    try { await this.getPool().query('SELECT 1'); return true; }
    catch { return false; }
  }

  private getPool(): Pool {
    if (!this.config.databaseUrl) throw new ServiceUnavailableError('Progress database is not configured.');
    if (!this.pool) this.pool = new Pool({ connectionString: this.config.databaseUrl, max: 5, connectionTimeoutMillis: 2500 });
    return this.pool;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
