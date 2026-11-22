import type { ApiClient } from './types';
import { getAuthenticatedAccountId, liveClient } from './client';
export const api: ApiClient = liveClient;
export { getAuthenticatedAccountId };
export type { ApiClient } from './types';
