import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { StudentMemoryService } from '../core/student-memory.service';
import { AuthStateService } from '../core/auth-state.service';
import { ExaminerAiService } from '../core/services/examiner-ai.service';
import { AssessmentQuestionBankService } from '../core/services/assessment-question-bank.service';
import type { AssessmentCoverageObjective, ShortAnswerAssessmentQuestion } from '../core/services/assessment-question-bank';
import { LearningDetailPage } from './learning-detail.page';
import { SyllabusPage } from './syllabus.page';

const curriculum = {
  modules: [{
    id: 'navigation',
    title: 'Navigation',
    pass_threshold: 0.8,
    topics: [{
      id: 'compass',
      title: 'Compass',
      rule_ref: 'Chartwork',
      summary: 'Apply variation and deviation.',
      asa_note: 'Check the applicable chart.',
      questions: [{ id: 'question-1', prompt: 'What is deviation?', expected_keywords: ['compass'], forbidden_keywords: [], correct_explanation: 'Deviation is vessel-specific.', deep_remediation: 'Review the deviation card.' }],
    }],
  }],
};

const practiceQuestion: ShortAnswerAssessmentQuestion = {
  id: 'question-1', type: 'short-answer', sectionId: 'compass', sectionTitle: 'Navigation · Compass', sourceRef: 'Chartwork',
  coverageIds: ['curriculum:compass:question-1'], priority: 'major', priorityRationale: 'Core syllabus knowledge.',
  prompt: 'What is deviation?', expectedKeywords: ['compass'], forbiddenKeywords: [], modelAnswer: 'Deviation is vessel-specific.',
  explanation: 'Deviation is vessel-specific.', remediation: 'Review the deviation card.',
};

const learningAuth = { user: signal<{ id: string } | null>({ id: 'student-a' }), cloudAuth: signal('authenticated'), accountGeneration: 1 };

function learningProviders(
  questions: ShortAnswerAssessmentQuestion[] = [practiceQuestion],
  recordObjectivePracticeAttempt = vi.fn().mockResolvedValue(undefined),
  evaluateFreeText = vi.fn().mockResolvedValue({ passed: true, feedback: 'Correct.', score: 1, source: 'online', criticalFailure: false, criticalFailureReason: null }),
) {
  return [
    { provide: AssessmentQuestionBankService, useValue: { loadBank: vi.fn(async () => ({ questions, objectives: [] })) } },
    { provide: StudentMemoryService, useValue: { recordObjectivePracticeAttempt } },
    { provide: ExaminerAiService, useValue: { evaluateFreeText } },
    { provide: AuthStateService, useValue: learningAuth },
  ];
}

const syllabusObjectives: AssessmentCoverageObjective[] = [
  ...(['critical', 'major', 'minor'] as const).map((priority) => ({ id: `compass-${priority}`, label: priority, sectionId: 'compass', priority, sourceRef: 'compass' })),
  ...Array.from({ length: 5 }, (_value, index) => ({ id: `vectors-major-${index}`, label: `Vectors ${index}`, sectionId: 'vectors', priority: 'major' as const, sourceRef: 'vectors' })),
];

