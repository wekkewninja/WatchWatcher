import { afterEach, describe, expect, it, vi } from 'vitest';
import { liveClient } from './client';
import catalogAsset from '../../public/assets/reference/colregs_catalog.json';
import officialTextAsset from '../../public/assets/reference/colregs_official_text.json';

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

const officialText = officialTextAsset as {
  source_url: string;
  source_updated_on: string;
  checked_on: string;
  rules: Array<{
    rule_number: string;
    international: string[];
    inland?: string[];
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

  it('includes full official text for Rules 1–41 and omits Inland-only variants where none exist', () => {
    expect(officialText.source_url).toBe('https://www.navcen.uscg.gov/navigation-rules-amalgamated');
    expect(officialText.rules.map((rule) => rule.rule_number)).toEqual(Array.from({ length: 41 }, (_, index) => `Rule ${index + 1}`));
    for (const rule of officialText.rules) {
      expect(rule.international.length, `${rule.rule_number} International paragraphs`).toBeGreaterThan(0);
      expect(rule.international.every((paragraph) => paragraph.trim().length > 0)).toBe(true);
      expect(rule.international.some((paragraph) => /IMPLEMENTING RULE|INTERPRETATIVE RULE/i.test(paragraph))).toBe(false);
      if (rule.inland) expect(rule.inland.every((paragraph) => paragraph.trim().length > 0)).toBe(true);
    }
    expect(officialText.rules.filter((rule) => rule.inland)).toHaveLength(37);
    for (const ruleNumber of ['Rule 28', 'Rule 39', 'Rule 40', 'Rule 41']) {
      expect(officialText.rules.find((rule) => rule.rule_number === ruleNumber)?.inland).toBeUndefined();
    }
    const rule1 = officialText.rules[0];
    expect(rule1.international).toHaveLength(5);
    expect(rule1.international.join(' ')).not.toContain('(f)');
    expect(rule1.inland?.map((paragraph) => paragraph.match(/^\(([a-z])\)/)?.[1])).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('loads the canonical catalog through the offline API client with stable rule IDs', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const asset = String(input).includes('colregs_official_text.json') ? officialText : catalog;
      return new Response(JSON.stringify(asset), { status: 200 });
    }));

    const results = await liveClient.searchColregs('');
    const rule1 = results.find((entry) => entry.ruleNumber === 'Rule 1');
    const rule41 = results.find((entry) => entry.ruleNumber === 'Rule 41');
    const annex1 = results.find((entry) => entry.ruleNumber === 'Annex I');

    expect(results).toHaveLength(45);
    expect(rule1?.id).toBe('rule-1');
    expect(rule1?.exercise.options).toHaveLength(4);
    expect(rule1?.officialText?.international).toHaveLength(5);
    expect(rule1?.officialText?.international[0]).toContain('high seas');
    expect(rule1?.officialText?.inland?.[0]).toContain('inland waters of the United States');
    expect(rule1?.officialText?.inland?.[3]).toContain('may be established');
    expect(rule1?.officialText?.sourceUpdatedOn).toBe('2026-11-16');
    expect(results.filter((rule) => /^Rule \d+$/.test(rule.ruleNumber)).every((rule) => rule.officialText?.international.length)).toBe(true);
    expect(results.find((rule) => rule.ruleNumber === 'Rule 28')?.officialText?.inland).toBeUndefined();
    expect(rule41?.id).toBe('rule-41');
    expect(annex1?.id).toBe('annex-i');
    expect(await liveClient.searchColregs('towing')).not.toHaveLength(0);
  });
});