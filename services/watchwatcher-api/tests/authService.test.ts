import { describe, expect, it } from 'vitest';
import type { PublicAccount, ProgressSnapshot, StoredProgress } from '../../shared/types/entities';
import type { AppConfig } from '../src/services/config';
import { AuthService } from '../src/services/authService';
import { ConflictError, UnauthorizedError } from '../src/errors/errorTypes';
import type { VerifiedGoogleIdentity } from '../src/services/googleIdentityVerifier';
import type { IDatabaseService } from '../src/services/interfaces/IDatabaseService';

type StoredAccount = PublicAccount & { passwordHash: string | null };

class MemoryAccountDatabase implements IDatabaseService {
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
  async getProgress(_accountId: string): Promise<StoredProgress | null> { return null; }
  async saveProgress(_accountId: string, _snapshot: ProgressSnapshot, _expectedRevision: number): Promise<{ syncedAt: string; revision: number }> { return { syncedAt: new Date().toISOString(), revision: 1 }; }
  async healthCheck(): Promise<boolean> { return true; }
}

const config: AppConfig = {
  environment: 'Test',
  databaseUrl: undefined,
  jwtSecret: 'test-signing-secret-with-more-than-thirty-two-characters',
  jwtIssuer: 'watchwatcher-test',
  jwtAudience: 'watchwatcher-test-client',
  googleClientId: 'google-test-client-id',
  geminiApiKey: undefined,
  azureStorageAccount: undefined,
  azuriteConnectionString: undefined,
};

describe('AuthService', () => {
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
    await expect(auth.login({ email: 'sailor@example.test', password: 'wrong-password' })).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('rejects missing and malformed bearer sessions', async () => {
    const auth = new AuthService(new MemoryAccountDatabase(), config);
    await expect(auth.authenticate(undefined)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.authenticate('Bearer not-a-jwt')).rejects.toBeInstanceOf(UnauthorizedError);
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
