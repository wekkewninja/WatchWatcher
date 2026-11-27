import type { OnlineEvaluationRequest, EvaluationResult } from '../../../../shared/types/entities';

export interface IEvaluationService {
  evaluate(input: OnlineEvaluationRequest): Promise<EvaluationResult>;
  healthCheck(): Promise<boolean>;
}
