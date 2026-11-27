import { describe, expect, it } from 'vitest';
import { credentialsSchema, deleteAccountSchema, googleSignInSchema, progressSyncSchema, registerSchema } from '../../shared/schemas/validation';

describe('API input contracts', () => {
  it('requires explicit deletion confirmation and exactly one reauthentication method', () => {
    const password = { confirmation: 'DELETE', reauthentication: { type: 'password', password: 'password' } };
    const google = { confirmation: 'DELETE', reauthentication: { type: 'google', credential: 'g'.repeat(100), challengeId: '4a3eea85-72f6-4f90-a045-cf8fc2d83ff4' } };
    expect(deleteAccountSchema.safeParse(password).success).toBe(true);
    expect(deleteAccountSchema.safeParse(google).success).toBe(true);
    expect(deleteAccountSchema.safeParse({ ...password, confirmation: 'delete' }).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ ...password, accountId: 'another-account' }).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ ...google, reauthentication: { ...google.reauthentication, password: 'password' } }).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ ...google, reauthentication: { ...google.reauthentication, challengeId: 'invalid' } }).success).toBe(false);
  });
  it('accepts a valid registration and rejects weak passwords', () => {
    expect(registerSchema.safeParse({ name: 'S. Taylor', email: 'sailor@example.test', password: 'a-strong-password' }).success).toBe(true);
    expect(registerSchema.safeParse({ name: 'S. Taylor', email: 'sailor@example.test', password: 'short' }).success).toBe(false);
  });

  it('prevents new bcrypt passwords from exceeding 72 UTF-8 bytes', () => {
    const account = { name: 'Sailor', email: 'sailor@example.test' };
    expect(registerSchema.safeParse({ ...account, password: 'a'.repeat(72) }).success).toBe(true);
    expect(registerSchema.safeParse({ ...account, password: 'a'.repeat(73) }).success).toBe(false);
    expect(registerSchema.safeParse({ ...account, password: '\u00e9'.repeat(36) }).success).toBe(true);
    expect(registerSchema.safeParse({ ...account, password: '\u00e9'.repeat(37) }).success).toBe(false);
  });

  it('validates credentials and rejects unknown fields', () => {
    expect(credentialsSchema.safeParse({ email: 'crew@example.test', password: 'long-enough' }).success).toBe(true);
    expect(credentialsSchema.safeParse({ email: 'not-an-email', password: 'long-enough', admin: true }).success).toBe(false);
  });

  it('requires a Google credential and a verified-flow challenge, and only accepts explicit account-link consent', () => {
    const request = {
      credential: 'g'.repeat(100),
      challengeId: '4a3eea85-72f6-4f90-a045-cf8fc2d83ff4',
    };
    expect(googleSignInSchema.safeParse(request).success).toBe(true);
    expect(googleSignInSchema.safeParse({ ...request, challengeId: 'not-a-uuid' }).success).toBe(false);
    expect(googleSignInSchema.safeParse({ ...request, linkExisting: { confirmed: false, password: 'valid-password' } }).success).toBe(false);
    expect(googleSignInSchema.safeParse({ ...request, linkExisting: { confirmed: true, password: 'valid-password' } }).success).toBe(true);
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
