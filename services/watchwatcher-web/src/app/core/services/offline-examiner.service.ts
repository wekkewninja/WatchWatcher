import { Injectable } from '@angular/core';
import { evaluateOfflineAnswer, evaluateStructuredRule19, type StructuredRule19Answer } from '../../../../../shared/evaluation/offline-evaluator';
import type { EvaluationRequest, EvaluationResult } from '../../domain-types';

@Injectable({ providedIn: 'root' })
export class OfflineExaminerService {
  evaluate(input: EvaluationRequest): EvaluationResult {
    const result = evaluateOfflineAnswer(input);
    return {
      ...result,
      passed: result.score >= (input.topicId.includes('19') ? 0.85 : 0.8),
    };
  }

  evaluateStructuredRule19(input: StructuredRule19Answer): EvaluationResult {
    const result = evaluateStructuredRule19(input);
    return { ...result, passed: result.score >= 0.85 };
  }
}
