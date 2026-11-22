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

export interface ApiClient {
  getCurrentUser(): Promise<PublicAccount>;
  createAccount(input: AccountInput): Promise<PublicAccount>;
  login(credentials: Credentials): Promise<PublicAccount>;
  logout(): Promise<void>;
  getStudySnapshot(): Promise<StudySnapshot>;
  getModules(): Promise<StudyModule[]>;
  searchColregs(query: string): Promise<ColregsRule[]>;
  getProgress(): Promise<ProgressSnapshot>;
  syncProgress(snapshot: ProgressSnapshot, revision?: number): Promise<{ syncedAt: string; revision: number }>;
  evaluateAnswer(input: EvaluationRequest): Promise<EvaluationResult>;
}
