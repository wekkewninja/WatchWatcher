import { Injectable } from '@angular/core';
import { api } from '../../../api';
import type { EvaluationRequest, EvaluationResult } from '../../domain-types';
import type { StructuredRule19Answer } from '../../../../../shared/evaluation/offline-evaluator';
import { OfflineExaminerService } from './offline-examiner.service';

@Injectable({ providedIn: 'root' })
export class ExaminerAiService {
  constructor(private readonly offline: OfflineExaminerService) {}

  evaluateStructuredRule19(input: StructuredRule19Answer): EvaluationResult {
    return this.offline.evaluateStructuredRule19(input);
  }

  evaluateFreeText(input: EvaluationRequest): Promise<EvaluationResult> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Free-text grading requires online AI verification. Use the structured offline answer instead.');
    }
    return api.evaluateAnswer(input).then((result) => {
      if (result.source !== 'online') {
        throw new Error('Online AI verification is unavailable. Use the structured offline answer instead.');
      }
      return { ...result, passed: result.score >= this.threshold(input.topicId) };
    });
  }

  private threshold(topicId: string): number {
    return /colregs|emerg|mob/i.test(topicId) ? 0.85 : 0.8;
  }
}
