import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateStructuredRule19 } from '../../shared/evaluation/offline-evaluator';
import type { AppConfig } from '../src/services/config';
import { DeterministicEvaluationService, GeminiEvaluationService } from '../src/services/evaluationService';

describe('offline evaluation fallback', () => {
  const evaluator = new DeterministicEvaluationService();

  it('fails an unsafe port turn for a Rule 19 target forward of the beam', async () => {
    const result = await evaluator.evaluate({ topicId: 'colregs_rule_19', context: 'Target forward of beam', answer: 'I would turn to port.' });
    expect(result.score).toBeLessThan(0.5);
    expect(result.misconceptionTag).toBe('rule-19-prohibited-port-turn');
  });

  it('accepts a negated port-turn warning followed by a starboard action', async () => {
    const result = await evaluator.evaluate({
      topicId: 'colregs_rule_19',
      context: 'Target forward of beam',
      answer: 'Rule 19b makes me never turn port. so i will turn to starboard.',
    });
    expect(result.score).toBeGreaterThanOrEqual(0.85);
    expect(result.misconceptionTag).toBeNull();
  });

  it('rewards an answer that names a safe Rule 19 action', async () => {
    const result = await evaluator.evaluate({ topicId: 'colregs_rule_19', context: 'Target forward of beam', answer: 'Under Rule 19 maintain safe speed and alter to starboard.' });
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.misconceptionTag).toBeNull();
  });

  it('assesses generic topics without using the Rule 19 rubric', async () => {
    expect(await evaluator.evaluate({ topicId: 'other', context: 'Navigation', answer: 'The rule requires safe action.' })).toMatchObject({ source: 'offline', misconceptionTag: null });
    expect(await evaluator.evaluate({ topicId: 'other', context: 'Navigation', answer: 'Unsure' })).toMatchObject({ source: 'offline', misconceptionTag: 'incomplete-rule-application' });
    expect(await evaluator.healthCheck()).toBe(true);
  });

  it('reports the specific missing or unsafe element in structured Rule 19 answers', () => {
    const correct = { ruleNumber: 19, prohibits: 'port', alteration: 'starboard', safeSpeedConfirmed: true } as const;
    expect(evaluateStructuredRule19(correct).score).toBe(0.95);
    expect(evaluateStructuredRule19({ ...correct, safeSpeedConfirmed: false }).score).toBe(0.9);
    expect(evaluateStructuredRule19({ ...correct, alteration: 'port' }).misconceptionTag).toBe('rule-19-prohibited-port-turn');
    expect(evaluateStructuredRule19({ ...correct, ruleNumber: 15 }).misconceptionTag).toBe('rule-19-misidentified');
    expect(evaluateStructuredRule19({ ...correct, prohibits: 'starboard' }).misconceptionTag).toBe('rule-19-prohibition-misidentified');
  });
});

describe('GeminiEvaluationService', () => {
  const config: AppConfig = {
    environment: 'Test', databaseUrl: undefined, jwtSecret: undefined, jwtIssuer: 'watchwatcher-api', jwtAudience: 'watchwatcher-app',
    googleClientId: undefined, geminiApiKey: 'test-key', azureStorageAccount: undefined, azuriteConnectionString: undefined,
  };
  const input = { topicId: 'rule-5', context: 'Lookout', answer: 'Keep a proper lookout.' };

  afterEach(() => vi.unstubAllGlobals());

  it('submits the evaluation request and validates a structured response', async () => {
    const value = { score: 0.9, feedback: 'Correct', misconceptionTag: null, followUpDrill: 'Review lookout.' };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new GeminiEvaluationService(config);
    expect(await service.evaluate(input)).toEqual({ ...value, source: 'online' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('x-goog-api-key')).toBe('test-key');
    expect(await service.healthCheck()).toBe(true);
  });

  it('reports missing configuration and unsuccessful provider responses', async () => {
    const unconfigured = new GeminiEvaluationService({ ...config, geminiApiKey: undefined });
    expect(await unconfigured.healthCheck()).toBe(false);
    await expect(unconfigured.evaluate(input)).rejects.toThrow('not configured');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    await expect(new GeminiEvaluationService(config).evaluate(input)).rejects.toThrow('failed with 503');
  });

  it('rejects missing or invalid provider evaluations', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ score: 2, feedback: 'bad', followUpDrill: 'retry' }) }] } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new GeminiEvaluationService(config);
    await expect(service.evaluate(input)).rejects.toThrow('no structured evaluation');
    await expect(service.evaluate(input)).rejects.toThrow('invalid evaluation');
  });
});
