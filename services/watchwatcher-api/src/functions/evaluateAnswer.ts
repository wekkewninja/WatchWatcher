import { app } from '@azure/functions';
import { evaluateAnswerSchema } from '../../../shared/schemas/validation';
import { validateBody } from '../middleware/validateRequest';
import { ServiceUnavailableError, ValidationError } from '../errors/errorTypes';
import { getServices } from '../services/registry';
import { bearerHeader, runHttp } from './httpUtils';

app.http('evaluateAnswer', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'exam/evaluate',
  handler: (request, context) => runHttp(request, context, async () => {
    const services = getServices();
    const account = await services.auth.authenticate(bearerHeader(request));
    let input;
    try {
      input = await validateBody(request, evaluateAnswerSchema);
    } catch (error) {
      if (error instanceof ValidationError) throw new ValidationError('Request validation failed');
      throw error;
    }
    await services.auth.consumeEvaluationLimit(account.id);
    try {
      return { status: 200, jsonBody: await services.evaluation.evaluate(input) };
    } catch {
      throw new ServiceUnavailableError('Online evaluation is unavailable.');
    }
  }),
});
