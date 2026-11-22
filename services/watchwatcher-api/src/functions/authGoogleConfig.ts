import { app } from '@azure/functions';
import { getServices } from '../services/registry';
import { runHttp } from './httpUtils';

app.http('authGoogleConfig', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/google/config',
  handler: (request, context) => runHttp(request, context, async () => ({
    status: 200,
    jsonBody: { clientId: getServices().auth.getGoogleClientId() },
  })),
});