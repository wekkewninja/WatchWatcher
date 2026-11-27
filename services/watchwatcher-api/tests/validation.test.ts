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
    expect(deleteAccountSchema.safeParse({ confirmation: 'DELETE', receiptOnly: true }).success).toBe(true);
    expect(deleteAccountSchema.safeParse({ ...password, receiptOnly: true }).success).toBe(false);
    expect(deleteAccountSchema.safeParse({ confirmation: 'DELETE', receiptOnly: false }).success).toBe(false);
  });
  it('accepts a valid registration and rejects weak passwords', () => {
    expect(registerSchema.safeParse({ name: 'S. Taylor', email: 'sailor@example.test', password: 'a-strong-password' }).success).toBe(true);
    expect(registerSchema.safeParse({ name: 'S. Taylor', email: 'sailor@example.test', password: 'short' }).success).toBe(false);
  });

  it('enforces the same Unicode bounds for every password flow', () => {
    const account = { name: 'Sailor', email: 'sailor@example.test' };
    const accepts = (password: string) => [
      registerSchema.safeParse({ ...account, password }).success,
      credentialsSchema.safeParse({ email: account.email, password }).success,
      googleSignInSchema.safeParse({ credential: 'g'.repeat(100), challengeId: '4a3eea85-72f6-4f90-a045-cf8fc2d83ff4', linkExisting: { confirmed: true, password } }).success,
      deleteAccountSchema.safeParse({ confirmation: 'DELETE', reauthentication: { type: 'password', password } }).success,
    ];
    for (const password of ['a'.repeat(73), '\u00e9'.repeat(256), '\u{1f6a2}'.repeat(1024), 'a'.repeat(1024)]) expect(accepts(password)).toEqual([true, true, true, true]);
    for (const password of ['a'.repeat(1025), '\u{1f6a2}'.repeat(1025), 'valid-password\ud800']) expect(accepts(password)).toEqual([false, false, false, false]);
    expect(accepts('\u{1f6a2}'.repeat(7))).toEqual([false, false, false, true]);
    expect(accepts('\u{1f6a2}'.repeat(8))).toEqual([false, true, true, true]);
    expect(accepts('\u{1f6a2}'.repeat(9))).toEqual([false, true, true, true]);
    expect(accepts('\u{1f6a2}'.repeat(10))).toEqual([true, true, true, true]);
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
