import { app } from '@azure/functions';
import { getServices } from '../services/registry';
import { bearerHeader, runHttp } from './httpUtils';

const specification = {
  openapi: '3.0.3',
  info: { title: 'WatchWatcher API', version: '1.0.0' },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    schemas: {
      RuleExerciseAttempt: {
        type: 'object',
        required: ['id', 'ruleId', 'selectedOptionId', 'correct', 'attemptedAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          ruleId: { type: 'string', pattern: '^(rule-(?:[1-9]|[1-3][0-9]|4[01])|annex-(?:i|ii|iii|iv))$' },
          selectedOptionId: { type: 'string', enum: ['a', 'b', 'c', 'd'] },
          correct: { type: 'boolean' },
          attemptedAt: { type: 'string', format: 'date-time' },
        },
      },
      ProgressSnapshot: {
        type: 'object',
        required: ['topicMastery', 'weakSpotLog', 'drillQueue', 'ruleExerciseAttempts'],
        properties: {
          topicMastery: { type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 100 } },
          weakSpotLog: { type: 'array', items: { type: 'object', required: ['topicId', 'tag', 'timestamp'], properties: { topicId: { type: 'string' }, tag: { type: 'string' }, timestamp: { type: 'string', format: 'date-time' } } } },
          drillQueue: { type: 'array', items: { type: 'string' } },
          ruleExerciseAttempts: { type: 'array', maxItems: 10000, items: { $ref: '#/components/schemas/RuleExerciseAttempt' } },
        },
      },
      ProgressSyncRequest: {
        allOf: [
          { $ref: '#/components/schemas/ProgressSnapshot' },
          { type: 'object', required: ['revision'], properties: { revision: { type: 'integer', minimum: 0 } } },
        ],
      },
      StoredProgress: {
        allOf: [
          { $ref: '#/components/schemas/ProgressSnapshot' },
          { type: 'object', required: ['accountId', 'revision', 'syncedAt'], properties: { accountId: { type: 'string', format: 'uuid' }, revision: { type: 'integer', minimum: 0 }, syncedAt: { type: 'string', format: 'date-time', nullable: true } } },
        ],
      },
      GoogleAuthConfig: {
        type: 'object',
        required: ['clientId'],
        properties: { clientId: { type: 'string', description: 'Public Google OAuth web client ID.' } },
      },
      GoogleAuthChallenge: {
        type: 'object',
        required: ['challengeId', 'nonce', 'expiresAt'],
        properties: {
          challengeId: { type: 'string', format: 'uuid' },
          nonce: { type: 'string' },
          expiresAt: { type: 'string', format: 'date-time' },
        },
      },
      GoogleSignInRequest: {
        type: 'object',
        required: ['credential', 'challengeId'],
        properties: {
          credential: { type: 'string', minLength: 100, maxLength: 10000 },
          challengeId: { type: 'string', format: 'uuid' },
          linkExisting: {
            type: 'object',
            required: ['confirmed', 'password'],
            properties: { confirmed: { type: 'boolean', enum: [true] }, password: { type: 'string', minLength: 8, maxLength: 128 } },
          },
        },
      },
      DeleteAccountRequest: {
        type: 'object', additionalProperties: false, required: ['confirmation', 'reauthentication'],
        properties: {
          confirmation: { type: 'string', enum: ['DELETE'] },
          reauthentication: { oneOf: [
            { type: 'object', additionalProperties: false, required: ['type', 'password'], properties: { type: { type: 'string', enum: ['password'] }, password: { type: 'string', minLength: 1, maxLength: 128 } } },
            { type: 'object', additionalProperties: false, required: ['type', 'credential', 'challengeId'], properties: { type: { type: 'string', enum: ['google'] }, credential: { type: 'string', minLength: 100, maxLength: 10000 }, challengeId: { type: 'string', format: 'uuid' } } },
          ] },
        },
      },
    },
  },
  paths: {
    '/health': { get: { summary: 'API and optional service health', responses: { '200': { description: 'Healthy or degraded' }, '503': { description: 'Unavailable' } } } },
    '/auth/register': { post: { summary: 'Create an account', responses: { '201': { description: 'Account created' }, '409': { description: 'Duplicate account' } } } },
    '/auth/login': { post: { summary: 'Create a signed-in session', responses: { '200': { description: 'Session created' }, '401': { description: 'Invalid credentials' } } } },
    '/auth/session': { post: { summary: 'Start a session for account features', responses: { '200': { description: 'Session created' } } } },
    '/auth/google/config': {
      get: {
        summary: 'Read public Google sign-in configuration',
        responses: {
          '200': { description: 'Google client configuration', content: { 'application/json': { schema: { $ref: '#/components/schemas/GoogleAuthConfig' } } } },
          '503': { description: 'Google sign-in is not configured' },
        },
      },
    },
    '/auth/google/challenge': {
      post: {
        summary: 'Create a short-lived, single-use OIDC nonce challenge',
        responses: {
          '201': { description: 'Google sign-in challenge', content: { 'application/json': { schema: { $ref: '#/components/schemas/GoogleAuthChallenge' } } } },
          '503': { description: 'Google sign-in is not configured' },
        },
      },
    },
    '/auth/google': {
      post: {
        summary: 'Verify a Google ID token and create a WatchWatcher session or request explicit account linking',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/GoogleSignInRequest' } } } },
        responses: {
          '200': { description: 'WatchWatcher session created' },
          '401': { description: 'Invalid Google identity, challenge, or existing-account password' },
          '409': { description: 'Explicit account linking required or identity conflict' },
          '503': { description: 'Google sign-in is not configured' },
        },
      },
    },
    '/auth/me': { get: { summary: 'Read the signed-in user', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Current user' } } } },
    '/account': {
      delete: {
        summary: 'Delete the current account and its server records',
        description: 'Accounts and server records are retained until learner deletion. Deletion is online only. Google reauthentication requires a fresh single-use challenge from /auth/google/challenge. A valid session for an already deleted account also returns 204. Backup retention is pending legal and operational determination.',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/DeleteAccountRequest' } } } },
        responses: { '204': { description: 'Account deleted or already absent; no response body' }, '401': { description: 'Invalid or expired bearer session' }, '403': { description: 'Reauthentication failed (REAUTHENTICATION_FAILED)' }, '422': { description: 'Invalid request' }, '503': { description: 'Required service not configured' } },
      },
    },
    '/progress': {
      get: { summary: 'Read progress for the authenticated account', security: [{ bearerAuth: [] }], responses: { '200': { description: 'Account progress snapshot', content: { 'application/json': { schema: { $ref: '#/components/schemas/StoredProgress' } } } } } },
      put: {
        summary: 'Synchronize progress for the authenticated account using an optimistic revision',
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/ProgressSyncRequest' } } } },
        responses: { '200': { description: 'Revision saved' }, '409': { description: 'Stale revision' } },
      },
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
