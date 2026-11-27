import { createHash } from 'node:crypto';

export function deletionReceiptHash(accountId: string, sessionId: string): string {
  return createHash('sha256').update(accountId).update('\0').update(sessionId).digest('hex');
}