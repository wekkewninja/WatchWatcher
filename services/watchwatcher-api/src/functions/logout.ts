import { app } from '@azure/functions';
import { getServices } from '../services/registry';
import { bearerHeader, runHttp } from './httpUtils';

app.http('logout', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/logout',
  handler: (request, context) => runHttp(request, context, async () => {
    await getServices().auth.logout(bearerHeader(request));
    return { status: 204, headers: { 'Cache-Control': 'no-store' } };
  }),
});