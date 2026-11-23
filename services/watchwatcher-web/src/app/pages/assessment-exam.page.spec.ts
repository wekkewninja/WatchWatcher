import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  beforeEach(async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    await TestBed.configureTestingModule({
      imports: [AssessmentExamPage],
      providers: [
        provideRouter([]),
        { provide: AssessmentQuestionBankService, useValue: { loadBank: async () => bank } },
      ],
    }).compileComponents();
  });

  afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); });

  it('includes Critical questions and checks both choice and curriculum answers', async () => {
    const fixture = TestBed.createComponent(AssessmentExamPage);
    fixture.detectChanges();
    await fixture.whenStable();
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
    expect(host.querySelector('.exam-feedback')?.textContent).toContain('Correct');

    const nextButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Next')) as HTMLButtonElement;
    nextButton.click();
    fixture.detectChanges();
    expect(host.querySelector('textarea')).toBeTruthy();

    const response = host.querySelector('textarea') as HTMLTextAreaElement;
    response.value = 'Draft and clearance must be considered.';
    response.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    const checkButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Check answer')) as HTMLButtonElement;
    checkButton.click();
    fixture.detectChanges();
    expect(host.querySelector('.exam-feedback')?.textContent).toContain('Correct');

    const finishButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Finish exam')) as HTMLButtonElement;
    finishButton.click();
    fixture.detectChanges();
    expect(host.textContent).toContain('Exam complete');
    expect(host.textContent).toContain('2 of 2 answered questions correct');
  });
});