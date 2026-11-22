export interface Account {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface PublicAccount {
  id: string;
  name: string;
  email: string;
}

export interface ProgressSnapshot {
  topicMastery: Record<string, number>;
  weakSpotLog: Array<{ topicId: string; tag: string; timestamp: string }>;
  drillQueue: string[];
}

export interface StoredProgress extends ProgressSnapshot {
  accountId: string;
  revision: number;
  syncedAt: string | null;
}

export interface EvaluationRequest {
  topicId: string;
  context: string;
  answer: string;
}

export interface EvaluationResult {
  score: number;
  feedback: string;
  misconceptionTag: string | null;
  followUpDrill: string;
  source: 'online' | 'offline';
}
