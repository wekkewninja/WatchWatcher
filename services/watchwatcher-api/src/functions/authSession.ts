import { app } from '@azure/functions';
import { sessionSchema } from '../../../shared/schemas/validation';
import { validateBody } from '../middleware/validateRequest';
import { getServices } from '../services/registry';
import { runHttp } from './httpUtils';

app.http('authSession', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/session',
  handler: (request, context) => runHttp(request, context, async () => {
    const input = await validateBody(request, sessionSchema);
    return { status: 200, jsonBody: await getServices().auth.login(input) };
  }),
});
