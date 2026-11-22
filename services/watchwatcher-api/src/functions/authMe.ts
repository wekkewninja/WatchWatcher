import { app } from '@azure/functions';
import { getServices } from '../services/registry';
import { bearerHeader, runHttp } from './httpUtils';

app.http('authMe', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'auth/me',
  handler: (request, context) => runHttp(request, context, async () => ({
    status: 200,
    jsonBody: { user: await getServices().auth.authenticate(bearerHeader(request)) },
  })),
});
