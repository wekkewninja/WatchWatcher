import { describe, expect, it } from 'vitest';
import type { PublicAccount, ProgressSnapshot, StoredProgress } from '../../shared/types/entities';
import type { AppConfig } from '../src/services/config';
import { AuthService } from '../src/services/authService';
import { ConflictError, UnauthorizedError } from '../src/errors/errorTypes';
import type { IDatabaseService } from '../src/services/interfaces/IDatabaseService';

type StoredAccount = PublicAccount & { passwordHash: string };

class MemoryAccountDatabase implements IDatabaseService {
  readonly accounts = new Map<string, StoredAccount>();
  async createAccount(input: { id: string; name: string; email: string; passwordHash: string }): Promise<PublicAccount> {
    if ([...this.accounts.values()].some((account) => account.email === input.email.toLowerCase())) throw new ConflictError('Duplicate account');
    const account = { id: input.id, name: input.name, email: input.email.toLowerCase(), passwordHash: input.passwordHash };
    this.accounts.set(account.email, account);
    return { id: account.id, name: account.name, email: account.email };
  }
  async findAccountByEmail(email: string): Promise<StoredAccount | null> { return this.accounts.get(email.toLowerCase()) ?? null; }
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
});
