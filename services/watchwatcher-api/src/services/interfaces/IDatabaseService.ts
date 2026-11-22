import type { PublicAccount, ProgressSnapshot, StoredProgress } from '../../../../shared/types/entities';

export interface IDatabaseService {
  createAccount(input: { id: string; name: string; email: string; passwordHash: string }): Promise<PublicAccount>;
  findAccountByEmail(email: string): Promise<{ id: string; name: string; email: string; passwordHash: string | null } | null>;
  findAccountByGoogleSubject(subject: string): Promise<PublicAccount | null>;
  createGoogleChallenge(input: { id: string; nonceHash: string; expiresAt: Date }): Promise<void>;
  isGoogleChallengeValid(id: string, nonceHash: string): Promise<boolean>;
  consumeGoogleChallenge(id: string, nonceHash: string): Promise<boolean>;
  createGoogleAccount(input: { id: string; name: string; email: string; subject: string; challengeId: string; nonceHash: string }): Promise<PublicAccount>;
  linkGoogleIdentity(input: { accountId: string; email: string; subject: string; challengeId: string; nonceHash: string }): Promise<void>;
  getProgress(accountId: string): Promise<StoredProgress | null>;
  saveProgress(accountId: string, snapshot: ProgressSnapshot, expectedRevision: number): Promise<{ syncedAt: string; revision: number }>;
  healthCheck(): Promise<boolean>;
}
