import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitError, ReauthenticationError, UnauthorizedError } from '../src/errors/errorTypes';
import { AuthService } from '../src/services/authService';
import type { IDatabaseService } from '../src/services/interfaces/IDatabaseService';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>>(),
  auth: {
    authenticate: vi.fn(),
    consumeEvaluationLimit: vi.fn(),
    logout: vi.fn(),
    deleteAccount: vi.fn(),
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
import '../src/functions/deleteAccount';
import '../src/functions/logout';
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
  it('does not log or return unexpected credential-bearing errors on authentication and deletion routes', async () => {
    const password = 'synthetic-password';
    const hash = 'scrypt$v=1$synthetic-full-hash';
    const detail = `${password} ${hash} synthetic-secret`;
    vi.stubEnv('AZURE_FUNCTIONS_ENVIRONMENT', 'Development');
    try {
      for (const [name, path, body] of [
        ['authLogin', '/api/auth/login', { email: 'sailor@example.com', password }],
        ['deleteAccount', '/api/account', { confirmation: 'DELETE', reauthentication: { type: 'password', password } }],
      ] as const) {
        if (name === 'authLogin') mocks.auth.login.mockRejectedValueOnce(new Error(detail));
        else mocks.auth.deleteAccount.mockRejectedValueOnce(new Error(detail));
        const input = { ...request(body, 'Bearer synthetic-token'), url: `http://localhost${path}` } as HttpRequest;
        expect(await invoke(name, input)).toMatchObject({ status: 500, jsonBody: { error: { message: 'An internal error occurred' } } });
      }
      const logs = JSON.stringify([mocks.logger.info.mock.calls, mocks.logger.warn.mock.calls, mocks.logger.error.mock.calls], (_key, value: unknown) =>
        value instanceof Error ? { ...value, message: value.message, stack: value.stack } : value);
      for (const secret of [password, hash, 'synthetic-secret', 'synthetic-token']) expect(logs).not.toContain(secret);
    } finally { vi.unstubAllEnvs(); }
  });
  it('returns an empty no-store response for logout and never logs the bearer', async () => {
    expect(await invoke('logout', request({}, 'Bearer synthetic-token'))).toEqual({ status: 204, headers: { 'Cache-Control': 'no-store' } });
    expect(mocks.auth.logout).toHaveBeenCalledWith('Bearer synthetic-token');
    mocks.auth.logout.mockRejectedValueOnce(new UnauthorizedError());
    expect(await invoke('logout', request({}, 'Bearer synthetic-token'))).toMatchObject({ status: 401 });
    expect(JSON.stringify([mocks.logger.info.mock.calls, mocks.logger.warn.mock.calls])).not.toContain('synthetic-token');
  });
  it('returns the same generic 429 and retry header for all limited operations without logging sensitive inputs', async () => {
    const credentials = { email: 'synthetic@example.test', password: 'synthetic-password' };
    const registration = { ...credentials, name: 'Synthetic' };
    const deletion = { confirmation: 'DELETE', reauthentication: { type: 'password', password: credentials.password } };
    mocks.auth.login.mockRejectedValueOnce(new RateLimitError(73)).mockRejectedValueOnce(new RateLimitError(73));
    mocks.auth.register.mockRejectedValueOnce(new RateLimitError(73));
    mocks.auth.deleteAccount.mockRejectedValueOnce(new RateLimitError(73));
    for (const [name, body] of [['authLogin', credentials], ['authSession', credentials], ['authRegister', registration], ['deleteAccount', deletion]] as const) {
      expect(await invoke(name, request(body, 'Bearer synthetic-token'))).toMatchObject({
        status: 429, headers: { 'Retry-After': '73' },
        jsonBody: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again later.' } },
      });
    }
    const logs = JSON.stringify([mocks.logger.info.mock.calls, mocks.logger.warn.mock.calls, mocks.logger.error.mock.calls], (_key, value: unknown) =>
      value instanceof Error ? { ...value, message: value.message, stack: value.stack } : value);
    for (const secret of [credentials.email, credentials.password, 'synthetic-token']) expect(logs).not.toContain(secret);
  });

  it('does not log database details when the limiter store fails', async () => {
    const sensitiveDetail = 'synthetic-database-secret@example.test';
    const database = { consumeIdentifierLimit: async () => { throw new Error(sensitiveDetail); } } as unknown as IDatabaseService;
    const auth = new AuthService(database, {
      environment: 'Production', databaseUrl: undefined, jwtSecret: 'synthetic-jwt-secret-at-least-32-characters',
      rateLimitSecret: 'synthetic-limit-secret-at-least-32-characters', jwtIssuer: 'test', jwtAudience: 'test',
      googleClientId: undefined, geminiApiKey: undefined, azureStorageAccount: undefined, azuriteConnectionString: undefined,
    });
    mocks.auth.login.mockImplementationOnce((input) => auth.login(input));
    expect(await invoke('authLogin', request({ email: 'synthetic@example.test', password: 'synthetic-password' }))).toMatchObject({
      status: 503, jsonBody: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Rate limiting is unavailable.' } },
    });
    const logs = JSON.stringify([mocks.logger.info.mock.calls, mocks.logger.warn.mock.calls, mocks.logger.error.mock.calls], (_key, value: unknown) =>
      value instanceof Error ? { ...value, message: value.message, stack: value.stack } : value);
    for (const secret of [sensitiveDetail, 'synthetic@example.test', 'synthetic-password', 'synthetic-limit-secret']) expect(logs).not.toContain(secret);
  });
  it('validates account deletion and returns an empty 204 without logging credentials', async () => {
    const body = { confirmation: 'DELETE', reauthentication: { type: 'password', password: 'secret-password' } };
    expect(await invoke('deleteAccount', request(body, 'Bearer signed'))).toEqual({ status: 204 });
    expect(mocks.auth.deleteAccount).toHaveBeenCalledWith('Bearer signed', body);
    expect(JSON.stringify(mocks.logger.info.mock.calls)).not.toContain('secret-password');
    expect(await invoke('deleteAccount', request({ ...body, confirmation: 'NO' }, 'Bearer signed'))).toMatchObject({ status: 422 });
    mocks.auth.deleteAccount.mockRejectedValueOnce(new ReauthenticationError());
    expect(await invoke('deleteAccount', request(body, 'Bearer signed'))).toMatchObject({ status: 403, jsonBody: { error: { code: 'REAUTHENTICATION_FAILED' } } });
    mocks.auth.deleteAccount.mockRejectedValueOnce(new UnauthorizedError());
    expect(await invoke('deleteAccount', request(body, 'Bearer invalid'))).toMatchObject({ status: 401, jsonBody: { error: { code: 'UNAUTHORIZED' } } });
    expect(JSON.stringify(mocks.logger.warn.mock.calls)).not.toContain('secret-password');
    mocks.auth.deleteAccount.mockRejectedValueOnce(new Error('database unavailable'));
    expect(await invoke('deleteAccount', request(body, 'Bearer signed'))).toMatchObject({ status: 500 });
  });
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
    expect(await invoke('getProgress', input)).toMatchObject({ status: 200, jsonBody: { accountId: account.id, revision: 0, ruleExerciseAttempts: [], objectivePracticeAttempts: [], examSessions: [], deletedExamSessionIds: [], examHistoryDeletedAt: null } });
    expect(mocks.auth.authenticate).toHaveBeenCalledWith('Bearer example');
    expect(mocks.database.getProgress).toHaveBeenCalledWith(account.id);
  });

  it('returns existing progress and synchronizes a validated snapshot for the authenticated account', async () => {
    const snapshot = { topicMastery: {}, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [], objectivePracticeAttempts: [], examSessions: [], deletedExamSessionIds: [], examHistoryDeletedAt: null };
    const stored = { accountId: account.id, ...snapshot, revision: 3, syncedAt: '2026-01-01T00:00:00.000Z' };
    mocks.database.getProgress.mockResolvedValue(stored);
    mocks.database.saveProgress.mockResolvedValue({ revision: 4, syncedAt: '2026-01-01T01:00:00.000Z' });
    expect(await invoke('getProgress', request())).toMatchObject({ status: 200, jsonBody: stored });
    expect(await invoke('syncProgress', request({ ...snapshot, revision: 3 }, 'Bearer example'))).toMatchObject({ status: 200, jsonBody: { revision: 4 } });
    expect(mocks.database.saveProgress).toHaveBeenCalledWith(account.id, snapshot, 3);
    expect(await invoke('syncProgress', request({ ...snapshot, revision: -1 }))).toMatchObject({ status: 422 });
  });

  it('isolates two accounts and rejects account substitution and stale sessions', async () => {
    const accountB = { id: 'account-2', email: 'other@example.test', name: 'Other' };
    const snapshotA = { topicMastery: { 'rule-5': 90 }, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };
    const snapshotB = { topicMastery: { 'rule-5': 20 }, weakSpotLog: [], drillQueue: [], ruleExerciseAttempts: [] };
    const progress = new Map([
      [account.id, { accountId: account.id, ...snapshotA, revision: 1, syncedAt: null }],
      [accountB.id, { accountId: accountB.id, ...snapshotB, revision: 1, syncedAt: null }],
    ]);
    mocks.auth.authenticate
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(accountB)
      .mockResolvedValueOnce(accountB)
      .mockRejectedValueOnce(new UnauthorizedError());
    mocks.database.getProgress
      .mockImplementationOnce(async (id: string) => progress.get(id))
      .mockImplementationOnce(async (id: string) => progress.get(id));

    expect(await invoke('getProgress', request({}, 'Bearer account-a'))).toMatchObject({ status: 200, jsonBody: { accountId: account.id, topicMastery: snapshotA.topicMastery } });
    expect(await invoke('getProgress', request({}, 'Bearer account-b'))).toMatchObject({ status: 200, jsonBody: { accountId: accountB.id, topicMastery: snapshotB.topicMastery } });
    expect(await invoke('syncProgress', request({ ...snapshotB, revision: 1, accountId: account.id }, 'Bearer account-b'))).toMatchObject({ status: 422 });
    expect(await invoke('syncProgress', request({ ...snapshotA, revision: 1 }, 'Bearer expired'))).toMatchObject({ status: 401 });
    expect(mocks.database.saveProgress).not.toHaveBeenCalled();
    expect(progress.get(account.id)?.topicMastery).toEqual(snapshotA.topicMastery);
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

  it('requires explicit consent and never falls back to free-text keyword grading', async () => {
    const body = { topicId: 'rule-5', context: 'Lookout', answer: 'Maintain a lookout.', onlineConsent: true };
    const { onlineConsent: _consent, ...legacy } = body;
    expect(await invoke('evaluateAnswer', request(legacy))).toMatchObject({ status: 422 });
    expect(await invoke('evaluateAnswer', request({ ...body, onlineConsent: false }))).toMatchObject({ status: 422 });
    expect(await invoke('evaluateAnswer', request({ ...body, accountId: 'other', progress: {} }))).toMatchObject({ status: 422 });
    expect(mocks.auth.consumeEvaluationLimit).not.toHaveBeenCalled();
    expect(mocks.evaluation.evaluate).not.toHaveBeenCalled();
    mocks.evaluation.evaluate.mockResolvedValue({ score: 0.9, source: 'online' });
    expect(await invoke('evaluateAnswer', request(body))).toMatchObject({ status: 200, jsonBody: { source: 'online' } });
    expect(mocks.evaluation.evaluate).toHaveBeenCalledWith(body);
    expect(mocks.auth.consumeEvaluationLimit).toHaveBeenCalledWith(account.id);
    mocks.evaluation.evaluate.mockRejectedValue(new Error('unavailable'));
    expect(await invoke('evaluateAnswer', request(body))).toMatchObject({ status: 503 });
    expect(mocks.deterministicEvaluation.evaluate).not.toHaveBeenCalled();
    const logs = JSON.stringify([mocks.logger.info.mock.calls, mocks.logger.warn.mock.calls, mocks.logger.error.mock.calls]);
    expect(logs).not.toContain(body.answer);
    expect(logs).not.toContain('onlineConsent');
    expect(await invoke('evaluateAnswer', request({ ...body, answer: '' }))).toMatchObject({ status: 422 });
  });

  it('blocks provider calls when authentication or the evaluation quota fails', async () => {
    const body = { topicId: 'rule-5', context: 'Lookout', answer: 'Synthetic answer', onlineConsent: true };
    mocks.auth.authenticate.mockRejectedValueOnce(new UnauthorizedError());
    expect(await invoke('evaluateAnswer', request(body))).toMatchObject({ status: 401 });
    expect(mocks.auth.consumeEvaluationLimit).not.toHaveBeenCalled();
    mocks.auth.consumeEvaluationLimit.mockRejectedValueOnce(new RateLimitError(60));
    expect(await invoke('evaluateAnswer', request(body))).toMatchObject({ status: 429, headers: { 'Retry-After': '60' } });
    mocks.auth.consumeEvaluationLimit.mockRejectedValueOnce(new Error('synthetic private detail'));
    expect(await invoke('evaluateAnswer', request(body))).toMatchObject({ status: 500 });
    expect(mocks.evaluation.evaluate).not.toHaveBeenCalled();
  });

  it('hides evaluation limiter database failures and identifiers from logs', async () => {
    const privateDetail = 'synthetic-evaluation-database-secret';
    const database = { consumeIdentifierLimit: async () => { throw new Error(privateDetail); } } as unknown as IDatabaseService;
    const auth = new AuthService(database, {
      environment: 'Production', databaseUrl: undefined, jwtSecret: 'synthetic-jwt-secret-at-least-32-characters',
      rateLimitSecret: 'synthetic-limit-secret-at-least-32-characters', jwtIssuer: 'test', jwtAudience: 'test',
      googleClientId: undefined, geminiApiKey: undefined, azureStorageAccount: undefined, azuriteConnectionString: undefined,
    });
    mocks.auth.consumeEvaluationLimit.mockImplementationOnce((id) => auth.consumeEvaluationLimit(id));
    expect(await invoke('evaluateAnswer', request({ topicId: 'rule-5', context: 'Synthetic context', answer: 'Synthetic answer', onlineConsent: true }, 'Bearer synthetic-token')))
      .toMatchObject({ status: 503, jsonBody: { error: { message: 'Rate limiting is unavailable.' } } });
    expect(mocks.evaluation.evaluate).not.toHaveBeenCalled();
    const logs = JSON.stringify([mocks.logger.info.mock.calls, mocks.logger.warn.mock.calls, mocks.logger.error.mock.calls], (_key, value: unknown) =>
      value instanceof Error ? { ...value, message: value.message, stack: value.stack } : value);
    for (const secret of [privateDetail, account.id, account.email, 'synthetic-token', 'Synthetic answer', 'synthetic-limit-secret']) expect(logs).not.toContain(secret);
  });

  it('requires authentication before returning the OpenAPI contract', async () => {
    const response = await invoke('openapi', request({}, 'Bearer example'));
    expect(response).toMatchObject({ status: 200, jsonBody: { openapi: '3.0.3', info: { title: 'WatchWatcher API' } } });
    expect(response.jsonBody).toMatchObject({ paths: { '/account': { delete: { security: [{ bearerAuth: [] }], responses: { '204': expect.any(Object), '401': expect.any(Object) } } } }, components: { schemas: { DeleteAccountRequest: expect.any(Object) } } });
    expect(response.jsonBody).toMatchObject({ paths: { '/exam/evaluate': { post: { requestBody: { content: { 'application/json': { schema: { required: ['topicId', 'context', 'answer', 'onlineConsent'], properties: { onlineConsent: { enum: [true] } } } } } } } } } });
    const generated = response.jsonBody as { components: { schemas: Record<string, unknown> }; paths: Record<string, { post: { responses: Record<string, unknown>; requestBody: unknown } }> };
    const checkedIn = parse(readFileSync(new URL('../openapi.yaml', import.meta.url), 'utf8')) as typeof generated;
    for (const name of ['Password', 'CredentialsRequest', 'RegisterRequest', 'GoogleSignInRequest', 'DeleteAccountRequest']) {
      expect(checkedIn.components.schemas[name]).toEqual(generated.components.schemas[name]);
    }
    for (const path of ['/auth/register', '/auth/login', '/auth/session']) {
      expect(checkedIn.paths[path].post.requestBody).toEqual(generated.paths[path].post.requestBody);
    }
    const generatedResponses = generated.paths['/exam/evaluate'].post.responses;
    const checkedInResponses = checkedIn.paths['/exam/evaluate'].post.responses;
    expect(checkedInResponses['200']).toEqual(generatedResponses['200']);
    expect(checkedInResponses['429']).toEqual(generatedResponses['429']);
    expect(generatedResponses['200']).toMatchObject({ content: { 'application/json': { schema: { required: expect.arrayContaining(['criticalFailure', 'criticalFailureReason']) } } } });
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

  it('redacts non-Error failures in the production environment', async () => {
    vi.stubEnv('AZURE_FUNCTIONS_ENVIRONMENT', 'Production');
    mocks.auth.authenticate.mockRejectedValue('internal string failure');
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