import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ColregsRule, ProgressSnapshot } from '../domain-types';
import { StudentMemoryService } from '../core/student-memory.service';
import { AuthStateService } from '../core/auth-state.service';
import { ColregsReferenceService } from '../core/services/colregs-reference.service';
import { AssessmentQuestionBankService } from '../core/services/assessment-question-bank.service';
import { ExaminerAiService } from '../core/services/examiner-ai.service';
import type { AssessmentBank, AssessmentQuestion } from '../core/services/assessment-question-bank';
import { ExaminerPage } from './examiner.page';

const rule = (id: string, ruleNumber: string, title: string): ColregsRule => ({
  id,
  ruleNumber,
  title,
  category: 'Steering and Sailing',
  summary: `${title} summary.`,
  keyPoints: ['Identify the applicable rule.', 'Choose a safe action.'],
  exercise: {
    prompt: `${ruleNumber}: choose the safe response.`,
    options: [{ id: 'a', text: 'Unsafe response.' }, { id: 'b', text: 'Safe response.' }],
    answer: 'b',
    explanation: 'The safe response follows the rule.',
    remediation: 'Review the rule and vessel situation.',
  },
  keywords: [],
});

const practiceQuestion: AssessmentQuestion = {
  id: 'rule-5:key-point:1', type: 'choice', sectionId: 'rule-5', sectionTitle: 'Rule 5 · Look-out', sourceRef: 'Rule 5',
  coverageIds: ['colregs:rule-5:key-point:1'], priority: 'critical', priorityRationale: 'Collision-avoidance knowledge.',
  prompt: 'What does Rule 5 require?', options: [{ id: 'a', text: 'Ignore traffic.' }, { id: 'b', text: 'Keep a proper lookout.' }], answer: 'b',
  explanation: 'Maintain an effective lookout.', remediation: 'Review Rule 5.',
};

const bank: AssessmentBank = {
  objectives: [{ id: 'colregs:rule-5:key-point:1', label: 'Rule 5 lookout', sectionId: 'rule-5', priority: 'critical', sourceRef: 'Rule 5' }],
  questions: [practiceQuestion],
};

describe('ExaminerPage catalog activity', () => {
  const recordObjectivePracticeAttempt = vi.fn();
  const auth = { user: signal<{ id: string } | null>(null), cloudAuth: signal('signed-out'), accountGeneration: 1 };
  beforeEach(async () => {
    const progress: ProgressSnapshot = {
      topicMastery: {},
      weakSpotLog: [],
      drillQueue: [],
      ruleExerciseAttempts: [{
        id: '32f63760-6b39-4f06-935e-430251d1b785',
        ruleId: 'rule-19',
        selectedOptionId: 'b',
        correct: true,
        attemptedAt: '2026-11-22T12:00:00.000Z',
      }],
    };
    recordObjectivePracticeAttempt.mockReset().mockResolvedValue(undefined);
    auth.user.set(null);
    auth.cloudAuth.set('signed-out');
    await TestBed.configureTestingModule({
      imports: [ExaminerPage],
      providers: [
        provideRouter([]),
        { provide: ColregsReferenceService, useValue: { search: async () => [rule('rule-5', 'Rule 5', 'Look-out'), rule('rule-19', 'Rule 19', 'Restricted visibility')] } },
        { provide: AssessmentQuestionBankService, useValue: { loadBank: async () => bank } },
        { provide: ExaminerAiService, useValue: { evaluateFreeText: vi.fn() } },
        { provide: AuthStateService, useValue: auth },
        { provide: StudentMemoryService, useValue: {
          loadAndMergeCloudProgress: async () => progress,
          loadProgress: async () => progress,
          recordRuleExerciseAttempt: async () => progress,
          recordObjectivePracticeAttempt,
        } },
      ],
    }).compileComponents();
  });

  afterEach(() => TestBed.resetTestingModule());

  it('starts on catalog activity selected from progress instead of a fixed Rule 19 demo', async () => {
    const fixture = TestBed.createComponent(ExaminerPage);
    fixture.detectChanges();
    await fixture.componentInstance.load();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.exam-workspace-heading h2')?.textContent).toContain('Rule 5 · Look-out');
    expect(host.textContent).toContain('1 / 2 completed');
    expect(host.textContent).not.toContain('Resume Rule 19');
    expect(host.textContent).not.toContain('Target on port bow · 315° relative');
  });

  it('records mapped objective practice and offers failed questions in a delayed retry round', async () => {
    const fixture = TestBed.createComponent(ExaminerPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    const page = fixture.componentInstance;

    expect(page.practiceSections()).toEqual([{ id: 'rule-5', title: 'Rule 5 · Look-out', questionCount: 1 }]);
    expect(page.currentPracticeQuestion()?.id).toBe(practiceQuestion.id);
    page.selectPracticeOption('a');
    await page.checkPracticeAnswer();
    expect(page.practiceChecked()?.correct).toBe(false);
    expect(recordObjectivePracticeAttempt).toHaveBeenLastCalledWith({ questionId: practiceQuestion.id, topicId: 'rule-5', objectiveIds: practiceQuestion.coverageIds, correct: false });

    page.advancePracticeQuestion();
    expect(page.practiceReviewAvailable()).toBe(true);
    expect(page.currentPracticeQuestion()).toBeNull();
    page.startPracticeReview();
    page.selectPracticeOption('b');
    await page.checkPracticeAnswer();
    page.advancePracticeQuestion();

    expect(page.practiceComplete()).toBe(true);
    expect(page.currentPracticeQuestion()).toBeNull();
    expect(recordObjectivePracticeAttempt).toHaveBeenCalledTimes(2);
    expect(recordObjectivePracticeAttempt.mock.calls.map(([attempt]) => attempt.correct)).toEqual([false, true]);
    fixture.destroy();
  });
});