function syllabusBank(objectives: AssessmentCoverageObjective[] = syllabusObjectives) {
  return { loadBank: async () => ({ questions: [], objectives }) } as unknown as AssessmentQuestionBankService;
}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LearningDetailPage', () => {
  it('loads a module, navigates to a topic, and reveals an answer only after recording a correct response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(curriculum), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const params = new BehaviorSubject(convertToParamMap({ contentId: 'navigation' }));
    const recordAttempt = vi.fn().mockResolvedValue(undefined);
    const evaluateAnswer = vi.fn().mockResolvedValue({ passed: true, feedback: 'Correct.', score: 1, source: 'online', criticalFailure: false, criticalFailureReason: null });
    await TestBed.configureTestingModule({
      imports: [LearningDetailPage],
      providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { paramMap: params } }, ...learningProviders([practiceQuestion], recordAttempt, evaluateAnswer)],
    }).compileComponents();
    const fixture = TestBed.createComponent(LearningDetailPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('h1')?.textContent).toContain('Navigation');
    expect(host.textContent).toContain('Compass');

    params.next(convertToParamMap({ contentId: 'compass' }));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.querySelector('h1')?.textContent).toContain('Compass');
    expect(host.textContent).toContain('What is deviation?');
    expect(host.textContent).not.toContain('Deviation is vessel-specific.');
    const answer = host.querySelector('textarea') as HTMLTextAreaElement;
    answer.value = 'The compass deviation is vessel-specific.';
    answer.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (host.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    fixture.detectChanges();
    (Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Check answer')) as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.textContent).toContain('Deviation is vessel-specific.');
    expect(evaluateAnswer).toHaveBeenCalledWith(expect.objectContaining({ topicId: 'compass', answer: answer.value, onlineConsent: true }));
    expect(recordAttempt).toHaveBeenCalledWith({ questionId: 'question-1', topicId: 'compass', objectiveIds: ['curriculum:compass:question-1'], correct: true });
    expect(fixture.componentInstance.parentModule()?.id).toBe('navigation');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('defers missed questions to later review rounds and stores retries as separate evidence', async () => {
    const secondQuestion: ShortAnswerAssessmentQuestion = {
      ...practiceQuestion, id: 'question-2', prompt: 'What should be checked on the chart?', expectedKeywords: ['variation'],
      coverageIds: ['curriculum:compass:question-2'], modelAnswer: 'Check the chart variation.', explanation: 'Use the charted variation.',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(curriculum), { status: 200 })));
    const recordAttempt = vi.fn().mockResolvedValue(undefined);
    const evaluateAnswer = vi.fn().mockImplementation(({ answer }: { answer: string }) => Promise.resolve({ passed: answer !== 'incorrect answer', feedback: answer === 'incorrect answer' ? 'Review the model.' : 'Correct.', score: answer === 'incorrect answer' ? 0.2 : 1, source: 'online', criticalFailure: false, criticalFailureReason: null }));
    await TestBed.configureTestingModule({
      imports: [LearningDetailPage],
      providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ contentId: 'compass' })) } }, ...learningProviders([practiceQuestion, secondQuestion], recordAttempt, evaluateAnswer)],
    }).compileComponents();
    const fixture = TestBed.createComponent(LearningDetailPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    const page = fixture.componentInstance;

    page.setAnswer({ target: { value: 'incorrect answer' } } as unknown as Event);
    page.setConsent({ target: { checked: true } } as unknown as Event);
    await page.checkAnswer();
    expect(page.checked()?.correct).toBe(false);
    page.advancePractice();
    expect(page.currentPracticeQuestion()?.id).toBe('question-2');
    page.setAnswer({ target: { value: 'variation checked' } } as unknown as Event);
    page.setConsent({ target: { checked: true } } as unknown as Event);
    await page.checkAnswer();
    page.advancePractice();
    expect(page.reviewAvailable()).toBe(true);
    expect(page.currentPracticeQuestion()).toBeNull();
    page.startReviewRound();
    expect(page.currentPracticeQuestion()?.id).toBe('question-1');
    page.setAnswer({ target: { value: 'compass' } } as unknown as Event);
    page.setConsent({ target: { checked: true } } as unknown as Event);
    await page.checkAnswer();
    page.advancePractice();

    expect(page.practiceComplete()).toBe(true);
    expect(page.currentPracticeQuestion()).toBeNull();
    expect(recordAttempt).toHaveBeenCalledTimes(3);
    expect(recordAttempt.mock.calls.map(([attempt]) => attempt.correct)).toEqual([false, true, true]);
    fixture.destroy();
  });

  it('lets an offline learner skip without grading or recording evidence', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(curriculum), { status: 200 })));
    const recordAttempt = vi.fn().mockResolvedValue(undefined);
    const evaluateAnswer = vi.fn();
    learningAuth.user.set(null);
    learningAuth.cloudAuth.set('signed-out');
    await TestBed.configureTestingModule({
      imports: [LearningDetailPage],
      providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ contentId: 'compass' })) } }, ...learningProviders([practiceQuestion], recordAttempt, evaluateAnswer)],
    }).compileComponents();
    const fixture = TestBed.createComponent(LearningDetailPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    const page = fixture.componentInstance;
    page.setAnswer({ target: { value: 'some answer' } } as unknown as Event);
    page.skipAnswer();
    page.advancePractice();

    expect(page.practiceComplete()).toBe(true);
    expect(evaluateAnswer).not.toHaveBeenCalled();
    expect(recordAttempt).not.toHaveBeenCalled();
    learningAuth.user.set({ id: 'student-a' });
    learningAuth.cloudAuth.set('authenticated');
    fixture.destroy();
  });

  it('displays a clear error for a missing topic', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(curriculum), { status: 200 })));
    await TestBed.configureTestingModule({
      imports: [LearningDetailPage],
      providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ contentId: 'missing' })) } }, ...learningProviders()],
    }).compileComponents();
    const fixture = TestBed.createComponent(LearningDetailPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('This topic could not be found in the bundled syllabus.');
  });

  it('reports an unavailable curriculum asset', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    await TestBed.configureTestingModule({
      imports: [LearningDetailPage],
      providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ contentId: 'navigation' })) } }, ...learningProviders()],
    }).compileComponents();
    const fixture = TestBed.createComponent(LearningDetailPage);
    fixture.detectChanges();
    await vi.waitFor(() => expect(fixture.componentInstance.loading()).toBe(false));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Bundled syllabus could not be loaded.');
  });
});

