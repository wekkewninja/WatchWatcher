import type { EvaluationRequest, EvaluationResult } from '../../../../shared/types/entities';

export interface IEvaluationService {
  evaluate(input: EvaluationRequest): Promise<EvaluationResult>;
  healthCheck(): Promise<boolean>;
}
