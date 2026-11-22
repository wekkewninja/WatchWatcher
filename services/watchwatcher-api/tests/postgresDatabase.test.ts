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