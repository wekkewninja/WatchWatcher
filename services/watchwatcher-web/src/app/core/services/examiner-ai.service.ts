import { Injectable } from '@angular/core';
import { api } from '../../../api';
import type { EvaluationResult } from '../../domain-types';
import type { OnlineEvaluationRequest } from '@watchwatcher/shared/types';
import type { StructuredRule19Answer } from '../../../../../shared/evaluation/offline-evaluator';
import { OfflineExaminerService } from './offline-examiner.service';
import { LocaleService } from '../locale.service';

@Injectable({ providedIn: 'root' })
export class ExaminerAiService {
  constructor(private readonly offline: OfflineExaminerService, private readonly locales: LocaleService = new LocaleService()) {}

  evaluateStructuredRule19(input: StructuredRule19Answer): EvaluationResult {
    return this.offline.evaluateStructuredRule19(input);
  }

  evaluateFreeText(input: OnlineEvaluationRequest): Promise<EvaluationResult> {
    if (input.onlineConsent !== true) throw new Error(this.locales.translate('evaluation.consentRequired'));
    if (input.answer.trim().length > 12000) throw new Error(this.locales.translate('evaluation.answerTooLong'));
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error(this.locales.translate('evaluation.offlineUnavailable'));
    }
    return api.evaluateAnswer(input).then((result) => {
      if (result.source !== 'online') {
        throw new Error(this.locales.translate('evaluation.unavailable'));
      }
      if (typeof result.criticalFailure !== 'boolean' || (result.criticalFailure ? typeof result.criticalFailureReason !== 'string' || !result.criticalFailureReason.trim() : result.criticalFailureReason !== null)) {
        throw new Error(this.locales.translate('evaluation.unavailable'));
      }
      return { ...result, passed: !result.criticalFailure && result.score >= this.threshold(input.topicId) };
    });
  }

  private threshold(topicId: string): number {
    return /colregs|emerg|mob/i.test(topicId) ? 0.85 : 0.8;
  }
}
