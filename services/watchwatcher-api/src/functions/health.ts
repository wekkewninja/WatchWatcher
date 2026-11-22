import { app } from '@azure/functions';
import { getServices } from '../services/registry';
import { runHttp } from './httpUtils';

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: (request, context) => runHttp(request, context, async () => {
    const services = getServices();
    const [database, blobStorage, gemini] = await Promise.all([
      services.database.healthCheck(),
      services.blobStorage.healthCheck(),
      services.evaluation.healthCheck(),
    ]);
    const checks = { api: true, database, blobStorage, gemini };
    const status = Object.values(checks).every(Boolean) ? 'healthy' : 'degraded';
    return { status: 200, jsonBody: { status, services: checks } };
  }),
});
