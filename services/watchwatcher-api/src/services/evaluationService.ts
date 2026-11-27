import { evaluateOfflineAnswer } from '../../../shared/evaluation/offline-evaluator';
import type { EvaluationRequest, EvaluationResult, OnlineEvaluationRequest } from '../../../shared/types/entities';
import type { AppConfig } from './config';
import type { IEvaluationService } from './interfaces/IEvaluationService';

export class GeminiEvaluationService implements IEvaluationService {
  constructor(private readonly config: AppConfig) {}

  async evaluate(input: OnlineEvaluationRequest): Promise<EvaluationResult> {
    if (input.onlineConsent !== true) throw new Error('Online evaluation requires explicit consent.');
    const key = this.config.geminiApiKey;
    if (!key) throw new Error('Gemini evaluation is not configured.');
    const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'Assess this Yachtmaster study answer conservatively against the supplied rule context. Identify any critical safety misconception independently of the score. Set criticalFailure to true and provide a specific criticalFailureReason when present, false and a null reason only when you can confidently rule one out, or null when uncertain. Do not treat this assessment as authoritative navigation guidance. Return only the requested JSON.' }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify({ topicId: input.topicId, context: input.context, answer: input.answer }) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1, responseSchema: {
          type: 'OBJECT', required: ['score', 'feedback', 'misconceptionTag', 'followUpDrill', 'criticalFailure', 'criticalFailureReason'],
          properties: {
            score: { type: 'NUMBER' }, feedback: { type: 'STRING' }, misconceptionTag: { type: 'STRING', nullable: true },
            followUpDrill: { type: 'STRING' }, criticalFailure: { type: 'BOOLEAN', nullable: true }, criticalFailureReason: { type: 'STRING', nullable: true },
          },
        } },
      }),
    });
    if (!response.ok) throw new Error(`Gemini evaluation failed with ${response.status}.`);
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned no structured evaluation.');
    const value = JSON.parse(text) as Partial<EvaluationResult>;
    if (typeof value.score !== 'number' || !Number.isFinite(value.score) || value.score < 0 || value.score > 1 || typeof value.feedback !== 'string' || !value.feedback.trim() || typeof value.followUpDrill !== 'string' || !value.followUpDrill.trim()
      || (value.misconceptionTag !== null && (typeof value.misconceptionTag !== 'string' || !value.misconceptionTag.trim()))
      || typeof value.criticalFailure !== 'boolean'
      || (value.criticalFailure ? typeof value.criticalFailureReason !== 'string' || !value.criticalFailureReason.trim() : value.criticalFailureReason !== null)) {
      throw new Error('Gemini returned an invalid evaluation.');
    }
    return { score: value.score, feedback: value.feedback, misconceptionTag: value.misconceptionTag, followUpDrill: value.followUpDrill, criticalFailure: value.criticalFailure, criticalFailureReason: value.criticalFailureReason, source: 'online' };
  }

  async healthCheck(): Promise<boolean> { return Boolean(this.config.geminiApiKey); }
}

export class DeterministicEvaluationService implements IEvaluationService {
  async evaluate(input: EvaluationRequest): Promise<EvaluationResult> {
    return evaluateOfflineAnswer(input);
  }
  async healthCheck(): Promise<boolean> { return true; }
}
