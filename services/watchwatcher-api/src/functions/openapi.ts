import { app } from '@azure/functions';
import { getServices } from '../services/registry';
import { bearerHeader, runHttp } from './httpUtils';

const specification = {
  openapi: '3.0.3',
  info: { title: 'WatchWatcher API', version: '1.0.0' },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  },
  paths: {
    '/health': { get: { summary: 'API and optional service health', responses: { '200': { description: 'Healthy or degraded' }, '503': { description: 'Unavailable' } } } },
    '/auth/register': { post: { summary: 'Create an account', responses: { '201': { description: 'Account created' }, '409': { description: 'Duplicate account' } } } },
    '/auth/login': { post: { summary: 'Create a signed-in session', responses: { '200': { description: 'Session created' }, '401': { description: 'Invalid credentials' } } } },
    '/auth/session': { post: { summary: 'Start a session for account features', responses: { '200': { description: 'Session created' } } } },
    '/auth/me': { get: { summary: 'Read the signed-in user', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Current user' } } } },
    '/progress': {
      get: { summary: 'Read account progress', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Progress snapshot' } } },
      put: { summary: 'Synchronize account progress', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Revision saved' }, '409': { description: 'Stale revision' } } },
    },
    '/exam/evaluate': { post: { summary: 'Evaluate a study answer', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Structured evaluation' } } } },
  },
};

app.http('openapi', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'openapi.json',
  handler: (request, context) => runHttp(request, context, async () => {
    await getServices().auth.authenticate(bearerHeader(request));
    return { status: 200, jsonBody: specification };
  }),
});
