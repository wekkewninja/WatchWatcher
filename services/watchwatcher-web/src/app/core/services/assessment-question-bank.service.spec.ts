import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ColregsRule } from '../../domain-types';
import { ColregsReferenceService } from './colregs-reference.service';
import { AssessmentQuestionBankService } from './assessment-question-bank.service';
import catalogAsset from '../../../../public/assets/reference/colregs_catalog.json';
import curriculumAsset from '../../../../public/assets/syllabus/curriculum_seed.json';
import { buildAssessmentBank, gradeShortAnswer, selectExamQuestions, type CurriculumAssessmentAsset } from './assessment-question-bank';

const catalog = catalogAsset as {
  rules: Array<{
    rule_number: string;
    title: string;
    category: string;
    summary: string;
    memory_hook: string;
    asa_inland_note: string;
    key_points: string[];
    exercise: ColregsRule['exercise'];
  }>;
};

const rules = catalog.rules.map((entry) => ({
  id: entry.rule_number.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
  ruleNumber: entry.rule_number,
  title: entry.title,
  category: entry.category,
  summary: entry.summary,
  keyPoints: entry.key_points,
  exercise: entry.exercise,
  memoryHook: entry.memory_hook,
  asaInlandNote: entry.asa_inland_note,
  keywords: [],
}));

const curriculum = curriculumAsset as CurriculumAssessmentAsset;
const bank = buildAssessmentBank(rules, curriculum);
const questionsByCoverage = new Map<string, number>();
for (const question of bank.questions) {
  for (const coverageId of question.coverageIds) questionsByCoverage.set(coverageId, (questionsByCoverage.get(coverageId) ?? 0) + 1);
}

afterEach(() => vi.unstubAllGlobals());

