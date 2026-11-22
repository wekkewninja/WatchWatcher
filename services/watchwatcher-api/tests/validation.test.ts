import { describe, expect, it } from 'vitest';
import { credentialsSchema, progressSyncSchema, registerSchema } from '../../shared/schemas/validation';

describe('API input contracts', () => {
  it('accepts a valid registration and rejects weak passwords', () => {
    expect(registerSchema.safeParse({ name: 'S. Taylor', email: 'sailor@example.test', password: 'a-strong-password' }).success).toBe(true);
    expect(registerSchema.safeParse({ name: 'S. Taylor', email: 'sailor@example.test', password: 'short' }).success).toBe(false);
  });

  it('validates credentials and rejects unknown fields', () => {
    expect(credentialsSchema.safeParse({ email: 'crew@example.test', password: 'long-enough' }).success).toBe(true);
    expect(credentialsSchema.safeParse({ email: 'not-an-email', password: 'long-enough', admin: true }).success).toBe(false);
  });

  it('rejects stale or malformed progress revision data', () => {
    expect(progressSyncSchema.safeParse({ topicMastery: {}, weakSpotLog: [], drillQueue: [], revision: 0 }).success).toBe(true);
    const attempt = {
      id: '32f63760-6b39-4f06-935e-430251d1b785',
      ruleId: 'rule-19',
      selectedOptionId: 'b',
      correct: true,
      attemptedAt: '2026-11-22T12:00:00.000Z',
    };
    expect(progressSyncSchema.safeParse({ topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [attempt], revision: 0 }).success).toBe(true);
    expect(progressSyncSchema.safeParse({ topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [{ ...attempt, selectedOptionId: 'e' }], revision: 0 }).success).toBe(false);
    expect(progressSyncSchema.safeParse({ topicMastery: { topic: 120 }, weakSpotLog: [], drillQueue: [], revision: -1 }).success).toBe(false);
  });
});
