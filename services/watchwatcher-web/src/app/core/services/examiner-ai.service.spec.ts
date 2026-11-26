import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../../api';
import { ExaminerAiService } from './examiner-ai.service';
import { OfflineExaminerService } from './offline-examiner.service';

describe('ExaminerAiService free-text grading', () => {
  const examiner = new ExaminerAiService(new OfflineExaminerService());

  beforeEach(() => vi.stubGlobal('navigator', { onLine: true }));
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const answer = { topicId: 'colregs_rule_19', context: 'Target forward of the beam', answer: 'A clear starboard alteration under Rule 19.' };

  it('refuses to pass a deterministic offline response as an AI-verified text answer', async () => {
    vi.spyOn(api, 'evaluateAnswer').mockResolvedValue({
      score: 0.95,
      feedback: 'Offline heuristic result',
      misconceptionTag: null,
      followUpDrill: 'Use structured answer mode.',
      passed: true,
      source: 'offline',
    });

    await expect(examiner.evaluateFreeText(answer)).rejects.toThrow('Online AI verification is unavailable');
  });

  it('refuses free-text grading when the browser is offline', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const evaluate = vi.spyOn(api, 'evaluateAnswer');

    expect(() => examiner.evaluateFreeText(answer)).toThrow('Free-text grading requires online AI verification');
    expect(evaluate).not.toHaveBeenCalled();
  });

  it('accepts a threshold-passing AI-sourced online answer', async () => {
    vi.spyOn(api, 'evaluateAnswer').mockResolvedValue({
      score: 0.92,
      feedback: 'AI verified a safe Rule 19 response.',
      misconceptionTag: null,
      followUpDrill: 'Try a starboard-bow target.',
      passed: false,
      source: 'online',
    });

    await expect(examiner.evaluateFreeText(answer)).resolves.toMatchObject({ passed: true, source: 'online' });
  });

  it('uses the general syllabus pass threshold for non-COLREG topics', async () => {
    vi.spyOn(api, 'evaluateAnswer').mockResolvedValue({
      score: 0.82,
      feedback: 'Pass',
      misconceptionTag: null,
      followUpDrill: 'Continue.',
      passed: true,
      source: 'online',
    });

    await expect(examiner.evaluateFreeText({ ...answer, topicId: 'navigation_compass' })).resolves.toMatchObject({ passed: true });
  });

  it('handles environments without navigator when attempting online grading', async () => {
    vi.stubGlobal('navigator', undefined);
    vi.spyOn(api, 'evaluateAnswer').mockResolvedValue({
      score: 0.9,
      feedback: 'Verified.',
      misconceptionTag: null,
      followUpDrill: 'Continue.',
      passed: true,
      source: 'online',
    });

    await expect(examiner.evaluateFreeText(answer)).resolves.toMatchObject({ passed: true, source: 'online' });
  });

  it('delegates structured Rule 19 answers to the deterministic offline evaluator', () => {
    const result = examiner.evaluateStructuredRule19({
      ruleNumber: 19,
      prohibits: 'port',
      alteration: 'starboard',
      safeSpeedConfirmed: true,
    });

    expect(result).toMatchObject({ passed: true, score: 0.95, source: 'offline' });
  });
});
