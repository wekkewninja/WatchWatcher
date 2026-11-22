import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import type { ColregsRule, ProgressSnapshot, StudySnapshot } from '../domain-types';
import { StudentMemoryService } from '../core/student-memory.service';
import { StudyDeskPage } from './study-desk.page';

const rules: ColregsRule[] = [
  { id: 'rule-5', ruleNumber: 'Rule 5', title: 'Look-out', category: 'Steering and Sailing', summary: 'Keep a proper lookout.', keyPoints: ['Look', 'Appraise'], exercise: { prompt: 'What is the lookout duty?', options: [{ id: 'a', text: 'Ignore traffic.' }, { id: 'b', text: 'Keep a proper lookout.' }], answer: 'b', explanation: 'A proper lookout is required.', remediation: 'Review Rule 5.' }, keywords: [] },
  { id: 'rule-19', ruleNumber: 'Rule 19', title: 'Restricted visibility', category: 'Restricted Visibility', summary: 'Proceed safely in fog.', keyPoints: ['Safe speed', 'Caution'], exercise: { prompt: 'What applies in fog?', options: [{ id: 'a', text: 'Speed up.' }, { id: 'b', text: 'Proceed at safe speed.' }], answer: 'b', explanation: 'Use safe speed.', remediation: 'Review Rule 19.' }, keywords: [] },
];

describe('StudyDeskPage personalized activity', () => {
  beforeEach(async () => {
    const snapshot: StudySnapshot = { topics: [], averageMastery: 0, atThreshold: 0, weakSpots: 0 };
    const progress: ProgressSnapshot = {
      topicMastery: {},
      weakSpotLog: [],
      drillQueue: [],
      ruleExerciseAttempts: [{ id: '32f63760-6b39-4f06-935e-430251d1b785', ruleId: 'rule-19', selectedOptionId: 'b', correct: true, attemptedAt: '2026-11-22T12:00:00.000Z' }],
    };
    vi.spyOn(api, 'getStudySnapshot').mockResolvedValue(snapshot);
    vi.spyOn(api, 'searchColregs').mockResolvedValue(rules);
    await TestBed.configureTestingModule({
      imports: [StudyDeskPage],
      providers: [
        provideRouter([]),
        { provide: StudentMemoryService, useValue: { loadAndMergeCloudProgress: async () => progress, syncProgress: async () => ({ syncedAt: '2026-11-22T12:00:00.000Z', revision: 1 }) } },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('resumes the next unfinished rule rather than presenting a fixed Rule 19 demo', async () => {
    const fixture = TestBed.createComponent(StudyDeskPage);
    fixture.detectChanges();
    await fixture.componentInstance.load();
    fixture.detectChanges();

    const hero = fixture.nativeElement.querySelector('.hero-panel') as HTMLElement;
    expect(hero.querySelector('h1')?.textContent).toContain('Rule 5 · Look-out');
    expect(hero.textContent).toContain('1 of 2 practice entries completed');
    expect(hero.textContent).toContain('Start exercise');
    expect(hero.textContent).not.toContain('Resume Rule 19');
  });
});