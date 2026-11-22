import { app } from '@azure/functions';
import { googleSignInSchema } from '../../../shared/schemas/validation';
import { ConflictError } from '../errors/errorTypes';
import { validateBody } from '../middleware/validateRequest';
import { getServices } from '../services/registry';
import { runHttp } from './httpUtils';

app.http('authGoogle', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/google',
  handler: (request, context) => runHttp(request, context, async () => {
    const result = await getServices().auth.loginWithGoogle(await validateBody(request, googleSignInSchema));
    if (result.kind === 'link-required') {
      throw new ConflictError('A password account already uses this verified Google email. Confirm linking and re-enter its password to continue.', {
        reason: 'GOOGLE_ACCOUNT_LINK_REQUIRED',
      });
    }
    return { status: 200, jsonBody: result.session };
  }),
});