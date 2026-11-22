import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveClient } from './client';
import catalogAsset from '../../public/assets/reference/colregs_catalog.json';

const catalog = catalogAsset as {
  rules: Array<{
    rule_number: string;
    title: string;
    category: string;
    summary: string;
    memory_hook: string;
    asa_inland_note: string;
    key_points: string[];
    exercise: {
      prompt: string;
      options: Array<{ id: string; text: string }>;
      answer: string;
      explanation: string;
      remediation: string;
    };
  }>;
};

describe('COLREGs catalog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('covers Rules 1–41 and Annexes I–IV with complete, uniquely linked exercises', () => {
    const ruleNumbers = catalog.rules.filter((entry) => /^Rule \d+$/.test(entry.rule_number)).map((entry) => entry.rule_number);
    const annexNumbers = catalog.rules.filter((entry) => /^Annex [IVX]+$/.test(entry.rule_number)).map((entry) => entry.rule_number);

    expect(ruleNumbers).toEqual(Array.from({ length: 41 }, (_, index) => `Rule ${index + 1}`));
    expect(annexNumbers).toEqual(['Annex I', 'Annex II', 'Annex III', 'Annex IV']);
    expect(new Set(catalog.rules.map((entry) => entry.rule_number)).size).toBe(catalog.rules.length);

    for (const entry of catalog.rules) {
      expect(entry.title.trim()).not.toBe('');
      expect(entry.summary.trim()).not.toBe('');
      expect(entry.key_points.length).toBeGreaterThanOrEqual(2);
      expect(entry.exercise.prompt.trim()).not.toBe('');
      expect(entry.exercise.options).toHaveLength(4);
      expect(new Set(entry.exercise.options.map((option) => option.id)).size).toBe(4);
      expect(entry.exercise.options.some((option) => option.id === entry.exercise.answer)).toBe(true);
      expect(entry.exercise.explanation.trim()).not.toBe('');
      expect(entry.exercise.remediation.trim()).not.toBe('');
    }
  });

  it('loads the canonical catalog through the offline API client with stable rule IDs', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(catalog), { status: 200 })));

    const results = await liveClient.searchColregs('');
    const rule1 = results.find((entry) => entry.ruleNumber === 'Rule 1');
    const rule41 = results.find((entry) => entry.ruleNumber === 'Rule 41');
    const annex1 = results.find((entry) => entry.ruleNumber === 'Annex I');

    expect(results).toHaveLength(45);
    expect(rule1?.id).toBe('rule-1');
    expect(rule1?.exercise.options).toHaveLength(4);
    expect(rule41?.id).toBe('rule-41');
    expect(annex1?.id).toBe('annex-i');
    expect(await liveClient.searchColregs('towing')).not.toHaveLength(0);
  });
});