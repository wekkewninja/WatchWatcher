import { evaluateOfflineAnswer } from '../../../shared/evaluation/offline-evaluator';
import type { EvaluationRequest, EvaluationResult } from '../../../shared/types/entities';
import type { AppConfig } from './config';
import type { IEvaluationService } from './interfaces/IEvaluationService';

export class GeminiEvaluationService implements IEvaluationService {
  constructor(private readonly config: AppConfig) {}

  async evaluate(input: EvaluationRequest): Promise<EvaluationResult> {
    const key = this.config.geminiApiKey;
    if (!key) throw new Error('Gemini evaluation is not configured.');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: 'Assess this Yachtmaster study answer conservatively against the supplied rule context. Return only JSON with score (0 to 1), feedback, misconceptionTag (string or null), followUpDrill.' }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.1 },
      }),
    });
    if (!response.ok) throw new Error(`Gemini evaluation failed with ${response.status}.`);
    const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = payload.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Gemini returned no structured evaluation.');
    const value = JSON.parse(text) as Partial<EvaluationResult>;
    if (typeof value.score !== 'number' || value.score < 0 || value.score > 1 || typeof value.feedback !== 'string' || typeof value.followUpDrill !== 'string') {
      throw new Error('Gemini returned an invalid evaluation.');
    }
    return { score: value.score, feedback: value.feedback, misconceptionTag: typeof value.misconceptionTag === 'string' ? value.misconceptionTag : null, followUpDrill: value.followUpDrill, source: 'online' };
  }

  async healthCheck(): Promise<boolean> { return Boolean(this.config.geminiApiKey); }
}

export class DeterministicEvaluationService implements IEvaluationService {
  async evaluate(input: EvaluationRequest): Promise<EvaluationResult> {
    return evaluateOfflineAnswer(input);
  }
  async healthCheck(): Promise<boolean> { return true; }
}
