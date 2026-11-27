import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateStructuredRule19 } from '../../shared/evaluation/offline-evaluator';
import type { OnlineEvaluationRequest } from '../../shared/types/entities';
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
  const input = { topicId: 'rule-5', context: 'Lookout', answer: 'Keep a proper lookout.', onlineConsent: true } as const;

  afterEach(() => vi.unstubAllGlobals());

  it('submits the evaluation request and validates a structured response', async () => {
    const value = { score: 0.9, feedback: 'Correct', misconceptionTag: null, followUpDrill: 'Review lookout.', criticalFailure: false, criticalFailureReason: null };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new GeminiEvaluationService(config);
    const inputWithExtraData = { ...input, accountId: 'synthetic-account', progress: 'synthetic-progress' };
    expect(await service.evaluate(inputWithExtraData)).toEqual({ ...value, source: 'online' });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get('x-goog-api-key')).toBe('test-key');
    const body = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(JSON.parse(body.contents[0].parts[0].text)).toEqual({ topicId: input.topicId, context: input.context, answer: input.answer });
    expect(body.generationConfig.responseSchema.required).toContain('criticalFailure');
    expect(await service.healthCheck()).toBe(true);
  });

  it('does not contact the provider without explicit consent', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = new GeminiEvaluationService(config);
    await expect(service.evaluate({ ...input, onlineConsent: false } as unknown as OnlineEvaluationRequest)).rejects.toThrow('explicit consent');
    await expect(service.evaluate({ topicId: input.topicId, context: input.context, answer: input.answer } as OnlineEvaluationRequest)).rejects.toThrow('explicit consent');
    expect(fetchMock).not.toHaveBeenCalled();
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

  it.each([
    { criticalFailure: null, criticalFailureReason: null },
    { criticalFailure: undefined, criticalFailureReason: null },
    { criticalFailure: 'false', criticalFailureReason: null },
    { criticalFailure: true, criticalFailureReason: null },
    { criticalFailure: false, criticalFailureReason: 'Critical hazard' },
  ])('rejects uncertain, missing, malformed or contradictory safety fields: %j', async (safety) => {
    const value = { score: 0.95, feedback: 'Review', misconceptionTag: null, followUpDrill: 'Review', ...safety };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }))));
    await expect(new GeminiEvaluationService(config).evaluate(input)).rejects.toThrow('invalid evaluation');
  });

  it('preserves a high-score critical failure for downstream grading', async () => {
    const value = { score: 0.95, feedback: 'Review', misconceptionTag: 'unsafe-action', followUpDrill: 'Review', criticalFailure: true, criticalFailureReason: 'Unsafe alteration.' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }))));
    await expect(new GeminiEvaluationService(config).evaluate(input)).resolves.toMatchObject(value);
  });
});
