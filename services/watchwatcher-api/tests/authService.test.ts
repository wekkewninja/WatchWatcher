import { describe, expect, it, vi } from 'vitest';
import type { PublicAccount, ProgressSnapshot, StoredProgress } from '../../shared/types/entities';
import type { AppConfig } from '../src/services/config';
import { AuthService } from '../src/services/authService';
import { ConflictError, ReauthenticationError, UnauthorizedError } from '../src/errors/errorTypes';
import type { VerifiedGoogleIdentity } from '../src/services/googleIdentityVerifier';
import type { IDatabaseService } from '../src/services/interfaces/IDatabaseService';

type StoredAccount = PublicAccount & { passwordHash: string | null };

class MemoryAccountDatabase implements IDatabaseService {
  async consumeIdentifierLimit(_keyHash: string, _limit: number, _windowSeconds: number): Promise<{ allowed: boolean; retryAfter: number }> { return { allowed: true, retryAfter: 1 }; }
  readonly accounts = new Map<string, StoredAccount>();
  readonly googleIdentities = new Map<string, string>();
  readonly googleChallenges = new Map<string, { nonceHash: string; expiresAt: Date }>();
  async createAccount(input: { id: string; name: string; email: string; passwordHash: string }): Promise<PublicAccount> {
    if ([...this.accounts.values()].some((account) => account.email === input.email.toLowerCase())) throw new ConflictError('Duplicate account');
    const account = { id: input.id, name: input.name, email: input.email.toLowerCase(), passwordHash: input.passwordHash };
    this.accounts.set(account.email, account);
    return { id: account.id, name: account.name, email: account.email };
  }
  async findAccountByEmail(email: string): Promise<StoredAccount | null> { return this.accounts.get(email.toLowerCase()) ?? null; }
  async findAccountById(id: string): Promise<StoredAccount | null> { return [...this.accounts.values()].find((account) => account.id === id) ?? null; }
  async findAccountByGoogleSubject(subject: string): Promise<PublicAccount | null> {
    const accountId = this.googleIdentities.get(subject);
    return accountId ? [...this.accounts.values()].find((account) => account.id === accountId) ?? null : null;
  }
  async createGoogleChallenge(input: { id: string; nonceHash: string; expiresAt: Date }): Promise<void> {
    this.googleChallenges.set(input.id, { nonceHash: input.nonceHash, expiresAt: input.expiresAt });
  }
  async isGoogleChallengeValid(id: string, nonceHash: string): Promise<boolean> {
    const challenge = this.googleChallenges.get(id);
    return Boolean(challenge && challenge.nonceHash === nonceHash && challenge.expiresAt > new Date());
  }
  async consumeGoogleChallenge(id: string, nonceHash: string): Promise<boolean> {
    if (!(await this.isGoogleChallengeValid(id, nonceHash))) return false;
    this.googleChallenges.delete(id);
    return true;
  }
  async createGoogleAccount(input: { id: string; name: string; email: string; subject: string; challengeId: string; nonceHash: string }): Promise<PublicAccount> {
    if (!(await this.consumeGoogleChallenge(input.challengeId, input.nonceHash))) throw new UnauthorizedError('Invalid challenge');
    if (await this.findAccountByEmail(input.email)) throw new ConflictError('Duplicate account');
    const account = { id: input.id, name: input.name, email: input.email.toLowerCase(), passwordHash: null };
    this.accounts.set(account.email, account);
    this.googleIdentities.set(input.subject, input.id);
    return { id: account.id, name: account.name, email: account.email };
  }
  async linkGoogleIdentity(input: { accountId: string; email: string; subject: string; challengeId: string; nonceHash: string }): Promise<void> {
    if (!(await this.consumeGoogleChallenge(input.challengeId, input.nonceHash))) throw new UnauthorizedError('Invalid challenge');
    if (this.googleIdentities.has(input.subject)) throw new ConflictError('Identity already linked');
    this.googleIdentities.set(input.subject, input.accountId);
  }
  async deleteAccount(accountId: string, verification: { type: 'password'; passwordHash: string } | { type: 'google'; subject: string; challengeId: string; nonceHash: string }): Promise<void> {
    const account = await this.findAccountById(accountId);
    if (!account) return;
    if (verification.type === 'password') {
      if (verification.passwordHash !== account.passwordHash) throw new ReauthenticationError();
    } else {
      if (this.googleIdentities.get(verification.subject) !== accountId || !(await this.consumeGoogleChallenge(verification.challengeId, verification.nonceHash))) throw new ReauthenticationError();
    }
    this.accounts.delete(account.email);
    for (const [subject, id] of this.googleIdentities) if (id === accountId) this.googleIdentities.delete(subject);
  }
  async getProgress(_accountId: string): Promise<StoredProgress | null> { return null; }
  async saveProgress(_accountId: string, _snapshot: ProgressSnapshot, _expectedRevision: number): Promise<{ syncedAt: string; revision: number }> { return { syncedAt: new Date().toISOString(), revision: 1 }; }
  async healthCheck(): Promise<boolean> { return true; }
}

