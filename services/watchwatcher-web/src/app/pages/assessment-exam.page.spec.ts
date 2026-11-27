import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStateService } from '../core/auth-state.service';
import { emptyProgressSnapshot } from '../core/student-memory.service';
import type { ExamSession } from '../domain-types';
import { StudentMemoryService } from '../core/student-memory.service';
import { ExaminerAiService } from '../core/services/examiner-ai.service';
import type { AssessmentBank, AssessmentQuestion } from '../core/services/assessment-question-bank';
import { AssessmentQuestionBankService } from '../core/services/assessment-question-bank.service';
import { AssessmentExamPage } from './assessment-exam.page';

const criticalQuestion: AssessmentQuestion = {
  id: 'critical-lookout',
  type: 'choice',
  sectionId: 'rule-5',
  sectionTitle: 'COLREGs · Rule 5',
  sourceRef: 'Rule 5',
  coverageIds: ['rule-5-lookout'],
  priority: 'critical',
  priorityRationale: 'Immediate collision-avoidance knowledge.',
  prompt: 'What is required?',
  options: [{ id: 'a', text: 'Keep a proper lookout.' }, { id: 'b', text: 'Ignore traffic.' }],
  answer: 'a',
  explanation: 'Maintain an effective lookout.',
  remediation: 'Review Rule 5.',
};

const curriculumQuestion: AssessmentQuestion = {
  id: 'curriculum-tide-answer',
  type: 'short-answer',
  sectionId: 'tides_heights_clearance',
  sectionTitle: 'Tides · Heights',
  sourceRef: 'Tidal calculations',
  coverageIds: ['tides-clearance'],
  priority: 'major',
  priorityRationale: 'Core Yachtmaster application.',
  prompt: 'What components determine required tide height?',
  expectedKeywords: ['draft', 'clearance'],
  forbiddenKeywords: ['ignore depth'],
  modelAnswer: 'Add charted depth or drying height, draft, and required clearance.',
  explanation: 'Depth, draft, and UKC determine safe clearance.',
  remediation: 'Revisit the clearance calculation.',
};

const bank: AssessmentBank = {
  objectives: [],
  questions: [criticalQuestion, curriculumQuestion],
};

