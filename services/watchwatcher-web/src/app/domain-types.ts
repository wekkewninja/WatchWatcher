import type {
  EvaluationRequest as SharedEvaluationRequest,
  EvaluationResult as SharedEvaluationResult,
  ProgressSnapshot as SharedProgressSnapshot,
  RuleExerciseAttempt as SharedRuleExerciseAttempt,
  PublicAccount,
} from '@watchwatcher/shared/types';

export type Learner = PublicAccount;
export type ProgressSnapshot = SharedProgressSnapshot;
export type RuleExerciseAttempt = SharedRuleExerciseAttempt;
export type EvaluationRequest = SharedEvaluationRequest;
export type EvaluationResult = SharedEvaluationResult & { passed: boolean };

export interface StudyTopic {
  id: string;
  contentId?: string;
  moduleId: string;
  moduleTitle: string;
  title: string;
  summary: string;
  mastery: number;
  passThreshold: number;
  state: 'remediation' | 'ready' | 'retry';
}

export interface StudyModule {
  id: string;
  title: string;
  mastery: number;
  completed: number;
  topicCount: number;
  passThreshold: number;
  topics: string[];
  topicIds: string[];
}

export interface ColregsRule {
  id: string;
  ruleNumber: string;
  title: string;
  category: string;
  summary: string;
  officialText?: {
    sourceUrl: string;
    sourceUpdatedOn: string;
    checkedOn: string;
    international: string[];
    inland?: string[];
  };
  memoryHook?: string;
  asaInlandNote?: string;
  keyPoints: string[];
  exercise: ColregsExercise;
  keywords: string[];
}

export interface ColregsExerciseOption {
  id: string;
  text: string;
}

export interface ColregsExercise {
  prompt: string;
  options: ColregsExerciseOption[];
  answer: string;
  explanation: string;
  remediation: string;
}

export interface StudySnapshot {
  topics: StudyTopic[];
  averageMastery: number;
  atThreshold: number;
  weakSpots: number;
}