describe('Assessment question bank', () => {
  it('covers every COLREGs key point, scenario exercise, and curriculum question', () => {
    expect(bank.questions.length).toBeGreaterThan(200);
    expect(bank.objectives.length).toBe(questionsByCoverage.size);
    expect(bank.objectives.every((objective) => (questionsByCoverage.get(objective.id) ?? 0) > 0)).toBe(true);
    expect(new Set(bank.questions.map((question) => question.id)).size).toBe(bank.questions.length);
    expect(new Set(bank.objectives.map((objective) => objective.id)).size).toBe(bank.objectives.length);

    const keyPointCount = rules.reduce((count, rule) => count + rule.keyPoints.length, 0);
    const curriculumQuestionCount = curriculum.modules.reduce((count, module) => count + module.topics.reduce((topicCount, topic) => topicCount + topic.questions.length, 0), 0);
    const curriculumTopicCount = curriculum.modules.reduce((count, module) => count + module.topics.length, 0);
    expect(bank.objectives.filter((objective) => objective.id.includes(':key-point:'))).toHaveLength(keyPointCount);
    expect(bank.objectives.filter((objective) => objective.id.startsWith('curriculum:'))).toHaveLength(curriculumQuestionCount + curriculumTopicCount * 2);
    for (const module of curriculum.modules) {
      for (const topic of module.topics) {
        expect(questionsByCoverage.has(`curriculum:${topic.id}:briefing`)).toBe(true);
        expect(questionsByCoverage.has(`curriculum:${topic.id}:regional-note`)).toBe(true);
      }
    }
  });

  it('covers light, shape, sound, restricted-visibility, and distress categories explicitly', () => {
    const requiredCoverage = [
      'colregs:type:lights-weather-and-day-shapes',
      'colregs:type:masthead-light',
      'colregs:type:sidelights',
      'colregs:type:sternlight',
      'colregs:type:all-round-light',
      'colregs:type:flashing-light',
      'colregs:type:power-driven-underway-lights',
      'colregs:type:sailing-vessel-underway-lights',
      'colregs:type:sailing-while-propelled-by-machinery',
      'colregs:type:vessel-under-oars',
      'colregs:type:fishing-trawling',
      'colregs:type:fishing-not-trawling',
      'colregs:type:not-under-command',
      'colregs:type:restricted-ability-to-maneuver',
      'colregs:type:dredging-safe-passage-side',
      'colregs:type:constrained-by-draft',
      'colregs:type:pilot-vessel',
      'colregs:type:tow-over-200m',
      'colregs:type:anchored-vessel',
      'colregs:type:vessel-aground',
      'colregs:type:seaplane-wig',
      'colregs:type:short-prolonged-blast-duration',
      'colregs:type:sound-signal-equipment',
      'colregs:type:maneuvering-blasts',
      'colregs:type:doubt-danger-signal',
      'colregs:type:international-inland-passing-signals',
      'colregs:type:fog-signal-making-way',
      'colregs:type:fog-signal-stopped',
      'colregs:type:fog-signal-other-vessels',
      'colregs:type:anchored-aground-fog-signals',
      'colregs:type:distress-signal-types',
      'colregs:type:attention-signal-safety',
    ];
    for (const coverageId of requiredCoverage) expect(questionsByCoverage.has(coverageId), coverageId).toBe(true);
  });

  it('classifies questions into all three importance levels with a rationale', () => {
    expect(new Set(bank.questions.map((question) => question.priority))).toEqual(new Set(['critical', 'major', 'minor']));
    expect(bank.questions.every((question) => question.priorityRationale.trim().length > 0)).toBe(true);
  });

  it('always includes every Critical question and samples five non-critical questions without replacement', () => {
    const criticalIds = bank.questions.filter((question) => question.priority === 'critical').map((question) => question.id);
    const exam = selectExamQuestions(bank.questions, () => 0, 5);
    const selectedIds = exam.map((question) => question.id);

    expect(new Set(exam.filter((question) => question.priority === 'critical').map((question) => question.id))).toEqual(new Set(criticalIds));
    expect(exam.filter((question) => question.priority !== 'critical')).toHaveLength(5);
    expect(new Set(selectedIds).size).toBe(selectedIds.length);
    expect(selectExamQuestions(bank.questions, () => 0, 5).map((question) => question.id)).toEqual(selectedIds);
    expect(selectExamQuestions(bank.questions, () => 0.9, 5).map((question) => question.id)).not.toEqual(selectedIds);
  });

  it('includes the full non-critical pool when fewer than the requested supplement remain', () => {
    const smallPool = bank.questions.slice(0, 3).map((question, index) => ({ ...question, priority: index ? 'minor' as const : 'critical' as const }));
    const selected = selectExamQuestions(smallPool, () => 0, 10);
    expect(selected).toHaveLength(smallPool.length);
    expect(selected.some((question) => question.priority === 'critical')).toBe(true);
  });

  it('clamps out-of-range random values when sampling and shuffling exam questions', () => {
    const smallPool = bank.questions.slice(0, 3).map((question, index) => ({ ...question, priority: index ? 'minor' as const : 'critical' as const }));

    expect(selectExamQuestions(smallPool, () => -1, 1)).toHaveLength(2);
    expect(selectExamQuestions(smallPool, () => 1, 1)).toHaveLength(2);
  });

  it('self-checks curriculum short answers using expected and forbidden keywords', () => {
    const shortAnswer = bank.questions.find((question) => question.type === 'short-answer');
    expect(shortAnswer?.type).toBe('short-answer');
    if (shortAnswer?.type !== 'short-answer') throw new Error('Expected a curriculum short-answer question.');
    expect(gradeShortAnswer(shortAnswer, `${shortAnswer.expectedKeywords.join(' ')} ${shortAnswer.explanation}`).correct).toBe(true);
    expect(gradeShortAnswer(shortAnswer, shortAnswer.forbiddenKeywords[0] ?? 'unrelated answer').correct).toBe(false);
  });

  it('loads and caches the bank from bundled curriculum and reference content', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(curriculum), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const reference = { search: vi.fn().mockResolvedValue(rules) };
    const service = new AssessmentQuestionBankService(reference as unknown as ColregsReferenceService);
    const first = service.loadBank();

    expect(service.loadBank()).toBe(first);
    await expect(first).resolves.toEqual(bank);
    expect(reference.search).toHaveBeenCalledWith('');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects when the bundled curriculum cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 })));
    const reference = { search: vi.fn().mockResolvedValue(rules) };
    const service = new AssessmentQuestionBankService(reference as unknown as ColregsReferenceService);

    await expect(service.loadBank()).rejects.toThrow('Bundled curriculum could not be loaded (503).');
  });
});
