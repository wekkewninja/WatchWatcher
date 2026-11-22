import type { PublicAccount, ProgressSnapshot, StoredProgress } from '../../../../shared/types/entities';

export interface IDatabaseService {
  createAccount(input: { id: string; name: string; email: string; passwordHash: string }): Promise<PublicAccount>;
  findAccountByEmail(email: string): Promise<{ id: string; name: string; email: string; passwordHash: string } | null>;
  getProgress(accountId: string): Promise<StoredProgress | null>;
  saveProgress(accountId: string, snapshot: ProgressSnapshot, expectedRevision: number): Promise<{ syncedAt: string; revision: number }>;
  healthCheck(): Promise<boolean>;
}
