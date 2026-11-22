import { app } from '@azure/functions';
import { credentialsSchema } from '../../../shared/schemas/validation';
import { validateBody } from '../middleware/validateRequest';
import { getServices } from '../services/registry';
import { runHttp } from './httpUtils';

app.http('authLogin', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/login',
  handler: (request, context) => runHttp(request, context, async () => {
    const input = await validateBody(request, credentialsSchema);
    return { status: 200, jsonBody: await getServices().auth.login(input) };
  }),
});
