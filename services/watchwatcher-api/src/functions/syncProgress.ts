import { app } from '@azure/functions';
import { progressSyncSchema } from '../../../shared/schemas/validation';
import { validateBody } from '../middleware/validateRequest';
import { getServices } from '../services/registry';
import { bearerHeader, runHttp } from './httpUtils';

app.http('syncProgress', {
  methods: ['PUT'],
  authLevel: 'anonymous',
  route: 'progress',
  handler: (request, context) => runHttp(request, context, async () => {
    const services = getServices();
    const user = await services.auth.authenticate(bearerHeader(request));
    const { revision, ...snapshot } = await validateBody(request, progressSyncSchema);
    const result = await services.database.saveProgress(user.id, snapshot, revision);
    return { status: 200, jsonBody: result };
  }),
});
