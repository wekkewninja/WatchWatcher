import { app } from '@azure/functions';
import { getServices } from '../services/registry';
import { runHttp } from './httpUtils';

app.http('authGoogleChallenge', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'auth/google/challenge',
  handler: (request, context) => runHttp(request, context, async () => ({
    status: 201,
    jsonBody: await getServices().auth.createGoogleChallenge(),
  })),
});