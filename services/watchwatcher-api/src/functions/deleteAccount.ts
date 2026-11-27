import { app } from '@azure/functions';
import { deleteAccountSchema } from '../../../shared/schemas/validation';
import { validateBody } from '../middleware/validateRequest';
import { getServices } from '../services/registry';
import { bearerHeader, runHttp } from './httpUtils';

app.http('deleteAccount', {
  methods: ['DELETE'],
  authLevel: 'anonymous',
  route: 'account',
  handler: (request, context) => runHttp(request, context, async () => {
    const input = await validateBody(request, deleteAccountSchema);
    await getServices().auth.deleteAccount(bearerHeader(request), input);
    return { status: 204 };
  }),
});