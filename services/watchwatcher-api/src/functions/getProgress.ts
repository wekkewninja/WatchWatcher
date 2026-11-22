import { app } from '@azure/functions';
import type { ProgressSnapshot } from '../../../shared/types/entities';
import { getServices } from '../services/registry';
import { bearerHeader, runHttp } from './httpUtils';

const emptyProgress: ProgressSnapshot = { topicMastery: {}, weakSpotLog: [], drillQueue: [] };

app.http('getProgress', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'progress',
  handler: (request, context) => runHttp(request, context, async () => {
    const services = getServices();
    const user = await services.auth.authenticate(bearerHeader(request));
    const progress = await services.database.getProgress(user.id);
    return { status: 200, jsonBody: progress ?? { accountId: user.id, ...emptyProgress, revision: 0, syncedAt: null } };
  }),
});
