import { app } from '@azure/functions';
import { registerSchema } from '../../../shared/schemas/validation';
import { validateBody } from '../middleware/validateRequest';
import { getServices } from '../services/registry';
import { runHttp } from './httpUtils';

app.http('authRegister', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/register',
  handler: (request, context) => runHttp(request, context, async () => {
    const input = await validateBody(request, registerSchema);
    const session = await getServices().auth.register(input);
    return { status: 201, jsonBody: session };
  }),
});