describe('AssessmentExamPage', () => {
  const auth = { user: signal<{ id: string } | null>({ id: 'account-a' }), cloudAuth: signal('authenticated'), accountGeneration: 1 };
  const evaluate = vi.fn();
  const memory = {
    loadProgress: vi.fn(),
    recordExamSession: vi.fn(),
    deleteExamHistory: vi.fn(),
  };
  beforeEach(async () => {
    auth.user.set({ id: 'account-a' });
    auth.cloudAuth.set('authenticated');
    auth.accountGeneration = 1;
    evaluate.mockReset().mockResolvedValue({ passed: true, source: 'online', feedback: 'Correct.' });
    memory.loadProgress.mockReset().mockResolvedValue(null);
    memory.recordExamSession.mockReset().mockImplementation(async (session: ExamSession) => ({ ...emptyProgressSnapshot(), examSessions: [session] }));
    memory.deleteExamHistory.mockReset().mockResolvedValue(emptyProgressSnapshot());
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    await TestBed.configureTestingModule({
      imports: [AssessmentExamPage],
      providers: [
        provideRouter([]),
        { provide: AssessmentQuestionBankService, useValue: { loadBank: async () => bank } },
        { provide: AuthStateService, useValue: auth },
        { provide: ExaminerAiService, useValue: { evaluateFreeText: evaluate } },
        { provide: StudentMemoryService, useValue: memory },
      ],
    }).compileComponents();
  });

  afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });

  it('keeps checked answers private until completion, then saves and displays the exam result', async () => {
    const fixture = TestBed.createComponent(AssessmentExamPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Critical');
    expect(host.textContent).toContain('Exam composition');
    expect(host.textContent).toContain('1 Critical questions are guaranteed');
    expect(host.textContent).toContain('1 additional Major/Minor questions');
    const startButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Start exam')) as HTMLButtonElement;
    startButton.click();
    fixture.detectChanges();
    expect(host.textContent).toContain('Question 1 of 2');
    expect(host.textContent).toContain(criticalQuestion.prompt);

    const correctOption = host.querySelector('input[type="radio"][value="a"]') as HTMLInputElement;
    correctOption.click();
    fixture.detectChanges();
    (Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Check answer')) as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.querySelector('.exam-feedback')).toBeNull();
    expect(correctOption.disabled).toBe(true);
    fixture.componentInstance.setResponse('b');
    expect(fixture.componentInstance.response()).toBe('a');

    const nextButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Next')) as HTMLButtonElement;
    nextButton.click();
    fixture.detectChanges();
    expect(host.querySelector('textarea')).toBeTruthy();

    const response = host.querySelector('textarea') as HTMLTextAreaElement;
    response.value = 'Draft and clearance must be considered.';
    response.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const checkButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Check answer')) as HTMLButtonElement;
    expect(checkButton.disabled).toBe(true);
    expect(host.textContent).toContain('topic, question, reference, model answer, explanation, and your answer to Google Gemini');
    const consent = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(consent.checked).toBe(false);
    consent.click();
    fixture.detectChanges();
    checkButton.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({ topicId: curriculumQuestion.sectionId, answer: response.value, onlineConsent: true }));
    expect(host.querySelector('.exam-feedback')).toBeNull();

    const finishButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Finish exam')) as HTMLButtonElement;
    finishButton.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.textContent).toContain('Exam complete');
    expect(host.textContent).toContain('Exam score: 100%');
    expect(host.textContent).toContain('Passed');
    expect(memory.recordExamSession).toHaveBeenCalledWith(expect.objectContaining({ score: 100, passed: true, criticalGatePassed: true }));
  });

  it('offers ungraded offline continuation without contacting the evaluator', async () => {
    const fixture = TestBed.createComponent(AssessmentExamPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    const page = fixture.componentInstance;
    page.beginExam();
    page.currentIndex.set(1);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('a[href="/examiner"]')).toBeTruthy();
    await page.checkAnswer();
    page.skipAnswer();
    fixture.detectChanges();
    expect(evaluate).not.toHaveBeenCalled();
    expect(page.currentResult()?.correct).toBeNull();
    expect(page.scorePercent()).toBe(0);
    expect(page.examPassed()).toBe(false);
  });

  it('fails the Critical gate even when the percentage score reaches 85%', async () => {
    const fixture = TestBed.createComponent(AssessmentExamPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    const page = fixture.componentInstance;
    const secondCritical = { ...criticalQuestion, id: 'critical-second', coverageIds: ['critical-second-objective'], prompt: 'Second Critical question?' };
    const supplemental = Array.from({ length: 5 }, (_value, index) => ({ ...criticalQuestion, id: `major-${index}`, coverageIds: [`major-${index}-objective`], priority: 'major' as const }));
    const questions = [criticalQuestion, secondCritical, ...supplemental];
    page.questions.set(questions);
    page.results.set(Object.fromEntries(questions.map((question, index) => [question.id, index !== 1])));
    page.currentIndex.set(questions.length - 1);

    expect(page.scorePercent()).toBeGreaterThanOrEqual(85);
    expect(page.criticalGatePassed()).toBe(false);
    await page.finishExam();

    expect(page.completedSession()?.passed).toBe(false);
    expect(page.completedSession()?.criticalGatePassed).toBe(false);
  });

  it('reviews saved missed answers and confirms deletion of exam history', async () => {
    const saved: ExamSession = {
      id: '32f63760-6b39-4f06-935e-430251d1b785',
      startedAt: '2026-11-22T12:00:00.000Z',
      completedAt: '2026-11-22T12:05:00.000Z',
      questionResults: [{ questionId: criticalQuestion.id, topicId: criticalQuestion.sectionId, objectiveIds: criticalQuestion.coverageIds, priority: 'critical', submittedAnswer: 'b', correct: false }],
      score: 0,
      passed: false,
      criticalGatePassed: false,
    };
    memory.loadProgress.mockResolvedValue({ ...emptyProgressSnapshot(), examSessions: [saved] });
    const fixture = TestBed.createComponent(AssessmentExamPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain('Exam history');

    (Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Review result')) as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.textContent).toContain('Ignore traffic.');
    expect(host.textContent).toContain('Keep a proper lookout.');
    expect(host.textContent).toContain('Maintain an effective lookout.');

    (Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Delete history')) as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(host.textContent).toContain('Delete all saved exam sessions and submitted answers');
    (Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Delete saved exams')) as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(memory.deleteExamHistory).toHaveBeenCalledOnce();
    expect(fixture.componentInstance.savedSessions()).toEqual([]);
    expect(fixture.componentInstance.finished()).toBe(false);
  });

  it('invalidates consent and ignores late results after an account switch', async () => {
    const fixture = TestBed.createComponent(AssessmentExamPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    const page = fixture.componentInstance;
    page.beginExam();
    page.currentIndex.set(1);
    page.setResponse('Synthetic answer');
    fixture.detectChanges();
    const checkbox = (fixture.nativeElement as HTMLElement).querySelector('input[type="checkbox"]') as HTMLInputElement;
    checkbox.click();
    auth.accountGeneration++;
    auth.user.set({ id: 'account-b' });
    await page.checkAnswer();
    expect(evaluate).not.toHaveBeenCalled();
    fixture.detectChanges();
    checkbox.click();
    let finish!: (value: unknown) => void;
    evaluate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const pending = page.checkAnswer();
    auth.accountGeneration++;
    auth.user.set(null);
    auth.cloudAuth.set('signed-out');
    finish({ passed: true, feedback: 'Synthetic', source: 'online' });
    await pending;
    expect(page.currentResult()).toBeNull();
    expect(page.hasConsent()).toBe(false);
  });

  it('shows an error and requires fresh consent after an online failure', async () => {
    const fixture = TestBed.createComponent(AssessmentExamPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    const page = fixture.componentInstance;
    page.beginExam();
    page.currentIndex.set(1);
    page.setResponse('Synthetic answer');
    fixture.detectChanges();
    ((fixture.nativeElement as HTMLElement).querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    evaluate.mockRejectedValueOnce(new Error('unavailable'));
    await page.checkAnswer();
    fixture.detectChanges();
    expect(page.hasConsent()).toBe(false);
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain('unavailable');
    expect(page.currentResult()).toBeNull();
  });

  it('shows actionable oversize feedback and never invokes the evaluator', async () => {
    const fixture = TestBed.createComponent(AssessmentExamPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    const page = fixture.componentInstance;
    page.beginExam();
    page.currentIndex.set(1);
    page.setResponse('x'.repeat(12001));
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('12,000 characters');
    expect((Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Check answer')) as HTMLButtonElement).disabled).toBe(true);
    await page.checkAnswer();
    expect(evaluate).not.toHaveBeenCalled();
    page.setResponse('x'.repeat(12000));
    fixture.detectChanges();
    expect(host.textContent).not.toContain('Shorten your answer');
  });

  it('distinguishes invalid input from an unavailable provider', async () => {
    const fixture = TestBed.createComponent(AssessmentExamPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    const page = fixture.componentInstance;
    page.beginExam();
    page.currentIndex.set(1);
    page.setResponse('Synthetic answer');
    fixture.detectChanges();
    ((fixture.nativeElement as HTMLElement).querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    evaluate.mockRejectedValueOnce({ status: 422 });
    await page.checkAnswer();
    expect(page.evaluationError()).toContain('invalid');
    expect(page.evaluationError()).not.toContain('unavailable');
  });
});