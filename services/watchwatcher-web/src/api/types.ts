import type {
  EvaluationRequest,
  ProgressSnapshot,
  PublicAccount,
} from '@watchwatcher/shared/types';
import type { ColregsRule, EvaluationResult, StudyModule, StudySnapshot } from '../app/domain-types';

export interface AccountInput {
  name: string;
  email: string;
  password: string;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface GoogleAuthChallenge {
  challengeId: string;
  nonce: string;
  expiresAt: string;
}

export interface GoogleSignInInput {
  credential: string;
  challengeId: string;
  linkExisting?: { confirmed: true; password: string };
}

export type GoogleSignInResult =
  | { kind: 'authenticated'; user: PublicAccount }
  | { kind: 'link-required' };

export interface ApiClient {
  getCurrentUser(): Promise<PublicAccount>;
  createAccount(input: AccountInput): Promise<PublicAccount>;
  login(credentials: Credentials): Promise<PublicAccount>;
  getGoogleClientId(): Promise<string>;
  createGoogleChallenge(): Promise<GoogleAuthChallenge>;
  googleSignIn(input: GoogleSignInInput): Promise<GoogleSignInResult>;
  logout(): Promise<void>;
  getStudySnapshot(): Promise<StudySnapshot>;
  getModules(): Promise<StudyModule[]>;
  searchColregs(query: string): Promise<ColregsRule[]>;
  getProgress(): Promise<ProgressSnapshot>;
  syncProgress(snapshot: ProgressSnapshot, revision?: number): Promise<{ syncedAt: string; revision: number }>;
  evaluateAnswer(input: EvaluationRequest): Promise<EvaluationResult>;
}
