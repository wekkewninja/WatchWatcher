import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import type { ColregsRule } from '../domain-types';
import { ColregsReferenceService } from '../core/services/colregs-reference.service';
import { StudentMemoryService } from '../core/student-memory.service';
import { ColregsRulePage } from './colregs-rule.page';

const practiceRule: ColregsRule = {
  id: 'rule-1',
  ruleNumber: 'Rule 1',
  title: 'Application',
  category: 'General',
  summary: 'Identify the applicable rule set and local provisions.',
  officialText: {
    sourceUrl: 'https://www.navcen.uscg.gov/navigation-rules-amalgamated#rule1',
    sourceUpdatedOn: '2026-11-16',
    checkedOn: '2026-11-22',
    international: ['(a) International wording.'],
    inland: ['(a) U.S. Inland wording.'],
  },
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

const recordAttempt = vi.fn(async () => ({ topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] }));

describe('ColregsRulePage practice exercise', () => {
  beforeEach(async () => {
    recordAttempt.mockClear();
    await TestBed.configureTestingModule({
      imports: [ColregsRulePage],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ ruleId: 'rule-1' })) } },
        { provide: ColregsReferenceService, useValue: { search: async () => [practiceRule] } },
        { provide: StudentMemoryService, useValue: {
          loadProgress: async () => ({ topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] }),
          recordRuleExerciseAttempt: recordAttempt,
        } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows remediation for an incorrect choice and prevents immediate resubmission', async () => {
    const fixture = TestBed.createComponent(ColregsRulePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.textContent).toContain(practiceRule.exercise.prompt);
    expect(host.querySelectorAll('.rule-key-points li')).toHaveLength(2);

    const checkButton = host.querySelector('.rule-practice-card button') as HTMLButtonElement;
    const incorrectOption = host.querySelector('input[value="a"]') as HTMLInputElement;
    incorrectOption.click();
    fixture.detectChanges();
    checkButton.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(host.querySelector('.exercise-feedback')?.textContent).toContain('Correct answer: Check the applicable Rules and valid local requirements.');
    expect(host.querySelector('.exercise-feedback')?.textContent).toContain(practiceRule.exercise.remediation);
    expect(recordAttempt).toHaveBeenNthCalledWith(1, 'rule-1', 'a', 'b');

    const correctOption = host.querySelector('input[value="b"]') as HTMLInputElement;
    expect(correctOption.disabled).toBe(true);
    correctOption.click();
    fixture.detectChanges();
    expect(incorrectOption.checked).toBe(true);
    expect(correctOption.checked).toBe(false);
    expect(checkButton.disabled).toBe(true);
    checkButton.click();
    await fixture.whenStable();
    expect(recordAttempt).toHaveBeenCalledOnce();
  });

  it('shows success feedback for a correct first answer', async () => {
    const fixture = TestBed.createComponent(ColregsRulePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const correctOption = host.querySelector('input[value="b"]') as HTMLInputElement;
    correctOption.click();
    fixture.detectChanges();
    (host.querySelector('.rule-practice-card button') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(host.querySelector('.exercise-feedback')?.classList.contains('correct')).toBe(true);
    expect(host.querySelector('.exercise-feedback')?.textContent).toContain(practiceRule.exercise.explanation);
    expect(recordAttempt).toHaveBeenCalledWith('rule-1', 'b', 'b');
  });

  it('keeps official wording collapsed and switches between International and Inland variants', async () => {
    const fixture = TestBed.createComponent(ColregsRulePage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    const details = host.querySelector('.official-wording') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(host.querySelector('.official-paragraphs')?.textContent).toContain('(a) International wording.');
    expect(host.querySelector('.official-paragraphs')?.textContent).not.toContain('U.S. Inland wording.');
    expect(host.querySelector('.official-source a')?.getAttribute('href')).toBe(practiceRule.officialText?.sourceUrl);

    const inlandButton = host.querySelectorAll('.official-mode-control button')[1] as HTMLButtonElement;
    inlandButton.click();
    fixture.detectChanges();

    expect(inlandButton.getAttribute('aria-pressed')).toBe('true');
    expect(host.querySelector('.official-paragraphs')?.textContent).toContain('(a) U.S. Inland wording.');
    expect(host.querySelector('.official-source')?.textContent).toContain('U.S. Inland Rules');
  });

  it('shows a useful fallback when the requested rule is missing', async () => {
    const reference = TestBed.inject(ColregsReferenceService);
    vi.spyOn(reference, 'search').mockResolvedValueOnce([]);
    const fixture = TestBed.createComponent(ColregsRulePage);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.error()).toBe('This rule was not found in the bundled reference.');
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('uses fallback feedback for non-Error reference failures', async () => {
    const reference = TestBed.inject(ColregsReferenceService);
    vi.spyOn(reference, 'search').mockRejectedValueOnce('offline');
    const fixture = TestBed.createComponent(ColregsRulePage);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(fixture.componentInstance.error()).toBe('Try again from the reference list.');
    expect(fixture.componentInstance.loading()).toBe(false);
  });

  it('returns no official paragraphs when a rule has no official text', async () => {
    const fixture = TestBed.createComponent(ColregsRulePage);
    fixture.detectChanges();
    await fixture.whenStable();
    const ruleWithoutOfficialText = { ...practiceRule };
    delete ruleWithoutOfficialText.officialText;

    expect(fixture.componentInstance.officialParagraphs(ruleWithoutOfficialText)).toEqual([]);
  });
});