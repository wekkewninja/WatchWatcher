import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ColregsRule, ProgressSnapshot } from '../domain-types';
import { StudentMemoryService } from '../core/student-memory.service';
import { ColregsReferenceService } from '../core/services/colregs-reference.service';
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

describe('ExaminerPage catalog activity', () => {
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
    await TestBed.configureTestingModule({
      imports: [ExaminerPage],
      providers: [
        provideRouter([]),
        { provide: ColregsReferenceService, useValue: { search: async () => [rule('rule-5', 'Rule 5', 'Look-out'), rule('rule-19', 'Rule 19', 'Restricted visibility')] } },
        { provide: StudentMemoryService, useValue: {
          loadAndMergeCloudProgress: async () => progress,
          loadProgress: async () => progress,
          recordRuleExerciseAttempt: async () => progress,
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
});