const config: AppConfig = {
  environment: 'Test',
  databaseUrl: undefined,
  jwtSecret: 'test-signing-secret-with-more-than-thirty-two-characters',
  rateLimitSecret: 'test-rate-limit-secret-with-more-than-thirty-two-characters',
  jwtIssuer: 'watchwatcher-test',
  jwtAudience: 'watchwatcher-test-client',
  googleClientId: 'google-test-client-id',
  geminiApiKey: undefined,
  azureStorageAccount: undefined,
  azuriteConnectionString: undefined,
};

describe('AuthService', () => {
  it('uses normalized, scoped HMACs before account lookups and password hashing', async () => {
    const database = new MemoryAccountDatabase();
    const consume = vi.spyOn(database, 'consumeIdentifierLimit').mockResolvedValue({ allowed: false, retryAfter: 73 });
    const lookup = vi.spyOn(database, 'findAccountByEmail');
    const create = vi.spyOn(database, 'createAccount');
    const auth = new AuthService(database, config);
    for (const email of [' Sailor@Example.Test ', 'sailor@example.test']) {
      await expect(auth.login({ email, password: 'synthetic-password' })).rejects.toMatchObject({ statusCode: 429, retryAfter: 73 });
    }
    await expect(auth.register({ name: 'Sailor', email: 'sailor@example.test', password: 'synthetic-password' })).rejects.toMatchObject({ statusCode: 429, retryAfter: 73 });
    const calls = consume.mock.calls;
    expect(calls[0]).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/), 5, 900]);
    expect(calls[1][0]).toBe(calls[0][0]);
    expect(calls[2]).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/), 5, 3600]);
    expect(calls[2][0]).not.toBe(calls[0][0]);
    expect(JSON.stringify(calls)).not.toContain('sailor@example.test');
    expect(JSON.stringify(calls)).not.toContain(config.rateLimitSecret);
    expect(lookup).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('applies identical login limits and failures to known and unknown emails', async () => {
    const database = new MemoryAccountDatabase();
    database.accounts.set('known@example.test', { id: 'synthetic', name: 'Known', email: 'known@example.test', passwordHash: null });
    const counters = new Map<string, number>();
    vi.spyOn(database, 'consumeIdentifierLimit').mockImplementation(async (key, limit) => {
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return { allowed: count <= limit, retryAfter: 100 };
    });
    const auth = new AuthService(database, config);
    const outcomes: Array<Array<{ statusCode: number; message: string }>> = [];
    for (const email of ['known@example.test', 'unknown@example.test']) {
      const attempts: Array<{ statusCode: number; message: string }> = [];
      for (let attempt = 0; attempt < 6; attempt++) {
        const error = await auth.login({ email, password: 'synthetic-password' }).catch((failure: unknown) => failure);
        attempts.push({ statusCode: error.statusCode, message: error.message });
      }
      outcomes.push(attempts);
    }
    expect(outcomes[0]).toEqual(outcomes[1]);
    expect(outcomes[0].map((outcome) => outcome.statusCode)).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it('fails closed without a distinct strong key or when the store fails, in every environment', async () => {
    for (const environment of ['Production', 'Development', 'Test']) {
      for (const rateLimitSecret of [undefined, 'short', ' '.repeat(40), config.jwtSecret]) {
        const database = new MemoryAccountDatabase();
        const lookup = vi.spyOn(database, 'findAccountByEmail');
        const auth = new AuthService(database, { ...config, environment, rateLimitSecret });
        await expect(auth.login({ email: 'synthetic@example.test', password: 'synthetic-password' })).rejects.toMatchObject({ statusCode: 503, message: 'Rate limiting is not configured.' });
        expect(lookup).not.toHaveBeenCalled();
      }
    }
    const database = new MemoryAccountDatabase();
    vi.spyOn(database, 'consumeIdentifierLimit').mockRejectedValue(new Error('synthetic credential database detail'));
    const error = await new AuthService(database, config).login({ email: 'synthetic@example.test', password: 'synthetic-password' }).catch((failure: unknown) => failure);
    expect(error).toMatchObject({ statusCode: 503, message: 'Rate limiting is unavailable.' });
    expect(JSON.stringify(error)).not.toContain('synthetic credential');
    expect(error.stack).not.toContain('synthetic credential');
  });

  it('verifies a deletion bearer before looking up the account and consuming its quota', async () => {
    const database = new MemoryAccountDatabase();
    const auth = new AuthService(database, config);
    const session = await auth.register({ name: 'Sailor', email: 'synthetic@example.test', password: 'synthetic-password' });
    const consume = vi.spyOn(database, 'consumeIdentifierLimit').mockResolvedValue({ allowed: false, retryAfter: 42 });
    const lookup = vi.spyOn(database, 'findAccountById');
    const request = { confirmation: 'DELETE' as const, reauthentication: { type: 'password' as const, password: 'synthetic-password' } };
    await expect(auth.deleteAccount('Bearer invalid', request)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(consume).not.toHaveBeenCalled();
    await expect(auth.deleteAccount(`Bearer ${session.session}`, request)).rejects.toMatchObject({ statusCode: 429, retryAfter: 42 });
    expect(consume).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/), 5, 900);
    expect(JSON.stringify(consume.mock.calls)).not.toContain(session.accountId);
    expect(lookup).toHaveBeenCalledWith(session.accountId);
  });

  it('allows an already-deleted account to confirm deletion even when its quota is exhausted', async () => {
    const database = new MemoryAccountDatabase();
    const auth = new AuthService(database, config);
    const session = await auth.register({ name: 'Sailor', email: 'synthetic@example.test', password: 'synthetic-password' });
    database.accounts.clear();
    const consume = vi.spyOn(database, 'consumeIdentifierLimit').mockResolvedValue({ allowed: false, retryAfter: 42 });
    await expect(auth.deleteAccount(`Bearer ${session.session}`, { confirmation: 'DELETE', reauthentication: { type: 'password', password: 'synthetic-password' } })).resolves.toBeUndefined();
    expect(consume).not.toHaveBeenCalled();
  });

  it('shares the password login quota with Google account linking', async () => {
    const database = new MemoryAccountDatabase();
    let identity: VerifiedGoogleIdentity;
    const auth = new AuthService(database, config, { verify: async () => identity });
    await auth.register({ name: 'Sailor', email: 'sailor@example.test', password: 'synthetic-password' });
    const challenge = await auth.createGoogleChallenge();
    identity = { subject: 'google-subject', email: 'sailor@example.test', name: 'Sailor', nonce: challenge.nonce };
    const consume = vi.spyOn(database, 'consumeIdentifierLimit').mockResolvedValue({ allowed: false, retryAfter: 42 });
    await expect(auth.login({ email: identity.email, password: 'wrong-password' })).rejects.toMatchObject({ statusCode: 429 });
    await expect(auth.loginWithGoogle({ credential: 'credential', challengeId: challenge.challengeId, linkExisting: { confirmed: true, password: 'wrong-password' } })).rejects.toMatchObject({ statusCode: 429 });
    expect(consume.mock.calls[0][0]).toBe(consume.mock.calls[1][0]);
  });
  it('requires the current account password and makes deletion retryable without reviving old sessions', async () => {
    const database = new MemoryAccountDatabase();
    const auth = new AuthService(database, config);
    const first = await auth.register({ name: 'First', email: 'first@example.test', password: 'first-password' });
    const second = await auth.register({ name: 'Second', email: 'second@example.test', password: 'second-password' });
    const request = (password: string) => ({ confirmation: 'DELETE' as const, reauthentication: { type: 'password' as const, password } });
    await expect(auth.deleteAccount(`Bearer ${first.session}`, request('second-password'))).rejects.toMatchObject({ statusCode: 403, code: 'REAUTHENTICATION_FAILED' });
    await expect(auth.authenticate(`Bearer ${first.session}`)).resolves.toMatchObject({ id: first.accountId });
    await auth.deleteAccount(`Bearer ${first.session}`, request('first-password'));
    await expect(auth.authenticate(`Bearer ${first.session}`)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.deleteAccount(`Bearer ${first.session}`, request('wrong-password'))).resolves.toBeUndefined();
    await expect(auth.authenticate(`Bearer ${second.session}`)).resolves.toMatchObject({ id: second.accountId });
    await expect(auth.deleteAccount('Bearer invalid', request('first-password'))).rejects.toBeInstanceOf(UnauthorizedError);
    const replacement = await auth.register({ name: 'First', email: 'first@example.test', password: 'first-password' });
    expect(replacement.accountId).not.toBe(first.accountId);
    await expect(auth.authenticate(`Bearer ${first.session}`)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.deleteAccount(`Bearer ${first.session}`, request('first-password'))).resolves.toBeUndefined();
    await expect(auth.authenticate(`Bearer ${replacement.session}`)).resolves.toMatchObject({ id: replacement.accountId });
  });

  it('requires a linked Google subject and an unused nonce for deletion', async () => {
    const database = new MemoryAccountDatabase();
    let identity: VerifiedGoogleIdentity;
    const auth = new AuthService(database, config, { verify: async (credential, audience) => {
      expect(audience).toBe(config.googleClientId);
      if (credential === 'invalid') throw new Error('secret verifier detail');
      return identity;
    } });
    const challenge = await auth.createGoogleChallenge();
    identity = { subject: 'google-first', email: 'first@example.test', name: 'First', nonce: challenge.nonce };
    const signedIn = await auth.loginWithGoogle({ credential: 'valid', challengeId: challenge.challengeId });
    if (signedIn.kind !== 'session') throw new Error('Expected session');
    const authorization = `Bearer ${signedIn.session.session}`;
    const next = await auth.createGoogleChallenge();
    const request = { confirmation: 'DELETE' as const, reauthentication: { type: 'google' as const, credential: 'valid', challengeId: next.challengeId } };
    identity = { ...identity, subject: 'google-other', nonce: next.nonce };
    await expect(auth.deleteAccount(authorization, request)).rejects.toBeInstanceOf(ReauthenticationError);
    await expect(auth.deleteAccount(authorization, { ...request, reauthentication: { ...request.reauthentication, credential: 'invalid' } })).rejects.toMatchObject({ statusCode: 403, code: 'REAUTHENTICATION_FAILED', message: 'Reauthentication failed.' });
    identity = { ...identity, subject: 'google-first', nonce: challenge.nonce };
    await expect(auth.deleteAccount(authorization, { ...request, reauthentication: { ...request.reauthentication, challengeId: challenge.challengeId } })).rejects.toBeInstanceOf(ReauthenticationError);
    const expired = await auth.createGoogleChallenge();
    database.googleChallenges.get(expired.challengeId)!.expiresAt = new Date(0);
    identity = { ...identity, nonce: expired.nonce };
    await expect(auth.deleteAccount(authorization, { ...request, reauthentication: { ...request.reauthentication, challengeId: expired.challengeId } })).rejects.toBeInstanceOf(ReauthenticationError);
    identity = { ...identity, nonce: next.nonce };
    await auth.deleteAccount(authorization, request);
    expect(database.googleChallenges.has(next.challengeId)).toBe(false);
    await expect(auth.authenticate(authorization)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.deleteAccount(authorization, request)).resolves.toBeUndefined();
  });

  it('propagates deletion database failures', async () => {
    const database = new MemoryAccountDatabase();
    const auth = new AuthService(database, config);
    const session = await auth.register({ name: 'Sailor', email: 'sailor@example.test', password: 'a-strong-password' });
    database.deleteAccount = async () => { throw new Error('database unavailable'); };
    await expect(auth.deleteAccount(`Bearer ${session.session}`, { confirmation: 'DELETE', reauthentication: { type: 'password', password: 'a-strong-password' } })).rejects.toThrow('database unavailable');
  });
  it('rejects deleted account sessions without masking database failures', async () => {
    const database = new MemoryAccountDatabase();
    const auth = new AuthService(database, config);
    const session = await auth.register({ name: 'Sailor', email: 'sailor@example.test', password: 'a-strong-password' });
    database.accounts.clear();
    await expect(auth.authenticate(`Bearer ${session.session}`)).rejects.toBeInstanceOf(UnauthorizedError);
    database.findAccountById = async () => { throw new Error('database unavailable'); };
    await expect(auth.authenticate(`Bearer ${session.session}`)).rejects.toThrow('database unavailable');
  });
  it('hashes a new password and authenticates a signed session', async () => {
    const database = new MemoryAccountDatabase();
    const auth = new AuthService(database, config);
    const session = await auth.register({ name: 'S. Taylor', email: 'sailor@example.test', password: 'a-strong-password' });
    const stored = await database.findAccountByEmail('sailor@example.test');
    expect(stored?.passwordHash).not.toBe('a-strong-password');
    expect(session.user).not.toHaveProperty('passwordHash');
    await expect(auth.authenticate(`Bearer ${session.session}`)).resolves.toMatchObject({ id: session.accountId, email: 'sailor@example.test' });
  });

  it('rejects duplicate registrations and invalid credentials', async () => {
    const database = new MemoryAccountDatabase();
    const auth = new AuthService(database, config);
    await auth.register({ name: 'S. Taylor', email: 'sailor@example.test', password: 'a-strong-password' });
    await expect(auth.register({ name: 'Other', email: 'sailor@example.test', password: 'another-strong-password' })).rejects.toBeInstanceOf(ConflictError);
    const invalidLogins = await Promise.all([
      auth.login({ email: 'sailor@example.test', password: 'wrong-password' }).catch((error: unknown) => error),
      auth.login({ email: 'unknown@example.test', password: 'wrong-password' }).catch((error: unknown) => error),
    ]);
    expect(invalidLogins.every((error) => error instanceof UnauthorizedError)).toBe(true);
    expect(invalidLogins.map((error) => (error as Error).message)).toEqual([
      'Email or password is incorrect.',
      'Email or password is incorrect.',
    ]);
  });

  it('rejects missing and malformed bearer sessions', async () => {
    const auth = new AuthService(new MemoryAccountDatabase(), config);
    await expect(auth.authenticate(undefined)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.authenticate('Bearer not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('normalizes invalid Google-provider credentials without exposing verifier errors', async () => {
    const auth = new AuthService(new MemoryAccountDatabase(), config, {
      verify: async () => { throw new Error('provider verification internals'); },
    });
    await expect(auth.loginWithGoogle({ credential: 'invalid-token', challengeId: 'challenge' }))
      .rejects.toMatchObject({ statusCode: 401, message: 'Google sign-in credential is invalid or expired.' });
  });

  it('rejects session creation without a configured signing secret and Google setup without a client ID', async () => {
    const missingSigningSecret = new AuthService(new MemoryAccountDatabase(), { ...config, jwtSecret: undefined });
    await expect(missingSigningSecret.register({ name: 'Sailor', email: 'sailor@example.test', password: 'a-strong-password' }))
      .rejects.toThrow('Session signing is not configured.');
    expect(() => new AuthService(new MemoryAccountDatabase(), { ...config, googleClientId: undefined }).getGoogleClientId())
      .toThrow('Google sign-in is not configured.');
  });

  it('keeps sessions account-scoped', async () => {
    const auth = new AuthService(new MemoryAccountDatabase(), config);
    const first = await auth.register({ name: 'First', email: 'first@example.test', password: 'first-password-long' });
    const second = await auth.register({ name: 'Second', email: 'second@example.test', password: 'second-password-long' });
    await expect(auth.authenticate(`Bearer ${first.session}`)).resolves.toMatchObject({ id: first.accountId });
    await expect(auth.authenticate(`Bearer ${second.session}`)).resolves.toMatchObject({ id: second.accountId });
    expect(first.accountId).not.toBe(second.accountId);
  });

  it('creates a passwordless Google account and returns the same account on later sign-ins', async () => {
    const database = new MemoryAccountDatabase();
    let verified: VerifiedGoogleIdentity | undefined;
    const verifier = { verify: async (_credential: string, audience: string) => {
      expect(audience).toBe(config.googleClientId);
      if (!verified) throw new UnauthorizedError('Invalid Google identity');
      return verified;
    } };
    const auth = new AuthService(database, config, verifier);
    const firstChallenge = await auth.createGoogleChallenge();
    verified = { subject: 'google-sub-1', email: 'google@example.test', name: 'Google Student', nonce: firstChallenge.nonce };
    const first = await auth.loginWithGoogle({ credential: 'signed-google-id-token', challengeId: firstChallenge.challengeId });
    expect(first.kind).toBe('session');
    if (first.kind !== 'session') throw new Error('Expected Google account session.');
    expect(await auth.authenticate(`Bearer ${first.session.session}`)).toMatchObject({ id: first.session.accountId, email: 'google@example.test' });
    expect((await database.findAccountByEmail('google@example.test'))?.passwordHash).toBeNull();

    const secondChallenge = await auth.createGoogleChallenge();
    verified = { ...verified, nonce: secondChallenge.nonce };
    const second = await auth.loginWithGoogle({ credential: 'signed-google-id-token', challengeId: secondChallenge.challengeId });
    expect(second.kind).toBe('session');
    if (second.kind !== 'session') throw new Error('Expected Google account session.');
    expect(second.session.accountId).toBe(first.session.accountId);
    expect(database.accounts.size).toBe(1);
  });

  it('requires explicit password confirmation before linking a matching Google identity', async () => {
    const database = new MemoryAccountDatabase();
    let identity: VerifiedGoogleIdentity;
    const auth = new AuthService(database, config, { verify: async (_credential, _audience) => identity });
    const existing = await auth.register({ name: 'Existing Student', email: 'link@example.test', password: 'a-strong-password' });
    const challenge = await auth.createGoogleChallenge();
    identity = { subject: 'google-sub-link', email: 'link@example.test', name: 'Google Name', nonce: challenge.nonce };

    await expect(auth.loginWithGoogle({ credential: 'signed-token', challengeId: challenge.challengeId })).resolves.toEqual({ kind: 'link-required' });
    await expect(auth.loginWithGoogle({ credential: 'signed-token', challengeId: challenge.challengeId, linkExisting: { confirmed: true, password: 'wrong-password' } })).rejects.toBeInstanceOf(UnauthorizedError);
    const linked = await auth.loginWithGoogle({ credential: 'signed-token', challengeId: challenge.challengeId, linkExisting: { confirmed: true, password: 'a-strong-password' } });
    expect(linked.kind).toBe('session');
    if (linked.kind !== 'session') throw new Error('Expected linked account session.');
    expect(linked.session.accountId).toBe(existing.accountId);
    expect(await database.findAccountByGoogleSubject(identity.subject)).toMatchObject({ id: existing.accountId });
  });

  it('rejects a Google challenge consumed between validation and session creation', async () => {
    const database = new MemoryAccountDatabase();
    const linkedAccount = { id: 'account-linked', name: 'Sailor', email: 'linked@example.test', passwordHash: null };
    database.accounts.set(linkedAccount.email, linkedAccount);
    database.googleIdentities.set('google-sub-race', linkedAccount.id);
    let identity: VerifiedGoogleIdentity;
    const auth = new AuthService(database, config, { verify: async () => identity });
    const challenge = await auth.createGoogleChallenge();
    identity = { subject: 'google-sub-race', email: linkedAccount.email, name: linkedAccount.name, nonce: challenge.nonce };
    database.consumeGoogleChallenge = async () => false;

    await expect(auth.loginWithGoogle({ credential: 'signed-token', challengeId: challenge.challengeId }))
      .rejects.toMatchObject({ statusCode: 401, message: 'Google sign-in challenge is invalid, expired, or already used.' });
  });

  it('rejects a replayed Google nonce challenge', async () => {
    const database = new MemoryAccountDatabase();
    let identity: VerifiedGoogleIdentity | undefined;
    const auth = new AuthService(database, config, { verify: async () => {
      if (!identity) throw new UnauthorizedError('Invalid token');
      return identity;
    } });
    const challenge = await auth.createGoogleChallenge();
    identity = { subject: 'google-sub-replay', email: 'replay@example.test', name: 'Replay', nonce: challenge.nonce };
    await auth.loginWithGoogle({ credential: 'signed-token', challengeId: challenge.challengeId });
    await expect(auth.loginWithGoogle({ credential: 'signed-token', challengeId: challenge.challengeId })).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
