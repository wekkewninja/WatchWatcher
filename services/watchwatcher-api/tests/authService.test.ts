import { describe, expect, it, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { PublicAccount, ProgressSnapshot, StoredProgress } from '../../shared/types/entities';
import type { AppConfig } from '../src/services/config';
import { AuthService } from '../src/services/authService';
import { ConflictError, ReauthenticationError, UnauthorizedError } from '../src/errors/errorTypes';
import * as passwordHash from '../src/services/passwordHash';
import type { VerifiedGoogleIdentity } from '../src/services/googleIdentityVerifier';
import type { IDatabaseService } from '../src/services/interfaces/IDatabaseService';
import { deletionReceiptHash } from '../src/services/deletionReceipt';

type StoredAccount = PublicAccount & { passwordHash: string | null };

class MemoryAccountDatabase implements IDatabaseService {
  readonly sessions = new Map<string, { accountId: string; expiresAt: Date }>();
  readonly receipts = new Map<string, Date>();
  async hasDeletionReceipt(sessionHash: string): Promise<boolean> { return (this.receipts.get(sessionHash)?.getTime() ?? 0) > Date.now(); }
  async createSession(id: string, accountId: string, expiresAt: Date): Promise<void> {
    if (!(await this.findAccountById(accountId))) throw new Error('Account no longer exists');
    this.sessions.set(id, { accountId, expiresAt });
  }
  async findSessionAccount(id: string, accountId: string): Promise<StoredAccount | null> {
    const session = this.sessions.get(id);
    return session && session.accountId === accountId && session.expiresAt > new Date() ? this.findAccountById(accountId) : null;
  }
  async revokeSession(id: string, accountId: string): Promise<void> {
    if (this.sessions.get(id)?.accountId === accountId) this.sessions.delete(id);
    this.receipts.delete(deletionReceiptHash(accountId, id));
  }
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
  async deleteAccount(accountId: string, verification: { type: 'password'; passwordHash: string } | { type: 'google'; subject: string; challengeId: string; nonceHash: string }, sessionId: string, tokenExpiresAt: Date): Promise<void> {
    const account = await this.findSessionAccount(sessionId, accountId);
    if (!account) throw new UnauthorizedError();
    if (verification.type === 'password') {
      if (verification.passwordHash !== account.passwordHash) throw new ReauthenticationError();
    } else {
      if (this.googleIdentities.get(verification.subject) !== accountId || !(await this.consumeGoogleChallenge(verification.challengeId, verification.nonceHash))) throw new ReauthenticationError();
    }
    this.receipts.set(deletionReceiptHash(accountId, sessionId), new Date(Math.min(tokenExpiresAt.getTime(), this.sessions.get(sessionId)!.expiresAt.getTime())));
    this.accounts.delete(account.email);
    for (const [id, session] of this.sessions) if (session.accountId === accountId) this.sessions.delete(id);
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
  it('only confirms an existing receipt in receipt-only mode', async () => {
    const database = new MemoryAccountDatabase();
    const auth = new AuthService(database, config, { verify: async () => { throw new Error('unused'); } });
    const session = await auth.register({ name: 'Sailor', email: 'receipt@example.test', password: 'valid-password' });
    const otherSession = await auth.login({ email: 'receipt@example.test', password: 'valid-password' });
    const bearer = `Bearer ${session.session}`;
    const receipt = { confirmation: 'DELETE' as const, receiptOnly: true as const };
    await expect(auth.deleteAccount(bearer, receipt)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(await database.findAccountById(session.accountId)).not.toBeNull();
    await auth.deleteAccount(bearer, { confirmation: 'DELETE', reauthentication: { type: 'password', password: 'valid-password' } });
    await expect(auth.deleteAccount(bearer, receipt)).resolves.toBeUndefined();
    await expect(auth.deleteAccount(`Bearer ${otherSession.session}`, receipt)).rejects.toBeInstanceOf(UnauthorizedError);
  });
  it('verifies missing accounts and missing hashes for login and explicit Google linking', async () => {
    const database = new MemoryAccountDatabase();
    let identity: VerifiedGoogleIdentity;
    const auth = new AuthService(database, config, { verify: async () => identity });
    const verify = vi.spyOn(passwordHash, 'verifyPassword');
    const password = 'synthetic-password';
    const account = { id: 'synthetic', name: 'Sailor', email: 'known@example.test', passwordHash: null };
    database.accounts.set(account.email, account);
    for (const email of ['unknown@example.test', account.email]) {
      await expect(auth.login({ email, password })).rejects.toMatchObject({ statusCode: 401, message: 'Email or password is incorrect.' });
      expect(verify).toHaveBeenLastCalledWith(password, email === account.email ? null : undefined);
      const challenge = await auth.createGoogleChallenge();
      identity = { subject: 'google-subject', email, name: 'Sailor', nonce: challenge.nonce };
      await expect(auth.loginWithGoogle({ credential: 'credential', challengeId: challenge.challengeId, linkExisting: { confirmed: true, password } }))
        .rejects.toMatchObject({ statusCode: 401, message: 'The existing account password is incorrect.' });
      expect(verify).toHaveBeenLastCalledWith(password, email === account.email ? null : undefined);
      expect(database.googleChallenges.has(challenge.challengeId)).toBe(true);
    }
    expect(verify).toHaveBeenCalledTimes(4);
    expect(database.accounts.size).toBe(1);
    expect(database.googleIdentities.size).toBe(0);
    verify.mockRestore();
  });

  it('propagates sanitized password verification failures as service errors', async () => {
    const database = new MemoryAccountDatabase();
    let identity: VerifiedGoogleIdentity;
    const auth = new AuthService(database, config, { verify: async () => identity });
    const verify = vi.spyOn(passwordHash, 'verifyPassword').mockRejectedValue(new (await import('../src/errors/errorTypes')).ServiceUnavailableError());
    await expect(auth.login({ email: 'unknown@example.test', password: 'synthetic-password' })).rejects.toMatchObject({ statusCode: 503, message: 'A required service is unavailable' });
    const challenge = await auth.createGoogleChallenge();
    identity = { subject: 'google-subject', email: 'unknown@example.test', name: 'Sailor', nonce: challenge.nonce };
    await expect(auth.loginWithGoogle({ credential: 'credential', challengeId: challenge.challengeId, linkExisting: { confirmed: true, password: 'synthetic-password' } }))
      .rejects.toMatchObject({ statusCode: 503, message: 'A required service is unavailable' });
    verify.mockRestore();
  });
  it('uses the entire long Unicode password for login, Google linking and deletion', async () => {
    const database = new MemoryAccountDatabase();
    let identity: VerifiedGoogleIdentity;
    const auth = new AuthService(database, config, { verify: async () => identity });
    const password = 'a'.repeat(72) + '\u{1f6a2}'.repeat(256);
    const session = await auth.register({ name: 'Sailor', email: 'long@example.test', password });
    await expect(auth.login({ email: 'long@example.test', password: password.slice(0, 72) })).rejects.toMatchObject({ statusCode: 401, message: 'Email or password is incorrect.' });
    await expect(auth.login({ email: 'long@example.test', password })).resolves.toMatchObject({ accountId: session.accountId });
    const challenge = await auth.createGoogleChallenge();
    identity = { subject: 'long-google', email: 'long@example.test', name: 'Sailor', nonce: challenge.nonce };
    const link = (value: string) => ({ credential: 'credential', challengeId: challenge.challengeId, linkExisting: { confirmed: true as const, password: value } });
    await expect(auth.loginWithGoogle(link(password.slice(0, 72)))).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.loginWithGoogle(link(password))).resolves.toMatchObject({ kind: 'session' });
    const request = (value: string) => ({ confirmation: 'DELETE' as const, reauthentication: { type: 'password' as const, password: value } });
    await expect(auth.deleteAccount(`Bearer ${session.session}`, request(password.slice(0, 72)))).rejects.toBeInstanceOf(ReauthenticationError);
    expect(await database.findAccountByEmail(identity.email)).not.toBeNull();
    await auth.deleteAccount(`Bearer ${session.session}`, request(password));
    expect(await database.findAccountByEmail(identity.email)).toBeNull();
  });

  it('fails closed for legacy and malformed hashes without changing rows or blocking linked Google sign-in', async () => {
    const database = new MemoryAccountDatabase();
    let identity: VerifiedGoogleIdentity;
    const auth = new AuthService(database, config, { verify: async () => identity });
    const password = 'a'.repeat(72) + 'original-suffix';
    const session = await auth.register({ name: 'Sailor', email: 'legacy@example.test', password });
    const account = database.accounts.get('legacy@example.test')!;
    const legacy = await bcrypt.hash(password, 4);
    account.passwordHash = legacy;
    for (const candidate of [password, 'a'.repeat(72), 'a'.repeat(72) + 'other-suffix']) {
      await expect(auth.login({ email: account.email, password: candidate })).rejects.toMatchObject({ statusCode: 401, message: 'Email or password is incorrect.' });
    }
    const challenge = await auth.createGoogleChallenge();
    identity = { subject: 'legacy-google', email: account.email, name: account.name, nonce: challenge.nonce };
    await expect(auth.loginWithGoogle({ credential: 'credential', challengeId: challenge.challengeId, linkExisting: { confirmed: true, password } })).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.deleteAccount(`Bearer ${session.session}`, { confirmation: 'DELETE', reauthentication: { type: 'password', password } })).rejects.toBeInstanceOf(ReauthenticationError);
    expect(account.passwordHash).toBe(legacy);
    database.googleIdentities.set(identity.subject, account.id);
    await expect(auth.loginWithGoogle({ credential: 'credential', challengeId: challenge.challengeId })).resolves.toMatchObject({ kind: 'session' });
    account.passwordHash = 'scrypt$v=1$N=999999999,r=8,p=5$bad$bad';
    await expect(auth.login({ email: account.email, password })).rejects.toMatchObject({ statusCode: 401, message: 'Email or password is incorrect.' });
    await expect(auth.deleteAccount(`Bearer ${session.session}`, { confirmation: 'DELETE', reauthentication: { type: 'password', password } })).rejects.toBeInstanceOf(ReauthenticationError);
    expect(database.accounts.has(account.email)).toBe(true);
  });

  it('confirms a lost deletion response only for the initiating session', async () => {
    const database = new MemoryAccountDatabase();
    const auth = new AuthService(database, config);
    const first = await auth.register({ name: 'Sailor', email: 'receipt@example.test', password: 'synthetic-password' });
    const other = await auth.login({ email: 'receipt@example.test', password: 'synthetic-password' });
    const request = { confirmation: 'DELETE' as const, reauthentication: { type: 'password' as const, password: 'synthetic-password' } };
    await auth.deleteAccount(`Bearer ${first.session}`, request);
    await expect(auth.deleteAccount(`Bearer ${first.session}`, request)).resolves.toBeUndefined();
    await expect(auth.deleteAccount(`Bearer ${other.session}`, request)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.authenticate(`Bearer ${first.session}`)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.logout(`Bearer ${first.session}`)).resolves.toBeUndefined();
    await expect(auth.logout(`Bearer ${first.session}`)).resolves.toBeUndefined();
    await expect(auth.deleteAccount(`Bearer ${first.session}`, request)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.deleteAccount(undefined, request)).rejects.toBeInstanceOf(UnauthorizedError);
    const claims = jwt.decode(first.session) as jwt.JwtPayload;
    const expired = jwt.sign({ exp: Math.floor(Date.now() / 1000) - 1 }, config.jwtSecret!, {
      subject: first.accountId, jwtid: claims.jti, issuer: config.jwtIssuer, audience: config.jwtAudience,
    });
    await expect(auth.deleteAccount(`Bearer ${expired}`, request)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.logout(`Bearer ${expired}`)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('binds receipt revocation to both signed account and session claims', async () => {
    const database = new MemoryAccountDatabase();
    const auth = new AuthService(database, config);
    const first = await auth.register({ name: 'A', email: 'a@example.test', password: 'synthetic-password' });
    const second = await auth.register({ name: 'B', email: 'b@example.test', password: 'synthetic-password' });
    const claims = jwt.decode(first.session) as jwt.JwtPayload;
    const mismatched = jwt.sign({ exp: claims.exp }, config.jwtSecret!, {
      subject: second.accountId, jwtid: claims.jti, issuer: config.jwtIssuer, audience: config.jwtAudience,
    });
    const request = { confirmation: 'DELETE' as const, reauthentication: { type: 'password' as const, password: 'synthetic-password' } };
    const receipt = { confirmation: 'DELETE' as const, receiptOnly: true as const };
    await auth.deleteAccount(`Bearer ${first.session}`, request);
    await expect(auth.deleteAccount(`Bearer ${mismatched}`, receipt)).rejects.toBeInstanceOf(UnauthorizedError);
    await auth.logout(`Bearer ${mismatched}`);
    await expect(auth.deleteAccount(`Bearer ${first.session}`, receipt)).resolves.toBeUndefined();
    await expect(auth.authenticate(`Bearer ${second.session}`)).resolves.toMatchObject({ id: second.accountId });
    const invalid = jwt.sign({ exp: claims.exp }, 'incorrect-secret', {
      subject: first.accountId, jwtid: claims.jti, issuer: config.jwtIssuer, audience: config.jwtAudience,
    });
    await expect(auth.logout(`Bearer ${invalid}`)).rejects.toBeInstanceOf(UnauthorizedError);
    const expired = jwt.sign({ exp: Math.floor(Date.now() / 1000) - 1 }, config.jwtSecret!, {
      subject: first.accountId, jwtid: claims.jti, issuer: config.jwtIssuer, audience: config.jwtAudience,
    });
    await expect(auth.logout(`Bearer ${expired}`)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.deleteAccount(`Bearer ${expired}`, receipt)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.deleteAccount(`Bearer ${first.session}`, receipt)).resolves.toBeUndefined();
  });

  it('revokes only the current session, accepts retries, and rejects legacy tokens', async () => {
    const database = new MemoryAccountDatabase();
    const auth = new AuthService(database, config);
    const first = await auth.register({ name: 'Sailor', email: 'session@example.test', password: 'synthetic-password' });
    const second = await auth.login({ email: 'session@example.test', password: 'synthetic-password' });
    const claims = jwt.decode(first.session) as jwt.JwtPayload;
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(claims.exp! - claims.iat!).toBe(1200);
    expect(jwt.decode(second.session)).not.toMatchObject({ jti: claims.jti });
    const legacy = jwt.sign({}, config.jwtSecret!, { subject: first.accountId, issuer: config.jwtIssuer, audience: config.jwtAudience, expiresIn: '20m' });
    const noExpiry = jwt.sign({}, config.jwtSecret!, { subject: first.accountId, jwtid: claims.jti, issuer: config.jwtIssuer, audience: config.jwtAudience });
    await expect(auth.authenticate(`Bearer ${legacy}`)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.logout(`Bearer ${legacy}`)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.authenticate(`Bearer ${noExpiry}`)).rejects.toBeInstanceOf(UnauthorizedError);
    await auth.logout(`Bearer ${first.session}`);
    await auth.logout(`Bearer ${first.session}`);
    await expect(auth.authenticate(`Bearer ${first.session}`)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.deleteAccount(`Bearer ${first.session}`, { confirmation: 'DELETE', reauthentication: { type: 'password', password: 'synthetic-password' } })).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(auth.authenticate(`Bearer ${second.session}`)).resolves.toMatchObject({ id: second.accountId });
    vi.spyOn(database, 'revokeSession').mockRejectedValue(new Error('sensitive backend detail'));
    await expect(auth.logout(`Bearer ${second.session}`)).rejects.toMatchObject({ statusCode: 503, message: 'Session store is unavailable.' });
  });
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

  it('shares an evaluation quota across instances, separates accounts, and stores only scoped hashes', async () => {
    const database = new MemoryAccountDatabase();
    const counters = new Map<string, number>();
    const consume = vi.spyOn(database, 'consumeIdentifierLimit').mockImplementation(async (key, limit) => {
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return { allowed: count <= limit, retryAfter: 120 };
    });
    const instances = [new AuthService(database, config), new AuthService(database, config)];
    for (let attempt = 0; attempt < 30; attempt++) await instances[attempt % 2].consumeEvaluationLimit('synthetic-account-a');
    await expect(instances[1].consumeEvaluationLimit('synthetic-account-a')).rejects.toMatchObject({ statusCode: 429, retryAfter: 120 });
    await instances[0].consumeEvaluationLimit('synthetic-account-b');
    expect(consume.mock.calls[0]).toEqual([expect.stringMatching(/^[a-f0-9]{64}$/), 30, 3600]);
    expect(consume.mock.calls[31][0]).not.toBe(consume.mock.calls[0][0]);
    expect(JSON.stringify(consume.mock.calls)).not.toContain('synthetic-account');
    expect(JSON.stringify(consume.mock.calls)).not.toContain(config.rateLimitSecret);
    await expect(new AuthService(database, { ...config, rateLimitSecret: undefined }).consumeEvaluationLimit('synthetic-account-a')).rejects.toMatchObject({ statusCode: 503 });
    consume.mockRejectedValueOnce(new Error('private database detail'));
    const failure = await instances[0].consumeEvaluationLimit('synthetic-account-a').catch((error: unknown) => error);
    expect(failure).toMatchObject({ statusCode: 503, message: 'Rate limiting is unavailable.' });
    expect(JSON.stringify(failure)).not.toContain('private database detail');
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

  it('rejects a session for an already-deleted account before consuming quota', async () => {
    const database = new MemoryAccountDatabase();
    const auth = new AuthService(database, config);
    const session = await auth.register({ name: 'Sailor', email: 'synthetic@example.test', password: 'synthetic-password' });
    database.accounts.clear();
    const consume = vi.spyOn(database, 'consumeIdentifierLimit').mockResolvedValue({ allowed: false, retryAfter: 42 });
    await expect(auth.deleteAccount(`Bearer ${session.session}`, { confirmation: 'DELETE', reauthentication: { type: 'password', password: 'synthetic-password' } })).rejects.toBeInstanceOf(UnauthorizedError);
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
  it('requires the current account password and does not revive deleted sessions', async () => {
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
  it('rejects deleted sessions and sanitizes session store failures', async () => {
    const database = new MemoryAccountDatabase();
    const auth = new AuthService(database, config);
    const session = await auth.register({ name: 'Sailor', email: 'sailor@example.test', password: 'a-strong-password' });
    database.accounts.clear();
    await expect(auth.authenticate(`Bearer ${session.session}`)).rejects.toBeInstanceOf(UnauthorizedError);
    database.findAccountById = async () => { throw new Error('database unavailable'); };
    await expect(auth.authenticate(`Bearer ${session.session}`)).rejects.toMatchObject({ statusCode: 503, message: 'Session store is unavailable.' });
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
