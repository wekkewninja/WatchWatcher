import { Injectable } from '@angular/core';
import { api } from '../../../api';
import type { EvaluationResult } from '../../domain-types';
import type { OnlineEvaluationRequest } from '@watchwatcher/shared/types';
import type { StructuredRule19Answer } from '../../../../../shared/evaluation/offline-evaluator';
import { OfflineExaminerService } from './offline-examiner.service';

@Injectable({ providedIn: 'root' })
export class ExaminerAiService {
  constructor(private readonly offline: OfflineExaminerService) {}

  evaluateStructuredRule19(input: StructuredRule19Answer): EvaluationResult {
    return this.offline.evaluateStructuredRule19(input);
  }

  evaluateFreeText(input: OnlineEvaluationRequest): Promise<EvaluationResult> {
    if (input.onlineConsent !== true) throw new Error('Online evaluation requires explicit consent.');
    if (input.answer.trim().length > 12000) throw new Error('Shorten your answer to 12,000 characters or fewer.');
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Free-text grading requires online AI evaluation. Use the structured offline answer instead.');
    }
    return api.evaluateAnswer(input).then((result) => {
      if (result.source !== 'online') {
        throw new Error('Online AI evaluation is unavailable. Use the structured offline answer instead.');
      }
      if (typeof result.criticalFailure !== 'boolean' || (result.criticalFailure ? typeof result.criticalFailureReason !== 'string' || !result.criticalFailureReason.trim() : result.criticalFailureReason !== null)) {
        throw new Error('Online AI evaluation is unavailable. Use the structured offline answer instead.');
      }
      return { ...result, passed: !result.criticalFailure && result.score >= this.threshold(input.topicId) };
    });
  }

  private threshold(topicId: string): number {
    return /colregs|emerg|mob/i.test(topicId) ? 0.85 : 0.8;
  }
}
