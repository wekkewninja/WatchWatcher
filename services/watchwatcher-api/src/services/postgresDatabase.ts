import { Pool } from 'pg';
import type { PublicAccount, ProgressSnapshot, StoredProgress } from '../../../shared/types/entities';
import type { AppConfig } from './config';
import { ConflictError, ServiceUnavailableError } from '../errors/errorTypes';
import type { IDatabaseService } from './interfaces/IDatabaseService';

export class PostgresDatabaseService implements IDatabaseService {
  private pool: Pool | null = null;

  constructor(private readonly config: AppConfig) {}

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

  async findAccountByEmail(email: string): Promise<{ id: string; name: string; email: string; passwordHash: string } | null> {
    const result = await this.getPool().query<{ id: string; name: string; email: string; password_hash: string }>(
      'SELECT id, name, email, password_hash FROM users WHERE email = $1 LIMIT 1',
      [email.toLowerCase()],
    );
    const account = result.rows[0];
    return account ? { id: account.id, name: account.name, email: account.email, passwordHash: account.password_hash } : null;
  }

  async getProgress(accountId: string): Promise<StoredProgress | null> {
    const result = await this.getPool().query<{
      topic_mastery: ProgressSnapshot['topicMastery'];
      weak_spot_log: ProgressSnapshot['weakSpotLog'];
      drill_queue: ProgressSnapshot['drillQueue'];
      rule_exercise_attempts: ProgressSnapshot['ruleExerciseAttempts'];
      revision: number;
      synced_at: Date;
    }>(
      'SELECT topic_mastery, weak_spot_log, drill_queue, rule_exercise_attempts, revision, synced_at FROM progress_snapshots WHERE account_id = $1',
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
      revision: row.revision,
      syncedAt: row.synced_at.toISOString(),
    };
  }

  async saveProgress(accountId: string, snapshot: ProgressSnapshot, expectedRevision: number): Promise<{ syncedAt: string; revision: number }> {
    const result = await this.getPool().query<{ revision: number; synced_at: Date }>(
      `INSERT INTO progress_snapshots (account_id, topic_mastery, weak_spot_log, drill_queue, rule_exercise_attempts, revision, synced_at)
       SELECT $1, $2::jsonb, $3::jsonb, $4::jsonb, $5::jsonb, 1, NOW() WHERE $6 = 0
       ON CONFLICT (account_id) DO UPDATE SET
         topic_mastery = EXCLUDED.topic_mastery,
         weak_spot_log = EXCLUDED.weak_spot_log,
         drill_queue = EXCLUDED.drill_queue,
         rule_exercise_attempts = EXCLUDED.rule_exercise_attempts,
         revision = progress_snapshots.revision + 1,
         synced_at = NOW()
       WHERE progress_snapshots.revision = $6
       RETURNING revision, synced_at`,
      [accountId, JSON.stringify(snapshot.topicMastery), JSON.stringify(snapshot.weakSpotLog), JSON.stringify(snapshot.drillQueue), JSON.stringify(snapshot.ruleExerciseAttempts), expectedRevision],
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
