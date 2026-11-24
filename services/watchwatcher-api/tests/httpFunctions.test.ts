import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '../src/errors/errorTypes';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>>(),
  auth: {
    authenticate: vi.fn(),
    register: vi.fn(),
    login: vi.fn(),
    loginWithGoogle: vi.fn(),
    getGoogleClientId: vi.fn(),
    createGoogleChallenge: vi.fn(),
  },
  database: { getProgress: vi.fn(), saveProgress: vi.fn(), healthCheck: vi.fn() },
  blobStorage: { healthCheck: vi.fn() },
  evaluation: { evaluate: vi.fn(), healthCheck: vi.fn() },
  deterministicEvaluation: { evaluate: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('@azure/functions', () => ({
  app: { http: (name: string, options: { handler: (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit> }) => mocks.handlers.set(name, options.handler) },
}));
vi.mock('../src/services/registry', () => ({ getServices: () => mocks }));
vi.mock('../src/logger', () => ({ logger: mocks.logger }));

import '../src/functions/authGoogle';
import '../src/functions/authGoogleChallenge';
import '../src/functions/authGoogleConfig';
import '../src/functions/authLogin';
import '../src/functions/authMe';
import '../src/functions/authRegister';
import '../src/functions/authSession';
import '../src/functions/evaluateAnswer';
import '../src/functions/getProgress';
import '../src/functions/health';
import '../src/functions/openapi';
import '../src/functions/syncProgress';

const context = { invocationId: 'test-invocation' } as InvocationContext;
const account = { id: 'account-1', email: 'sailor@example.com', name: 'Sailor' };
const session = { accountId: account.id, session: 'session-token', user: account };

function request(body: unknown = {}, authorization?: string): HttpRequest {
  return {
    method: 'POST',
    url: 'http://localhost/api/test',
    headers: new Headers(authorization ? { authorization } : {}),
    json: async () => body,
  } as unknown as HttpRequest;
}

async function invoke(name: string, input: HttpRequest = request()): Promise<HttpResponseInit> {
  const handler = mocks.handlers.get(name);
  if (!handler) throw new Error(`Missing registered function: ${name}`);
  return handler(input, context);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.authenticate.mockResolvedValue(account);
  mocks.auth.register.mockResolvedValue(session);
  mocks.auth.login.mockResolvedValue(session);
  mocks.database.healthCheck.mockResolvedValue(true);
  mocks.blobStorage.healthCheck.mockResolvedValue(true);
  mocks.evaluation.healthCheck.mockResolvedValue(true);
});

describe('HTTP function contracts', () => {
  it('registers health and reports healthy or degraded dependencies', async () => {
    expect(await invoke('health')).toMatchObject({ status: 200, jsonBody: { status: 'healthy', services: { database: true, blobStorage: true, gemini: true } } });
    mocks.database.healthCheck.mockResolvedValue(false);
    expect(await invoke('health')).toMatchObject({ status: 200, jsonBody: { status: 'degraded', services: { database: false } } });
  });

  it('validates registration and delegates a valid registration', async () => {
    const body = { name: 'Sailor', email: 'sailor@example.com', password: 'strong-password' };
    expect(await invoke('authRegister', request(body))).toMatchObject({ status: 201, jsonBody: session });
    expect(mocks.auth.register).toHaveBeenCalledWith(body);
    expect(await invoke('authRegister', request({ ...body, email: 'invalid' }))).toMatchObject({ status: 422, jsonBody: { error: { code: 'VALIDATION_ERROR' } } });
  });

  it.each(['authLogin', 'authSession'])('%s uses the credentials schema', async (name) => {
    const body = { email: 'sailor@example.com', password: 'password123' };
    expect(await invoke(name, request(body))).toMatchObject({ status: 200, jsonBody: session });
    expect(mocks.auth.login).toHaveBeenCalledWith(body);
    expect(await invoke(name, request({ ...body, unexpected: true }))).toMatchObject({ status: 422 });
  });

  it('rejects invalid JSON and returns a safe authentication error', async () => {
    const badRequest = { ...request(), json: async () => { throw new Error('invalid JSON'); } } as HttpRequest;
    expect(await invoke('authLogin', badRequest)).toMatchObject({ status: 422, jsonBody: { error: { message: 'Request body must be valid JSON' } } });
    mocks.auth.authenticate.mockRejectedValue(new UnauthorizedError());
    expect(await invoke('authMe', request({}, 'Bearer invalid'))).toMatchObject({ status: 401, jsonBody: { error: { code: 'UNAUTHORIZED' } } });
  });

  it('uses the bearer token to obtain account identity and returns empty progress for new users', async () => {
    const input = request({}, 'Bearer example');
    expect(await invoke('authMe', input)).toMatchObject({ status: 200, jsonBody: { user: account } });
    mocks.database.getProgress.mockResolvedValue(null);
    expect(await invoke('getProgress', input)).toMatchObject({ status: 200, jsonBody: { accountId: account.id, revision: 0, ruleExerciseAttempts: [] } });
    expect(mocks.auth.authenticate).toHaveBeenCalledWith('Bearer example');
    expect(mocks.database.getProgress).toHaveBeenCalledWith(account.id);
  });

  it('returns existing progress and synchronizes a validated snapshot for the authenticated account', async () => {
    const snapshot = { topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };
    const stored = { accountId: account.id, ...snapshot, revision: 3, syncedAt: '2026-01-01T00:00:00.000Z' };
    mocks.database.getProgress.mockResolvedValue(stored);
    mocks.database.saveProgress.mockResolvedValue({ revision: 4, syncedAt: '2026-01-01T01:00:00.000Z' });
    expect(await invoke('getProgress', request())).toMatchObject({ status: 200, jsonBody: stored });
    expect(await invoke('syncProgress', request({ ...snapshot, revision: 3 }, 'Bearer example'))).toMatchObject({ status: 200, jsonBody: { revision: 4 } });
    expect(mocks.database.saveProgress).toHaveBeenCalledWith(account.id, snapshot, 3);
    expect(await invoke('syncProgress', request({ ...snapshot, revision: -1 }))).toMatchObject({ status: 422 });
  });

  it('returns Google configuration, challenge, and a verified session', async () => {
    mocks.auth.getGoogleClientId.mockReturnValue('client-id');
    mocks.auth.createGoogleChallenge.mockResolvedValue({ challengeId: 'challenge', nonce: 'nonce' });
    mocks.auth.loginWithGoogle.mockResolvedValue({ kind: 'authenticated', session });
    expect(await invoke('authGoogleConfig')).toMatchObject({ status: 200, jsonBody: { clientId: 'client-id' } });
    expect(await invoke('authGoogleChallenge')).toMatchObject({ status: 201, jsonBody: { challengeId: 'challenge' } });
    const body = { challengeId: '32f63760-6b39-4f06-935e-430251d1b785', credential: 'x'.repeat(100) };
    expect(await invoke('authGoogle', request(body))).toMatchObject({ status: 200, jsonBody: session });
    expect(mocks.auth.loginWithGoogle).toHaveBeenCalledWith(body);
  });

  it('requires explicit linking for an existing password account', async () => {
    mocks.auth.loginWithGoogle.mockResolvedValue({ kind: 'link-required' });
    const body = { challengeId: '32f63760-6b39-4f06-935e-430251d1b785', credential: 'x'.repeat(100) };
    expect(await invoke('authGoogle', request(body))).toMatchObject({ status: 409, jsonBody: { error: { code: 'CONFLICT', details: { reason: 'GOOGLE_ACCOUNT_LINK_REQUIRED' } } } });
  });

  it('uses online evaluation when available and deterministic fallback on failure', async () => {
    const body = { topicId: 'rule-5', context: 'Lookout', answer: 'Maintain a lookout.' };
    mocks.evaluation.evaluate.mockResolvedValue({ score: 0.9, source: 'online' });
    expect(await invoke('evaluateAnswer', request(body))).toMatchObject({ status: 200, jsonBody: { source: 'online' } });
    mocks.evaluation.evaluate.mockRejectedValue(new Error('unavailable'));
    mocks.deterministicEvaluation.evaluate.mockResolvedValue({ score: 0.7, source: 'offline' });
    expect(await invoke('evaluateAnswer', request(body))).toMatchObject({ status: 200, jsonBody: { source: 'offline' } });
    expect(mocks.deterministicEvaluation.evaluate).toHaveBeenCalledWith(body);
    expect(await invoke('evaluateAnswer', request({ ...body, answer: '' }))).toMatchObject({ status: 422 });
  });

  it('requires authentication before returning the OpenAPI contract', async () => {
    const response = await invoke('openapi', request({}, 'Bearer example'));
    expect(response).toMatchObject({ status: 200, jsonBody: { openapi: '3.0.3', info: { title: 'WatchWatcher API' } } });
    expect(mocks.auth.authenticate).toHaveBeenCalledWith('Bearer example');
    mocks.auth.authenticate.mockRejectedValue(new UnauthorizedError());
    expect(await invoke('openapi', request())).toMatchObject({ status: 401 });
  });

  it('does not expose unexpected error details in production', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AZURE_FUNCTIONS_ENVIRONMENT', 'Production');
    mocks.auth.authenticate.mockRejectedValue(new Error('internal database detail'));
    try {
      expect(await invoke('authMe')).toMatchObject({ status: 500, jsonBody: { error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred' } } });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('keeps actionable diagnostics in the Azure development environment', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AZURE_FUNCTIONS_ENVIRONMENT', 'Development');
    mocks.auth.authenticate.mockRejectedValue(new Error('local database detail'));
    try {
      expect(await invoke('authMe')).toMatchObject({ status: 500, jsonBody: { error: { code: 'INTERNAL_ERROR', message: 'local database detail' } } });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});