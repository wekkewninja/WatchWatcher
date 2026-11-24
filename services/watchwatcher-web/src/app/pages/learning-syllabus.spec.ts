import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../api';
import { StudentMemoryService } from '../core/student-memory.service';
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

afterEach(() => {
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('LearningDetailPage', () => {
  it('loads a module, navigates to its topic, and shows its question and answer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(curriculum), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const params = new BehaviorSubject(convertToParamMap({ contentId: 'navigation' }));
    await TestBed.configureTestingModule({
      imports: [LearningDetailPage],
      providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { paramMap: params } }],
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
    expect(host.textContent).toContain('Deviation is vessel-specific.');
    expect(fixture.componentInstance.parentModule()?.id).toBe('navigation');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fixture.destroy();
  });

  it('displays a clear error for a missing topic', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(curriculum), { status: 200 })));
    await TestBed.configureTestingModule({
      imports: [LearningDetailPage],
      providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ contentId: 'missing' })) } }],
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
      providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { paramMap: new BehaviorSubject(convertToParamMap({ contentId: 'navigation' })) } }],
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
      }),
    } as unknown as StudentMemoryService;
    const page = new SyllabusPage(memory);
    await page.load();
    expect(page.modules()).toEqual([expect.objectContaining({ mastery: 80, completed: 1 })]);
    expect(page.topicTitles()).toEqual({ compass: 'Compass', vectors: 'Vectors' });
    expect(page.weakSpots()).toHaveLength(1);
    expect(page.loading()).toBe(false);
  });

  it('handles empty modules and load failures', async () => {
    const getModules = vi.spyOn(api, 'getModules').mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('Offline content unavailable'));
    const memory = { loadAndMergeCloudProgress: vi.fn().mockResolvedValue({ topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] }) } as unknown as StudentMemoryService;
    const page = new SyllabusPage(memory);
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
    const page = new SyllabusPage(memory);

    await page.load();
    expect(page.modules()).toEqual([expect.objectContaining({ mastery: 0, completed: 0 })]);
    expect(page.weakSpots()).toEqual([]);

    await page.load();
    expect(page.error()).toBe('Try again in a moment.');
    expect(page.loading()).toBe(false);
  });
});