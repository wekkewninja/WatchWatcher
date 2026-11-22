import { app } from '@azure/functions';
import { evaluateAnswerSchema } from '../../../shared/schemas/validation';
import { validateBody } from '../middleware/validateRequest';
import { logger } from '../logger';
import { getServices } from '../services/registry';
import { bearerHeader, runHttp } from './httpUtils';

app.http('evaluateAnswer', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'exam/evaluate',
  handler: (request, context) => runHttp(request, context, async () => {
    const services = getServices();
    await services.auth.authenticate(bearerHeader(request));
    const input = await validateBody(request, evaluateAnswerSchema);
    let evaluation;
    try {
      evaluation = await services.evaluation.evaluate(input);
    } catch (error) {
      logger.warn({ err: error, topicId: input.topicId }, 'Online evaluation unavailable; applying deterministic rubric');
      evaluation = await services.deterministicEvaluation.evaluate(input);
    }
    return { status: 200, jsonBody: evaluation };
  }),
});
