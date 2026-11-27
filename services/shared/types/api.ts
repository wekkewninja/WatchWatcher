import type { EvaluationResult, PublicAccount, StoredProgress } from './entities';

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'UNAUTHORIZED'
  | 'REAUTHENTICATION_FAILED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

export interface SessionResponse {
  accountId: string;
  session: string;
  user: PublicAccount;
}

export interface DeleteAccountRequest {
  confirmation: 'DELETE';
  reauthentication:
    | { type: 'password'; password: string }
    | { type: 'google'; credential: string; challengeId: string };
}

export interface ProgressResponse extends StoredProgress {}

export interface ProgressSyncResponse {
  syncedAt: string;
  revision: number;
}

export interface EvaluationResponse extends EvaluationResult {}
