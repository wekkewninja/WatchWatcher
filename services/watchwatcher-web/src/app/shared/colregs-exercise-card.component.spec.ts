import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColregsRule, ProgressSnapshot } from '../domain-types';
import { StudentMemoryService } from '../core/student-memory.service';
import { ColregsExerciseCardComponent } from './colregs-exercise-card.component';

const rule: ColregsRule = {
  id: 'rule-5',
  ruleNumber: 'Rule 5',
  title: 'Look-out',
  category: 'Steering and Sailing',
  summary: 'Keep a proper lookout.',
  keyPoints: ['Look and listen.'],
  exercise: {
    prompt: 'What is the duty?',
    options: [{ id: 'wrong', text: 'Ignore traffic.' }, { id: 'right', text: 'Keep a proper lookout.' }],
    answer: 'right',
    explanation: 'Maintain an effective lookout.',
    remediation: 'Review Rule 5.',
  },
  keywords: [],
};

const progress: ProgressSnapshot = {
  topicMastery: {},
  weakSpotLog: [],
  drillQueue: [],
  ruleExerciseAttempts: [{
    id: 'attempt-1', ruleId: 'rule-5', selectedOptionId: 'wrong', correct: false, attemptedAt: '2026-11-24T12:00:00.000Z',
  }],
};

afterEach(() => TestBed.resetTestingModule());

describe('ColregsExerciseCardComponent', () => {
  it('loads history, checks the selected answer, and emits saved progress', async () => {
    const memory = {
      loadProgress: vi.fn().mockResolvedValue(null),
      recordRuleExerciseAttempt: vi.fn().mockResolvedValue(progress),
    };
    await TestBed.configureTestingModule({
      imports: [ColregsExerciseCardComponent],
      providers: [{ provide: StudentMemoryService, useValue: memory }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ColregsExerciseCardComponent);
    const emitted = vi.fn();
    fixture.componentRef.setInput('rule', rule);
    fixture.componentInstance.progressChanged.subscribe(emitted);
    fixture.detectChanges();
    await vi.waitFor(() => expect(memory.loadProgress).toHaveBeenCalledOnce());
    expect(fixture.componentInstance.summary().attempts).toBe(0);
    expect(fixture.componentInstance.correctAnswer()).toBe('Keep a proper lookout.');

    await fixture.componentInstance.checkAnswer();
    expect(memory.recordRuleExerciseAttempt).not.toHaveBeenCalled();
    fixture.componentInstance.selectOption('wrong');
    await fixture.componentInstance.checkAnswer();

    expect(memory.recordRuleExerciseAttempt).toHaveBeenCalledWith('rule-5', 'wrong', 'right');
    expect(fixture.componentInstance.exerciseChecked()).toBe(true);
    expect(fixture.componentInstance.summary().attempts).toBe(1);
    expect(fixture.componentInstance.saving()).toBe(false);
    expect(emitted).toHaveBeenCalledWith(progress);
  });

  it('reports both typed and unexpected persistence failures after grading', async () => {
    const memory = {
      loadProgress: vi.fn().mockResolvedValue(progress),
      recordRuleExerciseAttempt: vi.fn()
        .mockRejectedValueOnce(new Error('Local database unavailable'))
        .mockRejectedValueOnce('storage failed'),
    };
    await TestBed.configureTestingModule({
      imports: [ColregsExerciseCardComponent],
      providers: [{ provide: StudentMemoryService, useValue: memory }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ColregsExerciseCardComponent);
    fixture.componentRef.setInput('rule', rule);
    fixture.detectChanges();
    await vi.waitFor(() => expect(memory.loadProgress).toHaveBeenCalledOnce());
    fixture.componentInstance.selectOption('right');

    await fixture.componentInstance.checkAnswer();
    expect(fixture.componentInstance.error()).toBe('Answer checked, but progress could not be saved: Local database unavailable');
    expect(fixture.componentInstance.exerciseChecked()).toBe(true);
    expect(fixture.componentInstance.saving()).toBe(false);

    await fixture.componentInstance.checkAnswer();
    expect(fixture.componentInstance.error()).toBe('Answer checked, but progress could not be saved.');
  });

  it('returns an empty answer label when a rule has no matching answer option', async () => {
    await TestBed.configureTestingModule({
      imports: [ColregsExerciseCardComponent],
      providers: [{ provide: StudentMemoryService, useValue: { loadProgress: vi.fn().mockResolvedValue(null) } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ColregsExerciseCardComponent);
    fixture.componentRef.setInput('rule', { ...rule, exercise: { ...rule.exercise, answer: 'missing' } });
    fixture.detectChanges();

    expect(fixture.componentInstance.correctAnswer()).toBe('');
  });
});