import type { ExamSession, ProgressSnapshot } from '../domain-types';
import type { AssessmentCoverageObjective, AssessmentPriority } from './services/assessment-question-bank';

export interface PriorityCoverage {
  correct: number;
  total: number;
  percentage: number | null;
}

export interface TopicExamState {
  state: 'untested' | 'passed' | 'failed';
  testedObjectives: number;
  totalObjectives: number;
}

export interface AssessmentProgress {
  courseProgress: number | null;
  priorityCoverage: Record<AssessmentPriority, PriorityCoverage>;
  practiceCriticalComplete: boolean;
  readyForExam: boolean;
  topicPracticeMastery: Record<string, number>;
  topicObjectiveTotals: Record<string, number>;
  latestExam: ExamSession | null;
  latestExamByTopic: Record<string, TopicExamState>;
}

const priorities: AssessmentPriority[] = ['critical', 'major', 'minor'];

function uniqueIds(ids: string[]): Set<string> {
  return new Set(ids);
}

export function deriveAssessmentProgress(objectives: AssessmentCoverageObjective[], progress: ProgressSnapshot): AssessmentProgress {
  const knownObjectiveIds = new Set(objectives.map((objective) => objective.id));
  const practiceCorrect = uniqueIds([
    ...(progress.objectivePracticeAttempts ?? []).filter((attempt) => attempt.correct).flatMap((attempt) => attempt.objectiveIds),
    ...(progress.ruleExerciseAttempts ?? []).filter((attempt) => attempt.correct)
      .map((attempt) => `colregs:${attempt.ruleId}:scenario`)
      .filter((objectiveId) => knownObjectiveIds.has(objectiveId)),
  ]);
  const completedExams = (progress.examSessions ?? []).filter((session) => !progress.examHistoryDeletedAt || Date.parse(session.completedAt) > Date.parse(progress.examHistoryDeletedAt));
  const examCorrect = uniqueIds(completedExams
    .filter((session) => session.passed && session.criticalGatePassed)
    .flatMap((session) => session.questionResults
      .filter((result) => result.correct === true)
      .flatMap((result) => result.objectiveIds)));
  const credited = new Set([...practiceCorrect, ...examCorrect]);
  const priorityCoverage = Object.fromEntries(priorities.map((priority) => {
    const tier = objectives.filter((objective) => objective.priority === priority);
    const correct = tier.filter((objective) => credited.has(objective.id)).length;
    return [priority, { correct, total: tier.length, percentage: tier.length ? Math.round((correct / tier.length) * 100) : null }];
  })) as Record<AssessmentPriority, PriorityCoverage>;
  const courseProgress = priorities.every((priority) => priorityCoverage[priority].percentage !== null)
    ? Math.round(100 * (0.7 * priorityCoverage.critical.correct / priorityCoverage.critical.total
      + 0.2 * priorityCoverage.major.correct / priorityCoverage.major.total
      + 0.1 * priorityCoverage.minor.correct / priorityCoverage.minor.total))
    : null;

  const topicObjectives = new Map<string, AssessmentCoverageObjective[]>();
  for (const objective of objectives) {
    const topic = topicObjectives.get(objective.sectionId) ?? [];
    topic.push(objective);
    topicObjectives.set(objective.sectionId, topic);
  }
  const topicPracticeMastery = Object.fromEntries([...topicObjectives].map(([topicId, topic]) => [
    topicId,
    Math.round((topic.filter((objective) => practiceCorrect.has(objective.id)).length / topic.length) * 100),
  ]));
  const topicObjectiveTotals = Object.fromEntries([...topicObjectives].map(([topicId, topic]) => [topicId, topic.length]));

  const criticalObjectives = objectives.filter((objective) => objective.priority === 'critical');
  const practiceCriticalComplete = criticalObjectives.length > 0 && criticalObjectives.every((objective) => practiceCorrect.has(objective.id));
  const latestExam = [...completedExams].sort((first, second) => second.completedAt.localeCompare(first.completedAt) || second.id.localeCompare(first.id))[0] ?? null;
  const latestExamByTopic: Record<string, TopicExamState> = {};
  if (latestExam) {
    const resultsByTopic = new Map<string, ExamSession['questionResults']>();
    for (const result of latestExam.questionResults) {
      const results = resultsByTopic.get(result.topicId) ?? [];
      results.push(result);
      resultsByTopic.set(result.topicId, results);
    }
    for (const [topicId, results] of resultsByTopic) {
      const testedObjectives = new Set(results.flatMap((result) => result.objectiveIds)).size;
      latestExamByTopic[topicId] = {
        state: results.every((result) => result.correct === true) ? 'passed' : 'failed',
        testedObjectives,
        totalObjectives: topicObjectives.get(topicId)?.length ?? 0,
      };
    }
  }

  return {
    courseProgress,
    priorityCoverage,
    practiceCriticalComplete,
    readyForExam: courseProgress !== null && courseProgress >= 75 && practiceCriticalComplete,
    topicPracticeMastery,
    topicObjectiveTotals,
    latestExam,
    latestExamByTopic,
  };
}