import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { of } from 'rxjs';
import type { ColregsRule } from '../domain-types';
import { ColregsReferenceService } from '../core/services/colregs-reference.service';
import { ColregsRulePage } from './colregs-rule.page';

const practiceRule: ColregsRule = {
  id: 'rule-1',
  ruleNumber: 'Rule 1',
  title: 'Application',
  category: 'General',
  summary: 'Identify the applicable rule set and local provisions.',
  memoryHook: 'Check the waterway first.',
  asaInlandNote: 'Local rules may apply.',
  keyPoints: ['Identify the applicable waters.', 'Check valid local provisions.'],
  exercise: {
    prompt: 'A harbor publishes local requirements. What should you check?',
    options: [
      { id: 'a', text: 'Ignore them after entering the harbor.' },
      { id: 'b', text: 'Check the applicable Rules and valid local requirements.' },
    ],
    answer: 'b',
    explanation: 'Rule 1 establishes scope and recognizes valid local special rules.',
    remediation: 'Start with location and jurisdiction.',
  },
  keywords: ['application', 'waters'],
};

describe('ColregsRulePage practice exercise', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ColregsRulePage],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ ruleId: 'rule-1' })) } },
        { provide: ColregsReferenceService, useValue: { search: async () => [practiceRule] } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows remediation for an incorrect choice and success feedback for the correct choice', async () => {
    const fixture = TestBed.createComponent(ColregsRulePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain(practiceRule.exercise.prompt);
    expect(host.querySelectorAll('.rule-key-points li')).toHaveLength(2);

    const checkButton = host.querySelector('button') as HTMLButtonElement;
    const incorrectOption = host.querySelector('input[value="a"]') as HTMLInputElement;
    incorrectOption.click();
    fixture.detectChanges();
    checkButton.click();
    fixture.detectChanges();
    expect(host.querySelector('.exercise-feedback')?.textContent).toContain('Correct answer: Check the applicable Rules and valid local requirements.');
    expect(host.querySelector('.exercise-feedback')?.textContent).toContain(practiceRule.exercise.remediation);

    const correctOption = host.querySelector('input[value="b"]') as HTMLInputElement;
    correctOption.click();
    fixture.detectChanges();
    checkButton.click();
    fixture.detectChanges();
    expect(host.querySelector('.exercise-feedback')?.classList.contains('correct')).toBe(true);
    expect(host.querySelector('.exercise-feedback')?.textContent).toContain(practiceRule.exercise.explanation);
  });
});