describe('SyllabusPage', () => {
  it('calculates module mastery and filters weak spots to known topics', async () => {
    vi.spyOn(api, 'getModules').mockResolvedValue([{
      id: 'navigation', title: 'Navigation', mastery: 0, completed: 0, topicCount: 2, passThreshold: 80,
      topics: ['Compass', 'Vectors'], topicIds: ['compass', 'vectors'],
    }]);
    const memory = {
      loadAndMergeCloudProgress: vi.fn().mockResolvedValue({
        topicMastery: { compass: 100, vectors: 60 },
        weakSpotLog: [{ topicId: 'compass', tag: 'review', timestamp: '2026-01-01T00:00:00Z' }, { topicId: 'unknown', tag: 'other', timestamp: '2026-01-01T00:00:00Z' }],
        drillQueue: [], ruleExerciseAttempts: [],
        objectivePracticeAttempts: [
          { id: 'a1', questionId: 'c1', topicId: 'compass', objectiveIds: ['compass-critical', 'compass-major', 'compass-minor'], correct: true, attemptedAt: '2026-01-01T00:00:00Z' },
          { id: 'a2', questionId: 'v1', topicId: 'vectors', objectiveIds: ['vectors-major-0', 'vectors-major-1', 'vectors-major-2'], correct: true, attemptedAt: '2026-01-01T00:01:00Z' },
        ],
      }),
    } as unknown as StudentMemoryService;
    const page = new SyllabusPage(memory, syllabusBank());
    await page.load();
    expect(page.modules()).toEqual([expect.objectContaining({ mastery: 80, completed: 1 })]);
    expect(page.topicTitles()).toEqual({ compass: 'Compass', vectors: 'Vectors' });
    expect(page.weakSpots()).toHaveLength(1);
    expect(page.loading()).toBe(false);
  });

  it('handles empty modules and load failures', async () => {
    const getModules = vi.spyOn(api, 'getModules').mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Offline content unavailable'));
    const memory = { loadAndMergeCloudProgress: vi.fn().mockResolvedValue({ topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] }) } as unknown as StudentMemoryService;
    const page = new SyllabusPage(memory, syllabusBank([]));
    await page.load();
    expect(page.modules()).toEqual([]);
    await page.load();
    expect(page.error()).toBe('Offline content unavailable');
    expect(page.loading()).toBe(false);
    expect(getModules).toHaveBeenCalledTimes(2);
  });

  it('assigns zero mastery to modules without topics and falls back for non-Error failures', async () => {
    vi.spyOn(api, 'getModules').mockResolvedValueOnce([
      { id: 'empty', title: 'Empty', mastery: 90, completed: 2, topicCount: 0, passThreshold: 80, topics: [], topicIds: [] },
    ]).mockRejectedValueOnce('offline');
    const memory = { loadAndMergeCloudProgress: vi.fn().mockResolvedValue({ topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] }) } as unknown as StudentMemoryService;
    const page = new SyllabusPage(memory, syllabusBank([]));

    await page.load();
    expect(page.modules()).toEqual([expect.objectContaining({ mastery: 0, completed: 0 })]);
    expect(page.weakSpots()).toEqual([]);

    await page.load();
    expect(page.error()).toBe('Try again in a moment.');
    expect(page.loading()).toBe(false);
  });
});