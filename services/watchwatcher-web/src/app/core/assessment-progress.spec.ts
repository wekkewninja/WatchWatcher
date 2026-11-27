import { describe, expect, it } from 'vitest';
import { emptyProgressSnapshot } from './student-memory.service';
import { deriveAssessmentProgress } from './assessment-progress';
import type { AssessmentCoverageObjective } from './services/assessment-question-bank';

function objectives(priority: 'critical' | 'major' | 'minor', sectionId: string, count: number): AssessmentCoverageObjective[] {
  return Array.from({ length: count }, (_value, index) => ({
    id: `${sectionId}-${priority}-${index}`,
    label: `${priority} objective ${index}`,
    sectionId,
    priority,
    sourceRef: sectionId,
  }));
}

describe('deriveAssessmentProgress', () => {
  it('weights unique objectives by priority instead of question count', () => {
    const bank = [...objectives('critical', 'critical-topic', 1), ...objectives('major', 'major-topic', 3), ...objectives('minor', 'minor-topic', 5)];
    const progress = {
      ...emptyProgressSnapshot(),
      objectivePracticeAttempts: [
        { id: 'attempt-1', questionId: 'q-1', topicId: 'critical-topic', objectiveIds: ['critical-topic-critical-0', 'critical-topic-critical-0'], correct: true, attemptedAt: '2026-11-27T00:00:00.000Z' },
        { id: 'attempt-2', questionId: 'q-2', topicId: 'critical-topic', objectiveIds: ['critical-topic-critical-0'], correct: true, attemptedAt: '2026-11-27T00:01:00.000Z' },
      ],
    };

    const result = deriveAssessmentProgress(bank, progress);

    expect(result.priorityCoverage).toEqual({
      critical: { correct: 1, total: 1, percentage: 100 },
      major: { correct: 0, total: 3, percentage: 0 },
      minor: { correct: 0, total: 5, percentage: 0 },
    });
    expect(result.courseProgress).toBe(70);
    expect(result.topicPracticeMastery['critical-topic']).toBe(100);
  });

  it('combines exact tier ratios before rounding the displayed course score', () => {
    const bank = [...objectives('critical', 'critical', 3), ...objectives('major', 'major', 3), ...objectives('minor', 'minor', 3)];
    const evidence = ['critical-critical-0', 'critical-critical-1', 'major-major-0'].map((objectiveId, index) => ({
      id: `attempt-${index}`, questionId: `question-${index}`, topicId: objectiveId.split('-')[0], objectiveIds: [objectiveId], correct: true, attemptedAt: `2026-11-27T00:0${index}:00.000Z`,
    }));
    const result = deriveAssessmentProgress(bank, { ...emptyProgressSnapshot(), objectivePracticeAttempts: evidence });

    expect(result.courseProgress).toBe(53);
  });

  it('credits correct objectives from passed exams only and never changes practice mastery', () => {
    const bank = [...objectives('critical', 'topic-a', 1), ...objectives('major', 'topic-b', 1), ...objectives('minor', 'topic-c', 1)];
    const progress = {
      ...emptyProgressSnapshot(),
      examSessions: [{
        id: 'exam-1', startedAt: '2026-11-27T00:00:00.000Z', completedAt: '2026-11-27T00:05:00.000Z',
        questionResults: [
          { questionId: 'q-c', topicId: 'topic-a', objectiveIds: ['topic-a-critical-0'], priority: 'critical' as const, submittedAnswer: 'a', correct: true },
          { questionId: 'q-m', topicId: 'topic-b', objectiveIds: ['topic-b-major-0'], priority: 'major' as const, submittedAnswer: 'b', correct: false },
        ],
        score: 85, passed: true, criticalGatePassed: true,
      }],
    };

    const result = deriveAssessmentProgress(bank, progress);

    expect(result.priorityCoverage.critical.correct).toBe(1);
    expect(result.priorityCoverage.major.correct).toBe(0);
    expect(result.topicPracticeMastery['topic-a']).toBe(0);
    expect(result.latestExamByTopic['topic-a']).toEqual({ state: 'passed', testedObjectives: 1, totalObjectives: 1 });
    expect(result.latestExamByTopic['topic-b']?.state).toBe('failed');
  });

  it('does not credit any objective from a failed exam, even when an answer was correct', () => {
    const bank = [...objectives('critical', 'topic-a', 1), ...objectives('major', 'topic-b', 1), ...objectives('minor', 'topic-c', 1)];
    const result = deriveAssessmentProgress(bank, {
      ...emptyProgressSnapshot(),
      examSessions: [{
        id: 'failed-exam', startedAt: '2026-11-27T00:00:00.000Z', completedAt: '2026-11-27T00:05:00.000Z',
        questionResults: [
          { questionId: 'q-c', topicId: 'topic-a', objectiveIds: ['topic-a-critical-0'], priority: 'critical', submittedAnswer: 'a', correct: true },
          { questionId: 'q-m', topicId: 'topic-b', objectiveIds: ['topic-b-major-0'], priority: 'major', submittedAnswer: 'b', correct: true },
          { questionId: 'q-n', topicId: 'topic-c', objectiveIds: ['topic-c-minor-0'], priority: 'minor', submittedAnswer: 'c', correct: false },
        ],
        score: 66.67, passed: false, criticalGatePassed: true,
      }],
    });

    expect(result.priorityCoverage.critical.correct).toBe(0);
    expect(result.priorityCoverage.major.correct).toBe(0);
    expect(result.priorityCoverage.minor.correct).toBe(0);
  });

  it('maps legacy rule attempts only to their known scenario objective', () => {
    const bank: AssessmentCoverageObjective[] = [
      { id: 'colregs:rule-5:scenario', label: 'Rule 5 scenario', sectionId: 'rule-5', priority: 'critical', sourceRef: 'Rule 5' },
      { id: 'colregs:rule-5:key-point:1', label: 'Rule 5 lookout point', sectionId: 'rule-5', priority: 'critical', sourceRef: 'Rule 5' },
      ...objectives('major', 'topic-major', 1),
      ...objectives('minor', 'topic-minor', 1),
    ];
    const progress = {
      ...emptyProgressSnapshot(),
      ruleExerciseAttempts: [{ id: 'legacy-attempt', ruleId: 'rule-5', selectedOptionId: 'b', correct: true, attemptedAt: '2026-11-27T00:00:00.000Z' }],
    };

    const result = deriveAssessmentProgress(bank, progress);

    expect(result.priorityCoverage.critical.correct).toBe(1);
    expect(result.topicPracticeMastery['rule-5']).toBe(50);
  });

  it('requires at least 75% progress and every Critical practice objective for readiness', () => {
    const bank = [...objectives('critical', 'critical-topic', 7), ...objectives('major', 'major-topic', 1), ...objectives('minor', 'minor-topic', 1)];
    const practice = (objectiveIds: string[]) => ({ ...emptyProgressSnapshot(), objectivePracticeAttempts: objectiveIds.map((objectiveId, index) => ({ id: `attempt-${index}`, questionId: `q-${index}`, topicId: objectiveId.split('-').slice(0, 2).join('-'), objectiveIds: [objectiveId], correct: true, attemptedAt: `2026-11-27T00:0${index}:00.000Z` })) });
    const oneCriticalMissing = deriveAssessmentProgress(bank, practice([
      'critical-topic-critical-0', 'critical-topic-critical-1', 'critical-topic-critical-2', 'critical-topic-critical-3', 'critical-topic-critical-4', 'critical-topic-critical-5',
      'major-topic-major-0', 'minor-topic-minor-0',
    ]));
    const allCritical = deriveAssessmentProgress(bank, practice([
      'critical-topic-critical-0', 'critical-topic-critical-1', 'critical-topic-critical-2', 'critical-topic-critical-3', 'critical-topic-critical-4', 'critical-topic-critical-5', 'critical-topic-critical-6',
      'major-topic-major-0', 'minor-topic-minor-0',
    ]));

    expect(oneCriticalMissing.courseProgress).toBe(90);
    expect(oneCriticalMissing.readyForExam).toBe(false);
    expect(allCritical.courseProgress).toBe(100);
    expect(allCritical.readyForExam).toBe(true);
  });

  it('marks a course score unavailable when a priority tier has no objectives', () => {
    const result = deriveAssessmentProgress([...objectives('critical', 'topic-a', 1), ...objectives('major', 'topic-b', 1)], emptyProgressSnapshot());

    expect(result.priorityCoverage.minor).toEqual({ correct: 0, total: 0, percentage: null });
    expect(result.topicPracticeMastery['topic-b']).toBe(0);
    expect(result.courseProgress).toBeNull();
    expect(result.readyForExam).toBe(false);
  });
});